<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Playlist;
use App\Models\Song;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PlaylistController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Playlist::query()
            ->with('user:id,name')
            ->withCount('songs')
            ->latest();

        if ($request->boolean('mine')) {
            $user = $request->user('web') ?? $request->user();
            abort_unless($user, 401);
            $query->where('user_id', $user->id);
        }

        return response()->json($query->paginate(20));
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
        ]);

        $playlist = $request->user()->playlists()->create($validated);
        $playlist->load('user:id,name');
        $playlist->loadCount('songs');

        return response()->json(['data' => $playlist], 201);
    }

    public function show(Request $request, Playlist $playlist): JsonResponse
    {
        $this->loadPlaylistDetail($playlist, $request->user('web') ?? $request->user());

        return response()->json(['data' => $playlist]);
    }

    public function update(Request $request, Playlist $playlist): JsonResponse
    {
        $this->authorizeOwner($request, $playlist);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
        ]);

        $playlist->update($validated);
        $playlist->load('user:id,name');
        $playlist->loadCount('songs');

        return response()->json(['data' => $playlist]);
    }

    public function destroy(Request $request, Playlist $playlist): JsonResponse
    {
        $this->authorizeOwner($request, $playlist);
        $playlist->delete();

        return response()->json(null, 204);
    }

    public function addSong(Request $request, Playlist $playlist): JsonResponse
    {
        $this->authorizeOwner($request, $playlist);

        $validated = $request->validate([
            'song_id' => ['required', 'uuid', 'exists:songs,id'],
        ]);

        if ($playlist->songs()->where('song_id', $validated['song_id'])->exists()) {
            return response()->json(['message' => __('Song already in playlist.')], 422);
        }

        $position = (int) $playlist->songs()->max('playlist_song.position') + 1;

        $playlist->songs()->attach($validated['song_id'], ['position' => $position]);

        return $this->show($request, $playlist);
    }

    public function removeSong(Request $request, Playlist $playlist, Song $song): JsonResponse
    {
        $this->authorizeOwner($request, $playlist);

        $playlist->songs()->detach($song->id);

        $this->normalizePositions($playlist);

        return $this->show($request, $playlist);
    }

    public function reorder(Request $request, Playlist $playlist): JsonResponse
    {
        $this->authorizeOwner($request, $playlist);

        $validated = $request->validate([
            'song_ids' => ['required', 'array', 'min:1'],
            'song_ids.*' => ['uuid', 'distinct', 'exists:songs,id'],
        ]);

        $existingIds = $playlist->songs()->pluck('songs.id')->all();
        $incomingIds = $validated['song_ids'];

        sort($existingIds);
        $sortedIncoming = $incomingIds;
        sort($sortedIncoming);

        if ($existingIds !== $sortedIncoming) {
            return response()->json([
                'message' => __('Playlist song list mismatch.'),
            ], 422);
        }

        DB::transaction(function () use ($playlist, $incomingIds) {
            foreach ($incomingIds as $index => $songId) {
                $playlist->songs()->updateExistingPivot($songId, [
                    'position' => $index + 1,
                ]);
            }
        });

        return $this->show($request, $playlist);
    }

    private function loadPlaylistDetail(Playlist $playlist, ?User $user): void
    {
        $playlist->load([
            'user:id,name',
            'songs' => function ($query) use ($user) {
                $query->with('providers');

                if ($user) {
                    $query->withExists([
                        'favoritedBy as is_favorited' => fn ($builder) => $builder->where('users.id', $user->id),
                    ]);
                }
            },
        ]);
        $playlist->loadCount('songs');

        if (! $user) {
            foreach ($playlist->songs as $song) {
                $song->setAttribute('is_favorited', false);
            }
        }
    }

    private function authorizeOwner(Request $request, Playlist $playlist): void
    {
        abort_unless($playlist->user_id === $request->user()->id, 403, __('Not authorized.'));
    }

    private function normalizePositions(Playlist $playlist): void
    {
        $songIds = $playlist->songs()->pluck('songs.id');

        foreach ($songIds as $index => $songId) {
            $playlist->songs()->updateExistingPivot($songId, [
                'position' => $index + 1,
            ]);
        }
    }
}
