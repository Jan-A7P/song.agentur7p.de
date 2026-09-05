<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class LyricsLookupService
{
    private const BASE_URL = 'https://lrclib.net/api';

    private const USER_AGENT = 'Songtexte/1.0 (https://song.artisan7p.de)';

    /**
     * @return array{lyrics: string, synced: bool, source: string}|null
     */
    public function lookup(string $title, string $artist, ?int $durationMs = null): ?array
    {
        $title = trim($title);
        $artist = trim($artist);

        if ($title === '' || $artist === '') {
            return null;
        }

        $durationSeconds = $durationMs !== null && $durationMs > 0
            ? (int) round($durationMs / 1000)
            : null;

        $record = $this->fetchExact($title, $artist, $durationSeconds)
            ?? $this->fetchSearch($title, $artist, $durationSeconds);

        if ($record === null) {
            return null;
        }

        return $this->extractLyrics($record);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function fetchExact(string $title, string $artist, ?int $durationSeconds): ?array
    {
        $query = [
            'track_name' => $title,
            'artist_name' => $artist,
        ];

        if ($durationSeconds !== null && $durationSeconds >= 1 && $durationSeconds <= 3600) {
            $query['duration'] = $durationSeconds;
        }

        try {
            $response = $this->client()->get(self::BASE_URL.'/get', $query);

            if ($response->status() === 404) {
                return null;
            }

            $response->throw();

            /** @var array<string, mixed> $data */
            $data = $response->json();

            return is_array($data) ? $data : null;
        } catch (RequestException) {
            return null;
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function fetchSearch(string $title, string $artist, ?int $durationSeconds): ?array
    {
        try {
            $response = $this->client()->get(self::BASE_URL.'/search', [
                'track_name' => $title,
                'artist_name' => $artist,
            ]);

            $response->throw();

            /** @var list<array<string, mixed>>|null $results */
            $results = $response->json();

            if (! is_array($results) || $results === []) {
                return null;
            }

            return $this->pickBestSearchResult($results, $title, $artist, $durationSeconds);
        } catch (RequestException) {
            return null;
        }
    }

    /**
     * @param  list<array<string, mixed>>  $results
     * @return array<string, mixed>|null
     */
    private function pickBestSearchResult(array $results, string $title, string $artist, ?int $durationSeconds): ?array
    {
        $titleNorm = mb_strtolower($title);
        $artistNorm = mb_strtolower($artist);

        usort($results, function (array $a, array $b) use ($titleNorm, $artistNorm, $durationSeconds) {
            return $this->scoreResult($b, $titleNorm, $artistNorm, $durationSeconds)
                <=> $this->scoreResult($a, $titleNorm, $artistNorm, $durationSeconds);
        });

        $best = $results[0] ?? null;

        return is_array($best) ? $best : null;
    }

    /**
     * @param  array<string, mixed>  $record
     */
    private function scoreResult(array $record, string $titleNorm, string $artistNorm, ?int $durationSeconds): int
    {
        $score = 0;
        $track = mb_strtolower((string) ($record['trackName'] ?? $record['name'] ?? ''));
        $artist = mb_strtolower((string) ($record['artistName'] ?? ''));

        if ($track === $titleNorm) {
            $score += 100;
        } elseif (str_contains($track, $titleNorm) || str_contains($titleNorm, $track)) {
            $score += 40;
        }

        if ($artist === $artistNorm) {
            $score += 80;
        } elseif (str_contains($artist, $artistNorm) || str_contains($artistNorm, $artist)) {
            $score += 30;
        }

        if (filled($record['syncedLyrics'] ?? null)) {
            $score += 20;
        } elseif (filled($record['plainLyrics'] ?? null)) {
            $score += 5;
        }

        if ($durationSeconds !== null && isset($record['duration'])) {
            $diff = abs((int) $record['duration'] - $durationSeconds);
            if ($diff <= 2) {
                $score += 50;
            } elseif ($diff <= 5) {
                $score += 20;
            }
        }

        return $score;
    }

    /**
     * @param  array<string, mixed>  $record
     * @return array{lyrics: string, synced: bool, source: string}|null
     */
    private function extractLyrics(array $record): ?array
    {
        if (! empty($record['instrumental'])) {
            throw new RuntimeException(__('Track is instrumental — no lyrics available.'));
        }

        $synced = trim((string) ($record['syncedLyrics'] ?? ''));
        if ($synced !== '') {
            return [
                'lyrics' => $synced,
                'synced' => true,
                'source' => 'lrclib',
            ];
        }

        $plain = trim((string) ($record['plainLyrics'] ?? ''));
        if ($plain !== '') {
            return [
                'lyrics' => $plain,
                'synced' => false,
                'source' => 'lrclib',
            ];
        }

        return null;
    }

    private function client(): PendingRequest
    {
        return Http::timeout(12)
            ->acceptJson()
            ->withHeaders([
                'User-Agent' => self::USER_AGENT,
                'Lrclib-Client' => self::USER_AGENT,
            ]);
    }
}
