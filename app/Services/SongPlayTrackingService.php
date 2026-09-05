<?php

namespace App\Services;

use App\Models\Song;
use App\Models\SongPlay;
use App\Models\User;

class SongPlayTrackingService
{
    /**
     * @param  array{provider?: string|null, duration_ms?: int|null}  $meta
     */
    public function start(User $user, Song $song, array $meta = []): SongPlay
    {
        $durationMs = $this->normalizeDuration($meta['duration_ms'] ?? null) ?? $song->duration_ms;

        $play = SongPlay::query()->create([
            'user_id' => $user->id,
            'song_id' => $song->id,
            'provider' => $meta['provider'] ?? null,
            'duration_ms' => $durationMs,
            'listened_ms' => 0,
            'completed' => false,
        ]);

        $songUpdate = [
            'last_played_at' => now(),
        ];
        // Never overwrite a known catalog duration — play progress can race across track switches.
        if ($durationMs && (! $song->duration_ms || $song->duration_ms <= 0)) {
            $songUpdate['duration_ms'] = $durationMs;
        }

        Song::query()->whereKey($song->id)->increment('play_count', 1, $songUpdate);

        return $play;
    }

    public function updateProgress(
        User $user,
        SongPlay $play,
        int $listenedMs,
        bool $completed = false,
        ?int $durationMs = null,
    ): SongPlay {
        abort_unless($play->user_id === $user->id, 403, __('Not authorized.'));

        $listenedMs = max(0, $listenedMs);
        $previous = (int) $play->listened_ms;
        $normalizedDuration = $this->normalizeDuration($durationMs);
        $effectiveDuration = $normalizedDuration ?? $play->duration_ms;

        if ($effectiveDuration && $listenedMs > $effectiveDuration) {
            $listenedMs = $effectiveDuration;
        }

        $next = max($previous, $listenedMs);
        $delta = $next - $previous;

        $markCompleted = $completed;
        if (! $markCompleted && $effectiveDuration && $effectiveDuration > 0) {
            $markCompleted = $next >= (int) round($effectiveDuration * 0.9);
        }

        $play->forceFill([
            'listened_ms' => $next,
            'completed' => $play->completed || $markCompleted,
            'duration_ms' => $effectiveDuration ?? $play->duration_ms,
        ])->save();

        if ($delta > 0) {
            Song::query()->whereKey($play->song_id)->increment('total_listen_ms', $delta);
        }

        if ($normalizedDuration) {
            Song::query()
                ->whereKey($play->song_id)
                ->where(function ($query) {
                    $query->whereNull('duration_ms')
                        ->orWhere('duration_ms', '<=', 0);
                })
                ->update(['duration_ms' => $normalizedDuration]);
        }

        return $play->fresh();
    }

    private function normalizeDuration(mixed $durationMs): ?int
    {
        if ($durationMs === null) {
            return null;
        }

        $value = (int) $durationMs;

        return $value > 0 ? $value : null;
    }
}
