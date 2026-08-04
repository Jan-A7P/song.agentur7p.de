<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SongCatalogService;
use App\Services\SpotifyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Throwable;

class SpotifyController extends Controller
{
    public function __construct(
        private SpotifyService $spotify,
        private SongCatalogService $catalog,
    ) {}

    public function token(Request $request): JsonResponse
    {
        try {
            $accessToken = $this->spotify->getAccessToken($request->user());
        } catch (Throwable $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'spotify_connected' => false,
            ], 400);
        }

        return response()->json([
            'access_token' => $accessToken,
            'spotify_connected' => true,
        ]);
    }

    public function search(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'q' => ['required', 'string', 'min:1', 'max:200'],
        ]);

        if (! $this->spotify->isConfigured()) {
            return response()->json(['message' => 'Spotify is not configured.', 'tracks' => []], 503);
        }

        try {
            $tracks = $this->spotify->searchTracks($validated['q']);
        } catch (Throwable $e) {
            return response()->json(['message' => $e->getMessage(), 'tracks' => []], 502);
        }

        return response()->json(['tracks' => $tracks]);
    }

    public function play(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'uri' => ['required', 'string', 'regex:/^spotify:(track|episode):/'],
            'device_id' => ['required', 'string'],
            'position_ms' => ['nullable', 'integer', 'min:0'],
        ]);

        try {
            $this->spotify->playUri(
                $request->user(),
                $validated['uri'],
                $validated['device_id'],
                (int) ($validated['position_ms'] ?? 0),
            );
        } catch (Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }

        return response()->json(['ok' => true]);
    }

    public function status(Request $request): JsonResponse
    {
        return response()->json([
            'configured' => $this->spotify->isConfigured(),
            'connected' => $request->user()->hasSpotifyConnected(),
        ]);
    }

    public function disconnect(Request $request): JsonResponse
    {
        $this->spotify->disconnect($request->user());

        return response()->json([
            'connected' => false,
            'message' => 'Spotify disconnected',
        ]);
    }

    public function playlists(Request $request): JsonResponse
    {
        if (! $this->spotify->isConfigured()) {
            return response()->json(['message' => 'Spotify is not configured.', 'playlists' => []], 503);
        }

        try {
            $playlists = $this->spotify->getUserPlaylists($request->user());
        } catch (Throwable $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'playlists' => [],
                'needs_reconnect' => true,
            ], 502);
        }

        return response()->json(['playlists' => $playlists]);
    }

    public function importPlaylist(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'spotify_playlist_id' => ['required', 'string', 'max:128'],
        ]);

        $user = $request->user();

        try {
            $spotifyPlaylists = $this->spotify->getUserPlaylists($user);
            $meta = collect($spotifyPlaylists)->firstWhere('id', $validated['spotify_playlist_id']);

            if (! $meta) {
                // Fallback: still try tracks; name unknown
                $meta = [
                    'id' => $validated['spotify_playlist_id'],
                    'name' => 'Spotify Playlist',
                    'description' => null,
                ];
            }

            $tracks = $this->spotify->getPlaylistTracks($user, $validated['spotify_playlist_id']);
        } catch (Throwable $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'needs_reconnect' => true,
            ], 502);
        }

        if (count($tracks) === 0) {
            return response()->json([
                'message' => 'Keine importierbaren Tracks. In Spotify Dev Mode können nur eigene oder kollaborative Playlists importiert werden.',
            ], 422);
        }

        try {
            $playlist = DB::transaction(function () use ($user, $meta, $tracks) {
                $playlist = $user->playlists()->create([
                    'name' => $meta['name'] ?: 'Spotify Playlist',
                    'description' => $meta['description'] ?? null,
                ]);

                $attach = [];
                $position = 1;

                foreach ($tracks as $track) {
                    $result = $this->catalog->createOrMerge($user, [
                        'title' => mb_substr($track['name'], 0, 255),
                        'artist' => mb_substr($track['artist'], 0, 255),
                        'lyrics' => '',
                        'spotify_track_id' => $track['id'],
                        'spotify_uri' => $track['uri'],
                        'album_art_url' => $track['album_art_url'],
                    ]);
                    $song = $result['song'];

                    if (! isset($attach[$song->id])) {
                        $attach[$song->id] = ['position' => $position];
                        $position++;
                    }
                }

                if ($attach === []) {
                    throw new \RuntimeException('Keine Songs zum Anhängen gefunden.');
                }

                $playlist->songs()->attach($attach);

                return $playlist;
            });
        } catch (Throwable $e) {
            return response()->json([
                'message' => 'Import fehlgeschlagen: '.$e->getMessage(),
            ], 500);
        }

        $playlist->load([
            'user:id,name',
            'songs' => fn ($query) => $query->with('user:id,name'),
        ]);
        $playlist->loadCount('songs');

        return response()->json([
            'data' => $playlist,
            'imported_tracks' => $playlist->songs_count,
        ], 201);
    }
}
