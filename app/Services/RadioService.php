<?php

namespace App\Services;

use App\Models\DiscoverySwipe;
use App\Models\Song;
use App\Models\User;
use Illuminate\Support\Collection;

class RadioService
{
    /**
     * Weighted random playable songs for radio continuation.
     *
     * @param  list<string>  $exclude
     * @return Collection<int, Song>
     */
    public function queue(?User $user, ?string $seedSongId, array $exclude, int $limit = 10): Collection
    {
        $limit = max(1, min($limit, 20));
        $exclude = array_values(array_unique(array_filter($exclude, fn ($id) => is_string($id) && $id !== '')));

        if ($seedSongId) {
            $exclude[] = $seedSongId;
            $exclude = array_values(array_unique($exclude));
        }

        $likedIds = [];
        $favoriteIds = [];
        $sameArtistIds = [];

        if ($user) {
            $disliked = DiscoverySwipe::query()
                ->where('user_id', $user->id)
                ->where('direction', DiscoverySwipe::DISLIKE)
                ->whereNotNull('song_id')
                ->pluck('song_id')
                ->all();

            $exclude = array_values(array_unique(array_merge($exclude, $disliked)));

            $likedIds = DiscoverySwipe::query()
                ->where('user_id', $user->id)
                ->where('direction', DiscoverySwipe::LIKE)
                ->whereNotNull('song_id')
                ->pluck('song_id')
                ->all();

            $favoriteIds = $user->favoriteSongs()->pluck('songs.id')->all();
        }

        $seed = $seedSongId
            ? Song::query()->with('artists')->find($seedSongId)
            : null;

        $seedArtistIds = $seed?->artists?->pluck('id')->filter()->values()->all() ?? [];
        $seedArtistName = filled($seed?->artist) ? (string) $seed->artist : null;

        if ($seedArtistIds !== [] || $seedArtistName) {
            $sameArtistQuery = Song::query()->playable();
            if ($exclude !== []) {
                $sameArtistQuery->whereNotIn('id', $exclude);
            }
            $sameArtistQuery->where(function ($builder) use ($seedArtistIds, $seedArtistName) {
                if ($seedArtistIds !== []) {
                    $builder->whereHas(
                        'artists',
                        fn ($artists) => $artists->whereIn('artists.id', $seedArtistIds),
                    );
                }
                if ($seedArtistName) {
                    $method = $seedArtistIds !== [] ? 'orWhere' : 'where';
                    $builder->{$method}('artist', $seedArtistName);
                }
            });
            $sameArtistIds = $sameArtistQuery->pluck('id')->all();
        }

        $likedSet = array_flip($likedIds);
        $favoriteSet = array_flip($favoriteIds);
        $sameArtistSet = array_flip($sameArtistIds);

        $poolQuery = Song::query()->playable()->select(['id', 'play_count']);
        if ($exclude !== []) {
            $poolQuery->whereNotIn('id', $exclude);
        }

        $pool = $poolQuery->get();
        if ($pool->isEmpty()) {
            return collect();
        }

        if ($pool->count() > 400) {
            $keep = [];
            foreach ([$likedIds, $favoriteIds, $sameArtistIds] as $bucket) {
                foreach ($bucket as $id) {
                    $keep[$id] = true;
                }
            }
            $popular = $pool->sortByDesc('play_count')->take(80)->pluck('id')->all();
            foreach ($popular as $id) {
                $keep[$id] = true;
            }
            $random = $pool->shuffle()->take(180)->pluck('id')->all();
            foreach ($random as $id) {
                $keep[$id] = true;
            }
            $pool = $pool->filter(fn (Song $song) => isset($keep[$song->id]))->values();
        }

        $weights = [];
        foreach ($pool as $song) {
            $weight = 1;
            if (isset($likedSet[$song->id])) {
                $weight += 8;
            }
            if (isset($favoriteSet[$song->id])) {
                $weight += 6;
            }
            if (isset($sameArtistSet[$song->id])) {
                $weight += 4;
            }
            $plays = (int) $song->play_count;
            if ($plays > 0) {
                $weight += min(4, (int) floor(log($plays + 1, 2)));
            }
            $weights[$song->id] = $weight;
        }

        $selected = $this->weightedSample(array_keys($weights), $weights, $limit);
        if ($selected === []) {
            return collect();
        }

        $order = array_flip($selected);

        return Song::query()
            ->with(['providers', 'artists'])
            ->whereIn('id', $selected)
            ->get()
            ->sortBy(fn (Song $song) => $order[$song->id] ?? 999)
            ->values()
            ->each(fn (Song $song) => $song->makeHidden('lyrics'));
    }

    /**
     * @param  list<string>  $ids
     * @param  array<string, int>  $weights
     * @return list<string>
     */
    private function weightedSample(array $ids, array $weights, int $limit): array
    {
        $remaining = [];
        foreach ($ids as $id) {
            $remaining[$id] = max(1, $weights[$id] ?? 1);
        }

        $picked = [];
        while ($remaining !== [] && count($picked) < $limit) {
            $total = array_sum($remaining);
            $roll = (mt_rand() / mt_getrandmax()) * $total;
            $acc = 0.0;
            $chosen = array_key_first($remaining);
            foreach ($remaining as $id => $weight) {
                $acc += $weight;
                if ($roll <= $acc) {
                    $chosen = $id;
                    break;
                }
            }
            $picked[] = $chosen;
            unset($remaining[$chosen]);
        }

        return $picked;
    }
}
