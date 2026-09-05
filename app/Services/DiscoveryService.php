<?php

namespace App\Services;

use App\Enums\MusicProvider;
use App\Models\DiscoverySwipe;
use App\Models\Song;
use App\Models\SongProvider;
use App\Models\User;
use Illuminate\Support\Collection;
use Throwable;

class DiscoveryService
{
    public function __construct(
        private SongCatalogService $catalog,
        private SpotifyService $spotify,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function feed(User $user, int $limit = 12): array
    {
        $limit = max(4, min($limit, 24));

        $swipedSongIds = DiscoverySwipe::query()
            ->where('user_id', $user->id)
            ->whereNotNull('song_id')
            ->pluck('song_id')
            ->all();

        $swipedSpotifyIds = DiscoverySwipe::query()
            ->where('user_id', $user->id)
            ->where('provider', MusicProvider::Spotify->value)
            ->whereNotNull('provider_track_id')
            ->pluck('provider_track_id')
            ->all();

        $catalogSongs = Song::query()
            ->playable()
            ->with(['providers', 'artists'])
            ->when($swipedSongIds !== [], fn ($query) => $query->whereNotIn('id', $swipedSongIds))
            ->inRandomOrder()
            ->limit((int) ceil($limit * 0.7) + 4)
            ->get();

        $catalogSongs->each(fn (Song $song) => $song->makeHidden('lyrics'));

        $this->decorateSongs($catalogSongs, $user);

        $spotifyCards = $this->spotifySuggestions($user, $swipedSpotifyIds, $swipedSongIds, max(4, $limit - $catalogSongs->count()));

        $catalogCards = $catalogSongs->map(fn (Song $song) => [
            'id' => $song->id,
            'source' => 'catalog',
            'song' => $song,
            'spotify' => null,
        ])->all();

        return $this->interleave($catalogCards, $spotifyCards, $limit);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{swipe: DiscoverySwipe, song: Song|null, created: bool}
     */
    public function swipe(User $user, array $payload): array
    {
        $direction = $payload['direction'] === DiscoverySwipe::DISLIKE
            ? DiscoverySwipe::DISLIKE
            : DiscoverySwipe::LIKE;

        $song = null;
        $created = false;
        $provider = isset($payload['provider']) ? (string) $payload['provider'] : null;
        $providerTrackId = isset($payload['provider_track_id']) ? (string) $payload['provider_track_id'] : null;

        if (! empty($payload['song_id'])) {
            $song = Song::query()->with(['providers', 'artists'])->find($payload['song_id']);
        }

        if (! $song && $provider && $providerTrackId) {
            $song = $this->catalog->findExisting(
                $provider,
                $providerTrackId,
                $payload['title'] ?? null,
                $payload['artist'] ?? null,
            );
            $song?->load(['providers', 'artists']);
        }

        $artUrl = is_string($payload['album_art_url'] ?? null)
            ? mb_substr($payload['album_art_url'], 0, 2048)
            : null;
        $durationMs = isset($payload['duration_ms']) ? (int) $payload['duration_ms'] : null;
        $title = trim((string) ($payload['title'] ?? ''));
        $artist = trim((string) ($payload['artist'] ?? ''));

        if ($direction === DiscoverySwipe::LIKE && $song && $provider && $providerTrackId) {
            $this->catalog->mergeProviderData($song, [
                'title' => $title !== '' ? $title : $song->title,
                'artist' => $artist !== '' ? $artist : $song->artist,
                'duration_ms' => $durationMs && $durationMs > 0 ? $durationMs : null,
                'provider' => $provider,
                'preferred_provider' => $provider,
                'provider_track_id' => $providerTrackId,
                'provider_uri' => (string) ($payload['provider_uri'] ?? ''),
                'album_art_url' => $artUrl,
            ]);
            $song = $song->fresh()->load(['providers', 'artists']);
        }

        if ($direction === DiscoverySwipe::LIKE && ! $song && $provider && $providerTrackId) {
            $result = $this->catalog->createOrMerge($user, [
                'title' => mb_substr($title !== '' ? $title : 'Unbekannter Titel', 0, 255),
                'artist' => mb_substr($artist !== '' ? $artist : 'Unbekannt', 0, 255),
                'lyrics' => '',
                'duration_ms' => $durationMs && $durationMs > 0 ? $durationMs : null,
                'provider' => $provider,
                'preferred_provider' => $provider,
                'provider_track_id' => $providerTrackId,
                'provider_uri' => (string) ($payload['provider_uri'] ?? ''),
                'album_art_url' => $artUrl,
            ]);
            $song = $result['song'];
            $created = $result['created'];
        }

        if ($song) {
            if ($direction === DiscoverySwipe::LIKE) {
                $user->favoriteSongs()->syncWithoutDetaching([$song->id]);
            }

            $link = $song->linkFor($provider) ?? $song->providers->first();
            $swipe = DiscoverySwipe::query()->updateOrCreate(
                [
                    'user_id' => $user->id,
                    'song_id' => $song->id,
                ],
                [
                    'direction' => $direction,
                    'provider' => $provider ?? $link?->provider,
                    'provider_track_id' => $providerTrackId ?? $link?->provider_track_id,
                ],
            );
            $this->decorateSongs(collect([$song]), $user);

            return ['swipe' => $swipe, 'song' => $song, 'created' => $created];
        }

        $swipe = DiscoverySwipe::query()->updateOrCreate(
            [
                'user_id' => $user->id,
                'provider' => $provider ?: MusicProvider::Spotify->value,
                'provider_track_id' => $providerTrackId,
            ],
            [
                'direction' => $direction,
                'song_id' => null,
            ],
        );

        return ['swipe' => $swipe, 'song' => null, 'created' => false];
    }

    /**
     * @param  list<string>  $swipedSpotifyIds
     * @param  list<string>  $swipedSongIds
     * @return list<array<string, mixed>>
     */
    private function spotifySuggestions(User $user, array $swipedSpotifyIds, array $swipedSongIds, int $limit): array
    {
        if ($limit <= 0) {
            return [];
        }

        $seedArtists = $this->seedArtistNames($user);
        if ($seedArtists === []) {
            return [];
        }

        $knownSpotifyIds = SongProvider::query()
            ->where('provider', MusicProvider::Spotify->value)
            ->pluck('provider_track_id')
            ->filter()
            ->all();

        $legacyIds = Song::query()
            ->where('provider', MusicProvider::Spotify->value)
            ->whereNotNull('provider_track_id')
            ->pluck('provider_track_id')
            ->all();

        $blocked = array_flip(array_merge($swipedSpotifyIds, $knownSpotifyIds, $legacyIds));
        $cards = [];
        $seen = [];

        foreach ($seedArtists as $artist) {
            if (count($cards) >= $limit) {
                break;
            }

            $query = 'artist:"'.str_replace('"', '', $artist).'"';

            try {
                $tracks = $this->spotify->searchTracks($query, 10);
            } catch (Throwable) {
                continue;
            }

            foreach ($tracks as $track) {
                $id = (string) ($track['id'] ?? '');
                if ($id === '' || isset($blocked[$id]) || isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                $cards[] = [
                    'id' => 'spotify:'.$id,
                    'source' => 'spotify',
                    'song' => null,
                    'spotify' => [
                        'id' => $id,
                        'uri' => $track['uri'],
                        'name' => $track['name'],
                        'artist' => $track['artist'],
                        'album_art_url' => $track['album_art_url'],
                        'duration_ms' => $track['duration_ms'] ?? null,
                    ],
                ];
                if (count($cards) >= $limit) {
                    break;
                }
            }
        }

        return $cards;
    }

    /**
     * @return list<string>
     */
    private function seedArtistNames(User $user): array
    {
        $names = collect();

        $names = $names->merge(
            $user->favoriteSongs()->limit(12)->pluck('artist'),
        );

        $likedSongIds = DiscoverySwipe::query()
            ->where('user_id', $user->id)
            ->where('direction', DiscoverySwipe::LIKE)
            ->whereNotNull('song_id')
            ->pluck('song_id')
            ->all();

        if ($likedSongIds !== []) {
            $names = $names->merge(
                Song::query()->whereIn('id', $likedSongIds)->pluck('artist'),
            );
        }

        $names = $names->merge(
            $user->songPlays()
                ->with('song:id,artist')
                ->latest()
                ->limit(20)
                ->get()
                ->pluck('song.artist'),
        );

        return $names
            ->filter(fn ($name) => is_string($name) && trim($name) !== '')
            ->map(fn (string $name) => trim(explode(',', $name)[0]))
            ->unique(fn (string $name) => mb_strtolower($name))
            ->take(6)
            ->values()
            ->all();
    }

    /**
     * @param  list<array<string, mixed>>  $catalog
     * @param  list<array<string, mixed>>  $spotify
     * @return list<array<string, mixed>>
     */
    private function interleave(array $catalog, array $spotify, int $limit): array
    {
        $out = [];
        $i = 0;
        $j = 0;
        $toggle = true;

        while (count($out) < $limit && ($i < count($catalog) || $j < count($spotify))) {
            if ($toggle && $i < count($catalog)) {
                $out[] = $catalog[$i];
                $i++;
            } elseif (! $toggle && $j < count($spotify)) {
                $out[] = $spotify[$j];
                $j++;
            } elseif ($i < count($catalog)) {
                $out[] = $catalog[$i];
                $i++;
            } elseif ($j < count($spotify)) {
                $out[] = $spotify[$j];
                $j++;
            }
            $toggle = ! $toggle;
        }

        return $out;
    }

    /**
     * @param  Collection<int, Song>  $songs
     */
    private function decorateSongs(Collection $songs, User $user): void
    {
        if ($songs->isEmpty()) {
            return;
        }

        $favoriteIds = $user->favoriteSongs()
            ->whereIn('songs.id', $songs->pluck('id'))
            ->pluck('songs.id')
            ->all();
        $favSet = array_flip($favoriteIds);

        foreach ($songs as $song) {
            $song->setAttribute('is_favorited', isset($favSet[$song->id]));
        }
    }
}
