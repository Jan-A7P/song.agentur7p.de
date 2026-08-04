<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Song;
use App\Services\SongCatalogService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SongController extends Controller
{
    public function __construct(private SongCatalogService $catalog) {}

    public function index(Request $request): JsonResponse
    {
        $query = Song::query()
            ->with('user:id,name')
            ->latest();

        if ($search = $request->string('q')->trim()->toString()) {
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('title', 'like', "%{$search}%")
                    ->orWhere('artist', 'like', "%{$search}%");
            });
        }

        $songs = $query->paginate(20);

        return response()->json($songs);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $this->validateSong($request);
        $validated['lyrics'] = $validated['lyrics'] ?? '';

        $result = $this->catalog->createOrMerge($request->user(), $validated);

        return response()->json([
            'data' => $result['song'],
            'created' => $result['created'],
            'merged' => ! $result['created'],
        ], $result['created'] ? 201 : 200);
    }

    public function show(Song $song): JsonResponse
    {
        $song->load('user:id,name');

        return response()->json(['data' => $song]);
    }

    public function update(Request $request, Song $song): JsonResponse
    {
        $this->authorizeSong($request, $song);

        $validated = $this->validateSong($request);
        $validated['lyrics'] = $validated['lyrics'] ?? '';

        // Core fields update; provider IDs merge non-destructively so cross-links stay.
        $song->update([
            'title' => $validated['title'],
            'artist' => $validated['artist'],
            'lyrics' => $validated['lyrics'],
            'album_art_url' => $validated['album_art_url'] ?? $song->album_art_url,
        ]);

        $this->catalog->mergeProviderData($song, $validated);
        $song->load('user:id,name');

        return response()->json(['data' => $song->fresh()->load('user:id,name')]);
    }

    public function destroy(Request $request, Song $song): JsonResponse
    {
        $this->authorizeSong($request, $song);
        $song->delete();

        return response()->json(null, 204);
    }

    /**
     * @return array<string, mixed>
     */
    private function validateSong(Request $request): array
    {
        return $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'artist' => ['required', 'string', 'max:255'],
            'lyrics' => ['nullable', 'string'],
            'provider' => ['nullable', 'string', 'max:32'],
            'provider_track_id' => ['nullable', 'string', 'max:255'],
            'provider_uri' => ['nullable', 'string', 'max:255'],
            'album_art_url' => ['nullable', 'string', 'max:2048'],
        ]);
    }

    private function authorizeSong(Request $request, Song $song): void
    {
        abort_unless($song->user_id === $request->user()->id, 403, 'Nicht berechtigt.');
    }
}
