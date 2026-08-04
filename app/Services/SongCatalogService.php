<?php

namespace App\Services;

use App\Models\Song;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class SongCatalogService
{
    /**
     * Find an existing catalog song by provider IDs or normalized title+artist.
     */
    public function findExisting(
        ?string $spotifyTrackId = null,
        ?string $title = null,
        ?string $artist = null,
    ): ?Song {
        if (filled($spotifyTrackId)) {
            $bySpotify = Song::query()->where('spotify_track_id', $spotifyTrackId)->first();
            if ($bySpotify) {
                return $bySpotify;
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
     *   spotify_track_id?: string|null,
     *   spotify_uri?: string|null,
     *   album_art_url?: string|null
     * }  $attributes
     * @return array{song: Song, created: bool}
     */
    public function createOrMerge(User $user, array $attributes): array
    {
        return DB::transaction(function () use ($user, $attributes) {
            $existing = $this->findExisting(
                $attributes['spotify_track_id'] ?? null,
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
                'spotify_track_id' => $attributes['spotify_track_id'] ?? null,
                'spotify_uri' => $attributes['spotify_uri'] ?? null,
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
        $updates = [];

        if (filled($attributes['spotify_track_id'] ?? null) && ! filled($song->spotify_track_id)) {
            $updates['spotify_track_id'] = $attributes['spotify_track_id'];
        }

        if (filled($attributes['spotify_uri'] ?? null) && ! filled($song->spotify_uri)) {
            $updates['spotify_uri'] = $attributes['spotify_uri'];
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
     */
    public function enrichFromPlayable(Song $song, string $provider, array $playable): void
    {
        if ($provider === 'spotify') {
            $this->mergeProviderData($song, [
                'spotify_track_id' => $playable['id'] ?? null,
                'spotify_uri' => $playable['uri'] ?? null,
                'album_art_url' => $playable['album_art_url'] ?? null,
            ]);
        }
    }

    private function normalize(?string $value): string
    {
        return mb_strtolower(trim((string) $value));
    }
}
