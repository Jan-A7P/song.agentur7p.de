<?php

namespace App\Services;

use App\Enums\MusicProvider;
use App\Models\User;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class SpotifyService
{
    public function __construct(private MusicConnectionService $connections) {}

    private const AUTH_URL = 'https://accounts.spotify.com/authorize';

    private const TOKEN_URL = 'https://accounts.spotify.com/api/token';

    private const API_URL = 'https://api.spotify.com/v1';

    public const SCOPES = [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-modify-playback-state',
        'user-read-playback-state',
        'playlist-read-private',
        'playlist-read-collaborative',
    ];

    public function authorizationUrl(string $state, bool $forceConsent = false, ?string $redirectUri = null): string
    {
        $params = [
            'response_type' => 'code',
            'client_id' => $this->clientId(),
            'scope' => implode(' ', self::SCOPES),
            'redirect_uri' => $redirectUri ?? $this->redirectUri(),
            'state' => $state,
        ];

        if ($forceConsent) {
            $params['show_dialog'] = 'true';
        }

        return self::AUTH_URL.'?'.http_build_query($params);
    }

    /**
     * @return array{access_token: string, refresh_token?: string, expires_in: int}
     */
    public function exchangeCode(string $code, ?string $redirectUri = null): array
    {
        $response = Http::asForm()
            ->withBasicAuth($this->clientId(), $this->clientSecret())
            ->post(self::TOKEN_URL, [
                'grant_type' => 'authorization_code',
                'code' => $code,
                'redirect_uri' => $redirectUri ?? $this->redirectUri(),
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Spotify token exchange failed: '.$response->body());
        }

        return $response->json();
    }

    public function storeTokens(User $user, array $tokens, bool $bumpToFront = true): void
    {
        $this->connections->upsertTokens($user, MusicProvider::Spotify, $tokens, bumpToFront: $bumpToFront);
    }

    public function disconnect(User $user): void
    {
        $this->connections->disconnect($user, MusicProvider::Spotify);
    }

    public function getAccessToken(User $user): string
    {
        $connection = $this->connections->get($user, MusicProvider::Spotify);

        if (! $connection || ! $connection->isLinked()) {
            throw new RuntimeException('Spotify is not connected.');
        }

        if (! $connection->isEnabled()) {
            throw new RuntimeException(__('Spotify is disabled. Enable the service in Settings.'));
        }

        if ($connection->isTokenFresh() && filled($connection->access_token)) {
            return $connection->access_token;
        }

        $tokens = $this->refreshAccessToken($connection->refresh_token);
        $this->storeTokens($user, $tokens, bumpToFront: false);

        $fresh = $this->connections->get($user->fresh(), MusicProvider::Spotify);

        return (string) $fresh?->access_token;
    }

    /**
     * @return array{access_token: string, expires_in: int, refresh_token?: string}
     */
    public function refreshAccessToken(string $refreshToken): array
    {
        $response = Http::asForm()
            ->withBasicAuth($this->clientId(), $this->clientSecret())
            ->post(self::TOKEN_URL, [
                'grant_type' => 'refresh_token',
                'refresh_token' => $refreshToken,
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Spotify token refresh failed: '.$response->body());
        }

        return $response->json();
    }

    /**
     * Client-credentials token for search (no user context required).
     */
    public function getClientCredentialsToken(): string
    {
        $response = Http::asForm()
            ->withBasicAuth($this->clientId(), $this->clientSecret())
            ->post(self::TOKEN_URL, [
                'grant_type' => 'client_credentials',
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Spotify client credentials failed: '.$response->body());
        }

        return $response->json('access_token');
    }

    /**
     * @return list<array{id: string, uri: string, name: string, artist: string, album_art_url: string|null, duration_ms: int|null}>
     */
    public function searchTracks(string $query, int $limit = 10): array
    {
        $token = $this->getClientCredentialsToken();

        $response = Http::withToken($token)
            ->get(self::API_URL.'/search', [
                'q' => $query,
                'type' => 'track',
                // Spotify Dev Mode (Feb 2026+): search limit max is 10
                'limit' => min(max($limit, 1), 10),
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Spotify search failed: '.$response->body());
        }

        $items = $response->json('tracks.items') ?? [];

        return collect($items)->map(function (array $track) {
            $artists = collect($track['artists'] ?? [])->pluck('name')->implode(', ');
            $images = $track['album']['images'] ?? [];

            return [
                'id' => $track['id'],
                'uri' => $track['uri'],
                'name' => $track['name'],
                'artist' => $artists,
                'album_art_url' => $images[1]['url'] ?? $images[0]['url'] ?? null,
                'duration_ms' => isset($track['duration_ms']) ? (int) $track['duration_ms'] : null,
            ];
        })->all();
    }

    public function getTrackDurationMs(string $trackId): ?int
    {
        $trackId = trim($trackId);
        if ($trackId === '') {
            return null;
        }

        try {
            $token = $this->getClientCredentialsToken();
        } catch (RuntimeException) {
            return null;
        }

        $response = Http::withToken($token)->get(self::API_URL.'/tracks/'.$trackId);
        if ($response->failed()) {
            return null;
        }

        $duration = (int) ($response->json('duration_ms') ?? 0);

        return $duration > 0 ? $duration : null;
    }

    /**
     * Spotify user id of the connected account (GET /me).
     */
    public function getCurrentUserId(User $user): string
    {
        $token = $this->getAccessToken($user);

        $response = Http::withToken($token)->get(self::API_URL.'/me');

        if ($response->failed()) {
            throw new RuntimeException('Spotify profile failed: '.$response->body());
        }

        $id = $response->json('id');
        if (! is_string($id) || $id === '') {
            throw new RuntimeException('Spotify profile missing user id.');
        }

        return $id;
    }

    /**
     * @return list<array{id: string, name: string, description: string|null, image_url: string|null, tracks_total: int, owner: string, can_import: bool}>
     */
    public function getUserPlaylists(User $user, int $limit = 50): array
    {
        $token = $this->getAccessToken($user);
        $spotifyUserId = $this->getCurrentUserId($user);
        $playlists = [];
        $offset = 0;

        do {
            $response = Http::withToken($token)
                ->get(self::API_URL.'/me/playlists', [
                    'limit' => min($limit, 50),
                    'offset' => $offset,
                ]);

            if ($response->failed()) {
                throw new RuntimeException('Spotify playlists failed: '.$response->body());
            }

            $items = $response->json('items') ?? [];
            foreach ($items as $item) {
                if (! is_array($item)) {
                    continue;
                }

                $images = $item['images'] ?? [];
                $ownerId = (string) ($item['owner']['id'] ?? '');
                $collaborative = (bool) ($item['collaborative'] ?? false);
                $canImport = $collaborative || ($ownerId !== '' && $ownerId === $spotifyUserId);

                // Feb 2026+: tracks renamed to items (keep tracks as fallback)
                $tracksTotal = (int) (
                    $item['items']['total']
                    ?? $item['tracks']['total']
                    ?? 0
                );

                $playlists[] = [
                    'id' => $item['id'],
                    'name' => $item['name'] ?? 'Playlist',
                    'description' => ($item['description'] ?? '') !== '' ? $item['description'] : null,
                    'image_url' => $images[0]['url'] ?? null,
                    'tracks_total' => $tracksTotal,
                    'owner' => $item['owner']['display_name'] ?? $ownerId,
                    'can_import' => $canImport,
                ];
            }

            $offset += count($items);
            $total = (int) ($response->json('total') ?? $offset);
        } while ($offset < $total && count($items) > 0);

        return $playlists;
    }

    /**
     * @return list<array{id: string, uri: string, name: string, artist: string, album_art_url: string|null}>
     */
    public function getPlaylistTracks(User $user, string $playlistId): array
    {
        $token = $this->getAccessToken($user);
        $tracks = [];
        $offset = 0;

        do {
            // Feb 2026+: /tracks → /items (only for owned/collaborative playlists in Dev Mode)
            $response = Http::withToken($token)
                ->get(self::API_URL.'/playlists/'.$playlistId.'/items', [
                    'limit' => 100,
                    'offset' => $offset,
                ]);

            // Compatibility: older extended-quota apps may still expose /tracks
            if ($response->status() === 404) {
                $response = Http::withToken($token)
                    ->get(self::API_URL.'/playlists/'.$playlistId.'/tracks', [
                        'limit' => 100,
                        'offset' => $offset,
                    ]);
            }

            if ($response->failed()) {
                throw new RuntimeException('Spotify playlist tracks failed: '.$response->body());
            }

            $items = $response->json('items') ?? [];
            foreach ($items as $row) {
                if (! is_array($row)) {
                    continue;
                }

                // Feb 2026+: entry.item (track still sent during deprecation window)
                $track = $row['item'] ?? $row['track'] ?? null;
                if (! is_array($track) || ($track['type'] ?? 'track') !== 'track') {
                    continue;
                }
                if (($track['is_local'] ?? false) === true) {
                    continue;
                }
                if (empty($track['id']) || empty($track['uri'])) {
                    continue;
                }

                $artists = collect($track['artists'] ?? [])->pluck('name')->filter()->implode(', ');
                $images = $track['album']['images'] ?? [];
                $artUrl = $images[1]['url'] ?? $images[0]['url'] ?? null;
                if (is_string($artUrl) && strlen($artUrl) > 2048) {
                    $artUrl = $images[0]['url'] ?? null;
                    if (is_string($artUrl) && strlen($artUrl) > 2048) {
                        $artUrl = null;
                    }
                }

                $tracks[] = [
                    'id' => (string) $track['id'],
                    'uri' => (string) $track['uri'],
                    'name' => (string) ($track['name'] ?? 'Track'),
                    'artist' => $artists !== '' ? $artists : 'Unbekannt',
                    'album_art_url' => $artUrl,
                ];
            }

            $offset += count($items);
            $total = (int) ($response->json('total') ?? $offset);
        } while ($offset < $total && count($items) > 0);

        return $tracks;
    }

    /**
     * Start playback on a Spotify Connect device.
     *
     * @throws RequestException
     */
    public function playUri(User $user, string $uri, string $deviceId, int $positionMs = 0): void
    {
        $token = $this->getAccessToken($user);

        $body = [
            'uris' => [$uri],
        ];

        if ($positionMs > 0) {
            $body['position_ms'] = $positionMs;
        }

        $response = Http::withToken($token)
            ->withQueryParameters(['device_id' => $deviceId])
            ->put(self::API_URL.'/me/player/play', $body);

        if ($response->failed() && $response->status() !== 204) {
            $response->throw();
        }
    }

    public function isConfigured(): bool
    {
        return filled($this->clientId()) && filled($this->clientSecret()) && filled($this->redirectUri());
    }

    public function isLoginConfigured(): bool
    {
        return filled($this->clientId()) && filled($this->clientSecret()) && filled($this->loginRedirectUri());
    }

    public function loginRedirectUri(): string
    {
        return (string) config('services.spotify.login_redirect', config('services.spotify.redirect'));
    }

    /**
     * @return array{id: string, email: string, name: string, avatar: string|null}
     */
    public function fetchProfile(string $accessToken): array
    {
        $response = Http::withToken($accessToken)->get(self::API_URL.'/me');

        if ($response->failed()) {
            throw new RuntimeException('Spotify profile failed: '.$response->body());
        }

        $id = $response->json('id');
        $email = $response->json('email');
        $name = $response->json('display_name') ?: 'Spotify User';
        $images = $response->json('images');
        $avatar = null;
        if (is_array($images) && count($images) > 0) {
            $first = $images[0]['url'] ?? null;
            if (is_string($first) && $first !== '') {
                $avatar = $first;
            }
        }

        if (! is_string($id) || $id === '') {
            throw new RuntimeException('Spotify profile missing user id.');
        }

        if (! is_string($email) || $email === '') {
            throw new RuntimeException('Spotify profile missing email. Prüfe den Scope user-read-email.');
        }

        return [
            'id' => $id,
            'email' => $email,
            'name' => is_string($name) && $name !== '' ? $name : 'Spotify User',
            'avatar' => $avatar,
        ];
    }

    private function clientId(): string
    {
        return (string) config('services.spotify.client_id');
    }

    private function clientSecret(): string
    {
        return (string) config('services.spotify.client_secret');
    }

    private function redirectUri(): string
    {
        return (string) config('services.spotify.redirect');
    }
}
