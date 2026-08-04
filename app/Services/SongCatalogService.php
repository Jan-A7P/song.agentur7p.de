<?php

namespace App\Services;

use App\Enums\MusicProvider;
use App\Models\Song;
use App\Models\SongProvider;
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
            $byLink = SongProvider::query()
                ->where('provider', $provider)
                ->where('provider_track_id', $providerTrackId)
                ->first();
            if ($byLink) {
                return Song::query()->find($byLink->song_id);
            }

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
     * @param  array{
     *   title: string,
     *   artist: string,
     *   lyrics?: string|null,
     *   provider?: string|null,
     *   preferred_provider?: string|null,
     *   provider_track_id?: string|null,
     *   provider_uri?: string|null,
     *   album_art_url?: string|null,
     *   providers?: list<array{provider: string, provider_track_id: string, provider_uri: string, album_art_url?: string|null}>
     * }  $attributes
     * @return array{song: Song, created: bool}
     */
    public function createOrMerge(User $user, array $attributes): array
    {
        return DB::transaction(function () use ($user, $attributes) {
            $attributes = $this->normalizeProviderAttributes($attributes);
            $links = $this->extractProviderLinks($attributes);

            $lookupProvider = $attributes['provider'] ?? ($links[0]['provider'] ?? null);
            $lookupTrackId = $attributes['provider_track_id'] ?? ($links[0]['provider_track_id'] ?? null);

            $existing = $this->findExisting(
                $lookupProvider,
                $lookupTrackId,
                $attributes['title'] ?? null,
                $attributes['artist'] ?? null,
            );

            if ($existing) {
                $this->mergeProviderData($existing, $attributes);

                return ['song' => $existing->fresh()->load(['user:id,name', 'providers']), 'created' => false];
            }

            $song = $user->songs()->create([
                'title' => $attributes['title'],
                'artist' => $attributes['artist'],
                'lyrics' => $attributes['lyrics'] ?? '',
                'provider' => null,
                'preferred_provider' => $attributes['preferred_provider'] ?? null,
                'provider_track_id' => null,
                'provider_uri' => null,
                'album_art_url' => $attributes['album_art_url'] ?? null,
            ]);

            foreach ($links as $link) {
                $this->upsertProviderLink($song, $link);
            }

            if ($links === [] && filled($attributes['provider'] ?? null) && filled($attributes['provider_track_id'] ?? null)) {
                $this->upsertProviderLink($song, [
                    'provider' => (string) $attributes['provider'],
                    'provider_track_id' => (string) $attributes['provider_track_id'],
                    'provider_uri' => (string) ($attributes['provider_uri'] ?? ''),
                    'album_art_url' => $attributes['album_art_url'] ?? null,
                ]);
            }

            $this->syncPrimaryFromPreferred($song->fresh());

            return ['song' => $song->fresh()->load(['user:id,name', 'providers']), 'created' => true];
        });
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function mergeProviderData(Song $song, array $attributes): Song
    {
        $attributes = $this->normalizeProviderAttributes($attributes);
        $links = $this->extractProviderLinks($attributes);

        foreach ($links as $link) {
            $this->upsertProviderLink($song, $link);
        }

        // Legacy single-provider payload: add/merge without wiping other links.
        if (
            $links === []
            && filled($attributes['provider'] ?? null)
            && filled($attributes['provider_track_id'] ?? null)
            && filled($attributes['provider_uri'] ?? null)
        ) {
            $this->upsertProviderLink($song, [
                'provider' => (string) $attributes['provider'],
                'provider_track_id' => (string) $attributes['provider_track_id'],
                'provider_uri' => (string) $attributes['provider_uri'],
                'album_art_url' => $attributes['album_art_url'] ?? null,
            ]);
        }

        $updates = [];

        if (array_key_exists('preferred_provider', $attributes)) {
            $preferred = $attributes['preferred_provider'];
            $updates['preferred_provider'] = filled($preferred) ? strtolower((string) $preferred) : null;
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

        $this->syncPrimaryFromPreferred($song->fresh());

        return $song->fresh()->load('providers');
    }

    /**
     * Replace all provider links (used on explicit song update with providers array).
     *
     * @param  list<array{provider: string, provider_track_id: string, provider_uri: string, album_art_url?: string|null}>  $links
     */
    public function syncProviderLinks(Song $song, array $links, ?string $preferredProvider = null): Song
    {
        return DB::transaction(function () use ($song, $links, $preferredProvider) {
            $normalized = [];
            foreach ($links as $link) {
                $row = $this->normalizeProviderAttributes($link);
                if (! filled($row['provider'] ?? null) || ! filled($row['provider_track_id'] ?? null) || ! filled($row['provider_uri'] ?? null)) {
                    continue;
                }
                $normalized[] = [
                    'provider' => (string) $row['provider'],
                    'provider_track_id' => (string) $row['provider_track_id'],
                    'provider_uri' => (string) $row['provider_uri'],
                    'album_art_url' => $row['album_art_url'] ?? null,
                ];
            }

            $keep = collect($normalized)->pluck('provider')->all();
            $song->providers()->whereNotIn('provider', $keep ?: ['__none__'])->delete();

            foreach ($normalized as $link) {
                $this->upsertProviderLink($song, $link);
            }

            $preferred = $preferredProvider;
            if ($preferred === null && $normalized !== []) {
                $preferred = $normalized[0]['provider'];
            }
            if ($preferred !== null && ! in_array($preferred, $keep, true)) {
                $preferred = $normalized[0]['provider'] ?? null;
            }

            $song->forceFill([
                'preferred_provider' => $preferred,
            ])->save();

            $this->syncPrimaryFromPreferred($song->fresh());

            return $song->fresh()->load('providers');
        });
    }

    public function markLastWorking(Song $song, string $provider): Song
    {
        $provider = strtolower($provider);
        $allowed = collect(MusicProvider::cases())->map->value->all();
        if (! in_array($provider, $allowed, true)) {
            throw ValidationException::withMessages([
                'provider' => ['Unbekannter Musik-Anbieter.'],
            ]);
        }

        if (! $song->linkFor($provider)) {
            throw ValidationException::withMessages([
                'provider' => ['Dieser Provider ist für den Song nicht verknüpft.'],
            ]);
        }

        // Never overwrite the user's preferred provider — only remember what last worked.
        $song->forceFill([
            'last_working_provider' => $provider,
        ])->save();

        return $song->fresh()->load('providers');
    }

    /**
     * Persist a resolved playable ID onto the catalog song for future plays.
     *
     * @param  array{id?: string|null, uri?: string|null, album_art_url?: string|null}  $playable
     */
    public function enrichFromPlayable(Song $song, string $provider, array $playable): void
    {
        $provider = strtolower($provider);

        $this->upsertProviderLink($song, [
            'provider' => $provider,
            'provider_track_id' => (string) ($playable['id'] ?? ''),
            'provider_uri' => (string) ($playable['uri'] ?? ''),
            'album_art_url' => $playable['album_art_url'] ?? null,
        ]);

        $song->forceFill([
            'last_working_provider' => $provider,
        ])->save();

        // Only set preferred when the song has none yet — never steal the user's choice.
        $fresh = $song->fresh();
        if ($fresh && ! filled($fresh->preferred_provider)) {
            $fresh->forceFill(['preferred_provider' => $provider])->save();
        }

        $this->syncPrimaryFromPreferred($song->fresh());
    }

    /**
     * @param  array{provider: string, provider_track_id: string, provider_uri: string, album_art_url?: string|null}  $link
     */
    public function upsertProviderLink(Song $song, array $link): SongProvider
    {
        if (! filled($link['provider']) || ! filled($link['provider_track_id']) || ! filled($link['provider_uri'])) {
            throw ValidationException::withMessages([
                'providers' => ['Provider-Link unvollständig.'],
            ]);
        }

        $provider = strtolower((string) $link['provider']);
        $allowed = collect(MusicProvider::cases())->map->value->all();
        if (! in_array($provider, $allowed, true)) {
            throw ValidationException::withMessages([
                'providers' => ['Unbekannter Musik-Anbieter.'],
            ]);
        }

        // Move uniqueness conflicts from other songs onto this catalog entry by deleting foreign dupes.
        SongProvider::query()
            ->where('provider', $provider)
            ->where('provider_track_id', $link['provider_track_id'])
            ->where('song_id', '!=', $song->id)
            ->delete();

        return SongProvider::query()->updateOrCreate(
            [
                'song_id' => $song->id,
                'provider' => $provider,
            ],
            [
                'provider_track_id' => (string) $link['provider_track_id'],
                'provider_uri' => (string) $link['provider_uri'],
                'album_art_url' => $link['album_art_url'] ?? null,
            ],
        );
    }

    public function syncPrimaryFromPreferred(Song $song): void
    {
        $song->load('providers');
        $preferred = $song->preferred_provider;
        $link = $song->linkFor($preferred) ?? $song->providers->first();

        if (! $link) {
            $song->forceFill([
                'provider' => null,
                'provider_track_id' => null,
                'provider_uri' => null,
                'preferred_provider' => null,
            ])->save();

            return;
        }

        $song->forceFill([
            'provider' => $link->provider,
            'provider_track_id' => $link->provider_track_id,
            'provider_uri' => $link->provider_uri,
            'preferred_provider' => $song->preferred_provider ?: $link->provider,
            'album_art_url' => $song->album_art_url ?: $link->album_art_url,
        ])->save();
    }

    /**
     * @param  array<string, mixed>  $attributes
     * @return list<array{provider: string, provider_track_id: string, provider_uri: string, album_art_url?: string|null}>
     */
    private function extractProviderLinks(array $attributes): array
    {
        $raw = $attributes['providers'] ?? null;
        if (! is_array($raw)) {
            return [];
        }

        $links = [];
        foreach ($raw as $row) {
            if (! is_array($row)) {
                continue;
            }
            $normalized = $this->normalizeProviderAttributes($row);
            if (! filled($normalized['provider'] ?? null) || ! filled($normalized['provider_track_id'] ?? null) || ! filled($normalized['provider_uri'] ?? null)) {
                continue;
            }
            $links[] = [
                'provider' => (string) $normalized['provider'],
                'provider_track_id' => (string) $normalized['provider_track_id'],
                'provider_uri' => (string) $normalized['provider_uri'],
                'album_art_url' => $normalized['album_art_url'] ?? null,
            ];
        }

        return $links;
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

        if (isset($attributes['preferred_provider']) && filled($attributes['preferred_provider'])) {
            $preferred = strtolower((string) $attributes['preferred_provider']);
            $allowed = collect(MusicProvider::cases())->map->value->all();
            if (! in_array($preferred, $allowed, true)) {
                throw ValidationException::withMessages([
                    'preferred_provider' => ['Unbekannter Musik-Anbieter.'],
                ]);
            }
            $attributes['preferred_provider'] = $preferred;
        }

        if (
            (! isset($attributes['provider']) || ! filled($attributes['provider']))
            && (filled($attributes['provider_track_id'] ?? null) || filled($attributes['provider_uri'] ?? null))
        ) {
            $uri = (string) ($attributes['provider_uri'] ?? '');
            $attributes['provider'] = str_starts_with($uri, 'tidal:')
                ? MusicProvider::Tidal->value
                : MusicProvider::Spotify->value;
        }

        return $attributes;
    }

    private function normalize(?string $value): string
    {
        return mb_strtolower(trim((string) $value));
    }
}
