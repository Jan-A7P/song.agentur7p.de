<?php

namespace App\Services;

use App\Enums\MusicProvider;
use App\Models\Song;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SongCatalogService
{
    /**
     * Find an existing catalog song by provider IDs or normalized title+artist.
     */
    public function findExisting(
        ?string $provider = null,
        ?string $providerTrackId = null,
        ?string $title = null,
        ?string $artist = null,
    ): ?Song {
        if (filled($provider) && filled($providerTrackId)) {
            $byProvider = Song::query()
                ->where('provider', $provider)
                ->where('provider_track_id', $providerTrackId)
                ->first();
            if ($byProvider) {
                return $byProvider;
            }
        }

        $title = $this->normalize($title);
        $artist = $this->normalize($artist);

        if ($title === '' || $artist === '') {
            return null;
        }

        return Song::query()
            ->whereRaw('LOWER(TRIM(title)) = ?', [$title])
            ->whereRaw('LOWER(TRIM(artist)) = ?', [$artist])
            ->first();
    }

    /**
     * Create a new song or return/merge into an existing unique catalog entry.
     *
     * @param  array{
     *   title: string,
     *   artist: string,
     *   lyrics?: string|null,
     *   provider?: string|null,
     *   provider_track_id?: string|null,
     *   provider_uri?: string|null,
     *   album_art_url?: string|null
     * }  $attributes
     * @return array{song: Song, created: bool}
     */
    public function createOrMerge(User $user, array $attributes): array
    {
        return DB::transaction(function () use ($user, $attributes) {
            $attributes = $this->normalizeProviderAttributes($attributes);

            $existing = $this->findExisting(
                $attributes['provider'] ?? null,
                $attributes['provider_track_id'] ?? null,
                $attributes['title'] ?? null,
                $attributes['artist'] ?? null,
            );

            if ($existing) {
                $this->mergeProviderData($existing, $attributes);

                return ['song' => $existing->fresh()->load('user:id,name'), 'created' => false];
            }

            $song = $user->songs()->create([
                'title' => $attributes['title'],
                'artist' => $attributes['artist'],
                'lyrics' => $attributes['lyrics'] ?? '',
                'provider' => $attributes['provider'] ?? null,
                'provider_track_id' => $attributes['provider_track_id'] ?? null,
                'provider_uri' => $attributes['provider_uri'] ?? null,
                'album_art_url' => $attributes['album_art_url'] ?? null,
            ]);

            return ['song' => $song->load('user:id,name'), 'created' => true];
        });
    }

    /**
     * Merge provider IDs / artwork / empty lyrics into an existing song (non-destructive).
     *
     * @param  array<string, mixed>  $attributes
     */
    public function mergeProviderData(Song $song, array $attributes): Song
    {
        $attributes = $this->normalizeProviderAttributes($attributes);
        $updates = [];

        $incomingProvider = $attributes['provider'] ?? null;
        $incomingTrackId = $attributes['provider_track_id'] ?? null;
        $incomingUri = $attributes['provider_uri'] ?? null;

        if (filled($incomingProvider) && filled($incomingTrackId) && ! filled($song->provider_track_id)) {
            $updates['provider'] = $incomingProvider;
            $updates['provider_track_id'] = $incomingTrackId;
        }

        if (filled($incomingUri) && ! filled($song->provider_uri)) {
            $updates['provider_uri'] = $incomingUri;
            if (filled($incomingProvider) && ! filled($song->provider)) {
                $updates['provider'] = $incomingProvider;
            }
        }

        if (filled($attributes['album_art_url'] ?? null) && ! filled($song->album_art_url)) {
            $updates['album_art_url'] = $attributes['album_art_url'];
        }

        $incomingLyrics = $attributes['lyrics'] ?? null;
        if (is_string($incomingLyrics) && trim($incomingLyrics) !== '' && trim((string) $song->lyrics) === '') {
            $updates['lyrics'] = $incomingLyrics;
        }

        if ($updates !== []) {
            $song->forceFill($updates)->save();
        }

        return $song;
    }

    /**
     * Persist a resolved playable ID onto the catalog song for future plays.
     *
     * @param  array{id?: string|null, uri?: string|null, album_art_url?: string|null}  $playable
     */
    public function enrichFromPlayable(Song $song, string $provider, array $playable): void
    {
        $this->mergeProviderData($song, [
            'provider' => $provider,
            'provider_track_id' => $playable['id'] ?? null,
            'provider_uri' => $playable['uri'] ?? null,
            'album_art_url' => $playable['album_art_url'] ?? null,
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function normalizeProviderAttributes(array $attributes): array
    {
        if (isset($attributes['provider']) && filled($attributes['provider'])) {
            $provider = strtolower((string) $attributes['provider']);
            $allowed = collect(MusicProvider::cases())->map->value->all();
            if (! in_array($provider, $allowed, true)) {
                throw ValidationException::withMessages([
                    'provider' => ['Unbekannter Musik-Anbieter.'],
                ]);
            }
            $attributes['provider'] = $provider;
        }

        // If track id/uri present without provider, default to spotify (current sole adapter).
        if (
            (! isset($attributes['provider']) || ! filled($attributes['provider']))
            && (filled($attributes['provider_track_id'] ?? null) || filled($attributes['provider_uri'] ?? null))
        ) {
            $attributes['provider'] = MusicProvider::Spotify->value;
        }

        return $attributes;
    }

    private function normalize(?string $value): string
    {
        return mb_strtolower(trim((string) $value));
    }
}
