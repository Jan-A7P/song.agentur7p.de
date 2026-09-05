<?php

namespace App\Services;

use App\Models\Artist;
use App\Models\Song;
use Illuminate\Support\Str;

class ArtistService
{
    /**
     * Split a denormalized artist string into individual display names.
     *
     * @return list<string>
     */
    public function parseNames(?string $artist): array
    {
        $artist = trim((string) $artist);
        if ($artist === '') {
            return [];
        }

        $normalized = preg_replace('/\s+(?:feat\.?|ft\.?|featuring)\s+/iu', ', ', $artist) ?? $artist;
        $normalized = preg_replace('/\s+&\s+/u', ', ', $normalized) ?? $normalized;
        $normalized = preg_replace('/\s+x\s+/iu', ', ', $normalized) ?? $normalized;

        $parts = preg_split('/\s*[,;\/]\s*/u', $normalized) ?: [];

        $names = [];
        $seen = [];

        foreach ($parts as $part) {
            $name = trim($part);
            $name = trim($name, " \t\n\r\0\x0B-–—");
            if ($name === '') {
                continue;
            }

            $key = $this->normalizeName($name);
            if ($key === '' || isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $names[] = $name;
        }

        return $names;
    }

    public function findOrCreate(string $name): Artist
    {
        $name = trim($name);
        $normalized = $this->normalizeName($name);

        $existing = Artist::query()->where('normalized_name', $normalized)->first();
        if ($existing) {
            return $existing;
        }

        return Artist::query()->create([
            'name' => mb_substr($name, 0, 255),
            'slug' => $this->uniqueSlug($name),
            'normalized_name' => $normalized,
        ]);
    }

    /**
     * Parse the song's artist string and sync the pivot relations.
     * Keeps the denormalized `songs.artist` column as the joined display string.
     */
    public function syncSongArtists(Song $song, ?string $artistString = null): Song
    {
        $raw = $artistString ?? (string) $song->artist;
        $names = $this->parseNames($raw);

        if ($names === []) {
            $song->artists()->detach();

            return $song;
        }

        $sync = [];
        foreach ($names as $index => $name) {
            $artist = $this->findOrCreate($name);
            $sync[$artist->id] = ['position' => $index];
        }

        $song->artists()->sync($sync);

        $joined = implode(', ', $names);
        if ($song->artist !== $joined) {
            $song->forceFill(['artist' => $joined])->save();
        }

        return $song->load('artists');
    }

    public function normalizeName(string $name): string
    {
        $name = mb_strtolower(trim($name));
        $name = preg_replace('/\s+/u', ' ', $name) ?? $name;

        return mb_substr($name, 0, 255);
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name);
        if ($base === '') {
            $base = 'artist';
        }

        $slug = $base;
        $suffix = 2;

        while (Artist::query()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$suffix;
            $suffix++;
        }

        return mb_substr($slug, 0, 255);
    }
}
