<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Song;
use App\Models\User;
use App\Services\RadioService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class RadioController extends Controller
{
    public function __construct(private RadioService $radio) {}

    public function queue(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'seed_song_id' => ['nullable', 'uuid'],
            'exclude' => ['sometimes'],
            'exclude.*' => ['string', 'uuid'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:20'],
        ]);

        $exclude = $validated['exclude'] ?? $request->input('exclude', []);
        if (! is_array($exclude)) {
            $exclude = is_string($exclude) && $exclude !== '' ? explode(',', $exclude) : [];
        }

        $user = $request->user();
        $songs = $this->radio->queue(
            $user,
            $validated['seed_song_id'] ?? null,
            $exclude,
            (int) ($validated['limit'] ?? 10),
        );

        $this->decorateSongs($songs, $user);

        return response()->json([
            'data' => $songs->values(),
        ]);
    }

    /**
     * @param  Collection<int, Song>  $songs
     */
    private function decorateSongs($songs, ?User $user): void
    {
        if ($songs->isEmpty()) {
            return;
        }

        $favSet = [];
        if ($user) {
            $favSet = array_flip(
                $user->favoriteSongs()
                    ->whereIn('songs.id', $songs->pluck('id'))
                    ->pluck('songs.id')
                    ->all(),
            );
        }

        foreach ($songs as $song) {
            $song->setAttribute('is_favorited', isset($favSet[$song->id]));
        }
    }
}
