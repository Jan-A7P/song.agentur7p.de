<?php

namespace App\Services;

use App\Enums\MusicProvider;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

class TidalService
{
    public function __construct(private MusicConnectionService $connections) {}

    private const AUTH_URL = 'https://login.tidal.com/authorize';

    private const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token';

    private const API_URL = 'https://openapi.tidal.com/v2';

    /**
     * Current TIDAL Developer Platform scopes (legacy r_usr/w_usr break login).
     *
     * @see https://developer.tidal.com/documentation/api-sdk/api-sdk-authorization
     */
    public const SCOPES = [
        'playlists.read',
        'playback',
    ];

    public function authorizationUrl(string $state, string $codeChallenge, bool $forceConsent = false): string
    {
        $params = [
            'response_type' => 'code',
            'client_id' => $this->clientId(),
            'redirect_uri' => $this->redirectUri(),
            'scope' => implode(' ', self::SCOPES),
            'code_challenge_method' => 'S256',
            'code_challenge' => $codeChallenge,
            'state' => $state,
        ];

        return self::AUTH_URL.'?'.http_build_query($params);
    }

    /**
     * @return array{verifier: string, challenge: string}
     */
    public function createPkcePair(): array
    {
        $verifier = rtrim(strtr(base64_encode(random_bytes(64)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');

        return [
            'verifier' => $verifier,
            'challenge' => $challenge,
        ];
    }

    /**
     * @return array{access_token: string, refresh_token?: string, expires_in: int, user_id?: int|string}
     */
    public function exchangeCode(string $code, string $codeVerifier): array
    {
        $response = Http::asForm()
            ->withBasicAuth($this->clientId(), $this->clientSecret())
            ->post(self::TOKEN_URL, [
                'grant_type' => 'authorization_code',
                'code' => $code,
                'redirect_uri' => $this->redirectUri(),
                'code_verifier' => $codeVerifier,
                'client_id' => $this->clientId(),
            ]);

        if ($response->failed()) {
            throw new RuntimeException('TIDAL token exchange failed: '.$response->body());
        }

        return $response->json();
    }

    public function storeTokens(User $user, array $tokens, bool $bumpToFront = true): void
    {
        $externalUserId = isset($tokens['user_id']) ? (string) $tokens['user_id'] : null;

        $this->connections->upsertTokens(
            $user,
            MusicProvider::Tidal,
            $tokens,
            externalUserId: $externalUserId,
            bumpToFront: $bumpToFront,
        );
    }

    public function disconnect(User $user): void
    {
        $this->connections->disconnect($user, MusicProvider::Tidal);
    }

    public function getAccessToken(User $user): string
    {
        $connection = $this->connections->get($user, MusicProvider::Tidal);

        if (! $connection || ! $connection->isLinked()) {
            throw new RuntimeException('TIDAL is not connected.');
        }

        if (! $connection->isEnabled()) {
            throw new RuntimeException(__('TIDAL is disabled. Enable the service in Settings.'));
        }

        if ($connection->isTokenFresh() && filled($connection->access_token)) {
            return $connection->access_token;
        }

        $tokens = $this->refreshAccessToken($connection->refresh_token);
        $this->storeTokens($user, $tokens, bumpToFront: false);

        $fresh = $this->connections->get($user->fresh(), MusicProvider::Tidal);

        return (string) $fresh?->access_token;
    }

    /**
     * @return array{access_token: string, expires_in: int, refresh_token?: string, user_id?: int|string}
     */
    public function refreshAccessToken(string $refreshToken): array
    {
        $response = Http::asForm()
            ->withBasicAuth($this->clientId(), $this->clientSecret())
            ->post(self::TOKEN_URL, [
                'grant_type' => 'refresh_token',
                'refresh_token' => $refreshToken,
                'client_id' => $this->clientId(),
            ]);

        if ($response->failed()) {
            throw new RuntimeException('TIDAL token refresh failed: '.$response->body());
        }

        return $response->json();
    }

    public function getClientCredentialsToken(): string
    {
        $response = Http::asForm()
            ->withBasicAuth($this->clientId(), $this->clientSecret())
            ->post(self::TOKEN_URL, [
                'grant_type' => 'client_credentials',
            ]);

        if ($response->failed()) {
            throw new RuntimeException('TIDAL client credentials failed: '.$response->body());
        }

        return (string) $response->json('access_token');
    }

    /**
     * @return list<array{id: string, uri: string, name: string, artist: string, album_art_url: string|null, duration_ms: int|null}>
     */
    public function searchTracks(string $query, int $limit = 10): array
    {
        $token = $this->getClientCredentialsToken();
        $country = $this->countryCode();
        $term = trim($query);
        if ($term === '') {
            return [];
        }

        // TIDAL retired GET /searchResults/{query} (free-text as resource id).
        // Current catalog search is a collection: GET /searchResults?filter[query]=…
        $queryParams = [
            'filter[query]' => Str::limit($term, 256, ''),
            'countryCode' => $country,
            'explicitFilter' => 'INCLUDE',
        ];
        $includes = [
            'tracks,artists,albums,tracks.artists,tracks.albums,tracks.albums.coverArt',
            'tracks,artists,albums,tracks.artists,tracks.albums',
            'tracks,artists,albums',
        ];

        $response = null;
        foreach ($includes as $include) {
            $response = Http::withToken($token)
                ->accept('application/vnd.api+json')
                ->get(self::API_URL.'/searchResults', [
                    ...$queryParams,
                    'include' => $include,
                ]);
            if ($response->successful()) {
                break;
            }
        }

        if ($response === null || $response->failed()) {
            throw new RuntimeException('TIDAL search failed: '.($response?->body() ?? 'empty response'));
        }

        $payload = $response->json();
        $included = collect($payload['included'] ?? []);
        $tracksById = $included->where('type', 'tracks')->keyBy('id');
        $artistsById = $included->where('type', 'artists')->keyBy('id');
        $albumsById = $included->where('type', 'albums')->keyBy('id');
        $artworksById = $included->where('type', 'artworks')->keyBy('id');

        $searchResult = $payload['data'] ?? null;
        if (is_array($searchResult) && array_is_list($searchResult)) {
            $searchResult = $searchResult[0] ?? null;
        }

        $trackRefs = data_get($searchResult, 'relationships.tracks.data', []);
        if (! is_array($trackRefs) || $trackRefs === []) {
            $trackRefs = $tracksById->keys()->map(fn ($id) => ['id' => $id])->all();
        }

        $results = [];
        foreach ($trackRefs as $ref) {
            if (count($results) >= $limit) {
                break;
            }
            $id = (string) ($ref['id'] ?? '');
            if ($id === '') {
                continue;
            }
            $track = $tracksById->get($id);
            if (! is_array($track)) {
                continue;
            }

            $title = (string) data_get($track, 'attributes.title', 'Track');
            $artistNames = collect(data_get($track, 'relationships.artists.data', []))
                ->map(function ($artistRef) use ($artistsById) {
                    $artist = $artistsById->get((string) ($artistRef['id'] ?? ''));

                    return is_array($artist) ? (string) data_get($artist, 'attributes.name', '') : '';
                })
                ->filter()
                ->implode(', ');

            $albumId = (string) data_get($track, 'relationships.albums.data.0.id', '');
            $album = $albumId !== '' ? $albumsById->get($albumId) : null;
            $albumArt = $this->resolveCoverArtUrl($track, $artworksById)
                ?? $this->resolveCoverArtUrl(is_array($album) ? $album : null, $artworksById);

            $results[] = [
                'id' => $id,
                'uri' => 'tidal:track:'.$id,
                'name' => $title,
                'artist' => $artistNames !== '' ? $artistNames : 'Unbekannt',
                'album_art_url' => $albumArt,
                'duration_ms' => $this->parseIsoDurationMs(data_get($track, 'attributes.duration')),
                'album_id' => $albumId !== '' ? $albumId : null,
            ];
        }

        return $this->fillMissingTidalCovers($token, $results);
    }

    /**
     * @return list<array{id: string, name: string, description: string|null, image_url: string|null, tracks_total: int, owner: string, can_import: bool}>
     */
    public function getUserPlaylists(User $user, int $limit = 50): array
    {
        $token = $this->getAccessToken($user);
        $connection = $this->connections->get($user, MusicProvider::Tidal);
        $userId = $connection?->external_user_id;

        if (! filled($userId)) {
            throw new RuntimeException(__('TIDAL user id missing. Please reconnect.'));
        }

        $response = Http::withToken($token)
            ->accept('application/vnd.api+json')
            ->get(self::API_URL.'/userCollections/'.$userId.'/relationships/playlists', [
                'include' => 'playlists,playlists.coverArt',
                'countryCode' => $this->countryCode(),
            ]);

        if ($response->failed()) {
            throw new RuntimeException('TIDAL playlists failed: '.$response->body());
        }

        $payload = $response->json();
        $included = collect($payload['included'] ?? []);
        $playlistsById = $included->where('type', 'playlists')->keyBy('id');
        $artworksById = $included->where('type', 'artworks')->keyBy('id');
        $refs = $payload['data'] ?? [];
        $playlists = [];

        foreach ($refs as $ref) {
            if (count($playlists) >= $limit) {
                break;
            }
            $id = (string) ($ref['id'] ?? '');
            $playlist = $playlistsById->get($id);
            if (! is_array($playlist)) {
                continue;
            }

            $playlists[] = [
                'id' => $id,
                'name' => (string) data_get($playlist, 'attributes.name', 'Playlist'),
                'description' => data_get($playlist, 'attributes.description') ?: null,
                'image_url' => $this->resolveCoverArtUrl($playlist, $artworksById),
                'tracks_total' => (int) data_get($playlist, 'attributes.numberOfItems', 0),
                'owner' => 'TIDAL',
                'can_import' => true,
            ];
        }

        return $playlists;
    }

    /**
     * @return list<array{id: string, uri: string, name: string, artist: string, album_art_url: string|null}>
     */
    public function getPlaylistTracks(User $user, string $playlistId): array
    {
        $token = $this->getAccessToken($user);
        $tracks = [];
        $cursor = null;

        do {
            $query = [
                'include' => 'items.tracks,items.tracks.artists,items.tracks.albums,items.tracks.albums.coverArt',
                'countryCode' => $this->countryCode(),
            ];
            if ($cursor) {
                $query['page[cursor]'] = $cursor;
            }

            $response = Http::withToken($token)
                ->accept('application/vnd.api+json')
                ->get(self::API_URL.'/playlists/'.$playlistId.'/relationships/items', $query);

            if ($response->failed()) {
                throw new RuntimeException('TIDAL playlist tracks failed: '.$response->body());
            }

            $payload = $response->json();
            $included = collect($payload['included'] ?? []);
            $tracksById = $included->where('type', 'tracks')->keyBy('id');
            $artistsById = $included->where('type', 'artists')->keyBy('id');
            $albumsById = $included->where('type', 'albums')->keyBy('id');
            $artworksById = $included->where('type', 'artworks')->keyBy('id');

            foreach ($tracksById as $id => $track) {
                if (! is_array($track)) {
                    continue;
                }
                $artistNames = collect(data_get($track, 'relationships.artists.data', []))
                    ->map(function ($artistRef) use ($artistsById) {
                        $artist = $artistsById->get((string) ($artistRef['id'] ?? ''));

                        return is_array($artist) ? (string) data_get($artist, 'attributes.name', '') : '';
                    })
                    ->filter()
                    ->implode(', ');

                $albumId = (string) data_get($track, 'relationships.albums.data.0.id', '');
                $album = $albumId !== '' ? $albumsById->get($albumId) : null;
                $albumArt = $this->resolveCoverArtUrl($track, $artworksById)
                    ?? $this->resolveCoverArtUrl(is_array($album) ? $album : null, $artworksById);

                $tracks[] = [
                    'id' => (string) $id,
                    'uri' => 'tidal:track:'.$id,
                    'name' => (string) data_get($track, 'attributes.title', 'Track'),
                    'artist' => $artistNames !== '' ? $artistNames : 'Unbekannt',
                    'album_art_url' => $albumArt,
                    'album_id' => $albumId !== '' ? $albumId : null,
                ];
            }

            $cursor = data_get($payload, 'links.next');
            if (is_string($cursor) && str_contains($cursor, 'page%5Bcursor%5D=')) {
                parse_str(parse_url($cursor, PHP_URL_QUERY) ?: '', $parts);
                $cursor = $parts['page']['cursor'] ?? $parts['page[cursor]'] ?? null;
            } elseif (is_string($cursor) && str_contains($cursor, 'cursor=')) {
                parse_str(parse_url($cursor, PHP_URL_QUERY) ?: '', $parts);
                $cursor = $parts['page']['cursor'] ?? $parts['page[cursor]'] ?? null;
            } else {
                $cursor = null;
            }
        } while ($cursor);

        return $this->fillMissingTidalCovers($token, $tracks);
    }

    /**
     * In-app TIDAL playback runs in the browser SDK. This endpoint stays for API
     * compatibility and is unused.
     */
    public function playUri(User $user, string $uri, string $deviceId, int $positionMs = 0): void
    {
        throw new RuntimeException('TIDAL-Wiedergabe läuft lokal im Web-SDK, nicht über diesen Endpoint.');
    }

    public function isConfigured(): bool
    {
        return filled($this->clientId()) && filled($this->clientSecret()) && filled($this->redirectUri());
    }

    public function publicClientId(): string
    {
        return $this->clientId();
    }

    /**
     * @param  list<array{id: string, uri: string, name: string, artist: string, album_art_url: string|null, duration_ms?: int|null, album_id?: string|null}>  $rows
     * @return list<array{id: string, uri: string, name: string, artist: string, album_art_url: string|null, duration_ms?: int|null}>
     */
    private function fillMissingTidalCovers(string $token, array $rows): array
    {
        $missingAlbumIds = collect($rows)
            ->filter(fn (array $row) => empty($row['album_art_url']) && filled($row['album_id'] ?? null))
            ->pluck('album_id')
            ->unique()
            ->values()
            ->all();

        $coversByAlbumId = $this->fetchAlbumCoverUrls($token, $missingAlbumIds);

        return array_map(function (array $row) use ($coversByAlbumId) {
            if (empty($row['album_art_url'])) {
                $albumId = (string) ($row['album_id'] ?? '');
                $row['album_art_url'] = $coversByAlbumId[$albumId] ?? null;
            }
            unset($row['album_id']);

            return $row;
        }, $rows);
    }

    /**
     * @param  list<string>  $albumIds
     * @return array<string, string>
     */
    private function fetchAlbumCoverUrls(string $token, array $albumIds): array
    {
        $albumIds = array_values(array_unique(array_filter($albumIds)));
        if ($albumIds === []) {
            return [];
        }

        $covers = [];
        foreach (array_chunk($albumIds, 20) as $chunk) {
            $response = Http::withToken($token)
                ->accept('application/vnd.api+json')
                ->get(self::API_URL.'/albums', [
                    'filter[id]' => implode(',', $chunk),
                    'include' => 'coverArt',
                    'countryCode' => $this->countryCode(),
                ]);

            if ($response->failed()) {
                continue;
            }

            $payload = $response->json();
            $included = collect($payload['included'] ?? []);
            $artworksById = $included->where('type', 'artworks')->keyBy('id');
            $albums = $payload['data'] ?? [];
            if (! is_array($albums)) {
                continue;
            }

            foreach ($albums as $album) {
                if (! is_array($album)) {
                    continue;
                }
                $id = (string) ($album['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $url = $this->resolveCoverArtUrl($album, $artworksById);
                if ($url !== null) {
                    $covers[$id] = $url;
                }
            }
        }

        return $covers;
    }

    /**
     * @param  Collection<string, array<string, mixed>>  $artworksById
     */
    private function resolveCoverArtUrl(?array $resource, $artworksById): ?string
    {
        $direct = $this->extractImageUrl($resource);
        if ($direct !== null) {
            return $direct;
        }

        if ($resource === null) {
            return null;
        }

        $coverRefs = $this->relationshipData(data_get($resource, 'relationships.coverArt.data'));
        foreach ($coverRefs as $coverRef) {
            $artworkId = (string) ($coverRef['id'] ?? '');
            if ($artworkId === '') {
                continue;
            }
            $artwork = $artworksById->get($artworkId);
            $url = $this->extractImageUrl(is_array($artwork) ? $artwork : null)
                ?? $this->artworkCdnUrlFromId($artworkId);
            if ($url !== null) {
                return $url;
            }
        }

        return null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function relationshipData(mixed $data): array
    {
        if (! is_array($data) || $data === []) {
            return [];
        }
        if (isset($data['id'])) {
            return [$data];
        }

        return array_values(array_filter($data, 'is_array'));
    }

    private function artworkCdnUrlFromId(string $id): ?string
    {
        if (! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $id)) {
            return null;
        }

        $path = str_replace('-', '/', strtolower($id));

        return 'https://resources.tidal.com/images/'.$path.'/640x640.jpg';
    }

    private function extractImageUrl(?array $resource): ?string
    {
        if ($resource === null) {
            return null;
        }

        $links = data_get($resource, 'attributes.imageLinks', []);
        if (is_array($links) && $links !== []) {
            $href = $links[0]['href'] ?? $links[0]['url'] ?? null;
            if (is_string($href) && $href !== '') {
                return Str::limit($href, 2048, '');
            }
        }

        // Albums/playlists expose covers via related artworks.files, not imageLinks.
        $files = data_get($resource, 'attributes.files', []);
        if (is_array($files) && $files !== []) {
            $preferred = collect($files)
                ->filter(fn ($file) => is_array($file) && is_string($file['href'] ?? null) && $file['href'] !== '')
                ->sortByDesc(fn ($file) => (int) data_get($file, 'meta.width', 0))
                ->first();

            if (is_array($preferred)) {
                $mid = collect($files)
                    ->filter(fn ($file) => is_array($file) && is_string($file['href'] ?? null) && $file['href'] !== '')
                    ->first(fn ($file) => (int) data_get($file, 'meta.width', 0) === 640)
                    ?? $preferred;

                return Str::limit((string) $mid['href'], 2048, '');
            }
        }

        return null;
    }

    private function parseIsoDurationMs(mixed $value): ?int
    {
        if (is_int($value) || is_float($value)) {
            $number = (int) $value;
            if ($number <= 0) {
                return null;
            }

            // Tidal sometimes sends seconds, sometimes milliseconds.
            return $number < 10_000 ? $number * 1000 : $number;
        }

        if (! is_string($value) || $value === '') {
            return null;
        }

        if (is_numeric($value)) {
            return $this->parseIsoDurationMs((int) $value);
        }

        try {
            $interval = new \DateInterval($value);
        } catch (\Throwable) {
            return null;
        }

        $seconds = ($interval->h * 3600) + ($interval->i * 60) + $interval->s + $interval->f;

        return $seconds > 0 ? (int) round($seconds * 1000) : null;
    }

    private function clientId(): string
    {
        return (string) config('services.tidal.client_id');
    }

    private function clientSecret(): string
    {
        return (string) config('services.tidal.client_secret');
    }

    private function redirectUri(): string
    {
        return (string) config('services.tidal.redirect');
    }

    private function countryCode(): string
    {
        return (string) config('services.tidal.country_code', 'DE');
    }
}
