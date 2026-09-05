<?php

namespace App\Http\Controllers\Api;

use App\Enums\MusicProvider;
use App\Http\Controllers\Controller;
use App\Models\Playlist;
use App\Models\Song;
use App\Music\MusicProviderRegistry;
use App\Services\LyricsLookupService;
use App\Services\MusicConnectionService;
use App\Services\SongCatalogService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Throwable;

class MusicController extends Controller
{
    public function __construct(
        private MusicProviderRegistry $registry,
        private MusicConnectionService $connections,
        private SongCatalogService $catalog,
        private LyricsLookupService $lyrics,
    ) {}

    public function providers(): JsonResponse
    {
        return response()->json([
            'providers' => $this->registry->listProviders(),
        ]);
    }

    public function status(Request $request, string $provider): JsonResponse
    {
        try {
            $adapter = $this->registry->resolve($provider);
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }

        return response()->json([
            'provider' => $adapter->id(),
            'label' => $adapter->label(),
            'configured' => $adapter->isConfigured(),
            'connected' => $this->connections->isLinked($request->user(), MusicProvider::from($adapter->id())),
            'enabled' => $this->registry->isConnected($request->user(), $adapter->id()),
            'connections' => $this->connections->statusPayload($request->user()),
        ]);
    }

    public function setEnabled(Request $request, string $provider): JsonResponse
    {
        $request->validate([
            'enabled' => ['required'],
        ]);

        try {
            $adapter = $this->registry->resolve($provider);
            $enum = MusicProvider::from($adapter->id());
            $connection = $this->connections->setEnabled(
                $request->user(),
                $enum,
                $request->boolean('enabled'),
            );
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        } catch (Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $user = $request->user()->fresh();

        return response()->json([
            'provider' => $adapter->id(),
            'connected' => true,
            'enabled' => (bool) $connection->enabled,
            'active_provider' => $this->connections->activeProvider($user)?->value,
            'music_connections' => $this->connections->connectionsPayload($user),
        ]);
    }

    public function token(Request $request, string $provider): JsonResponse
    {
        try {
            $adapter = $this->registry->resolve($provider);
            $accessToken = $adapter->getAccessToken($request->user());
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        } catch (Throwable $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'connected' => false,
            ], 400);
        }

        return response()->json([
            'access_token' => $accessToken,
            'provider' => $adapter->id(),
            'connected' => true,
            'client_id' => $adapter->clientId(),
        ]);
    }

    public function search(Request $request, string $provider): JsonResponse
    {
        $validated = $request->validate([
            'q' => ['required', 'string', 'min:1', 'max:200'],
        ]);

        try {
            $adapter = $this->registry->resolve($provider);
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage(), 'tracks' => []], 404);
        }

        if (! $adapter->isConfigured()) {
            return response()->json(['message' => $adapter->label().' is not configured.', 'tracks' => []], 503);
        }

        try {
            $tracks = $adapter->searchTracks($validated['q']);
        } catch (Throwable $e) {
            return response()->json(['message' => $e->getMessage(), 'tracks' => []], 502);
        }

        $normalized = collect($tracks)->map(fn (array $track) => [
            'provider' => $adapter->id(),
            'id' => $track['id'],
            'uri' => $track['uri'],
            'name' => $track['name'],
            'artist' => $track['artist'],
            'album_art_url' => $track['album_art_url'],
            'duration_ms' => $track['duration_ms'] ?? null,
        ])->all();

        return response()->json(['tracks' => $normalized]);
    }

    public function play(Request $request, string $provider): JsonResponse
    {
        $validated = $request->validate([
            'uri' => ['required', 'string', 'max:512'],
            'device_id' => ['required', 'string'],
            'position_ms' => ['nullable', 'integer', 'min:0'],
        ]);

        try {
            $adapter = $this->registry->resolve($provider);
            $adapter->playUri(
                $request->user(),
                $validated['uri'],
                $validated['device_id'],
                (int) ($validated['position_ms'] ?? 0),
            );
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        } catch (Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }

        return response()->json(['ok' => true]);
    }

    public function disconnect(Request $request, string $provider): JsonResponse
    {
        try {
            $adapter = $this->registry->resolve($provider);
            $adapter->disconnect($request->user());
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }

        return response()->json([
            'connected' => false,
            'provider' => $adapter->id(),
            'message' => $adapter->label().' disconnected',
        ]);
    }

    public function playlists(Request $request, string $provider): JsonResponse
    {
        try {
            $adapter = $this->registry->resolve($provider);
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage(), 'playlists' => []], 404);
        }

        if (! $adapter->isConfigured()) {
            return response()->json(['message' => $adapter->label().' is not configured.', 'playlists' => []], 503);
        }

        try {
            $playlists = $adapter->getUserPlaylists($request->user());
        } catch (Throwable $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'playlists' => [],
                'needs_reconnect' => true,
            ], 502);
        }

        return response()->json(['playlists' => $playlists]);
    }

    public function importPlaylist(Request $request, string $provider): JsonResponse
    {
        $validated = $request->validate([
            'playlist_id' => ['required', 'string', 'max:128'],
        ]);

        try {
            $adapter = $this->registry->resolve($provider);
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        }

        $user = $request->user();

        try {
            $remotePlaylists = $adapter->getUserPlaylists($user);
            $meta = collect($remotePlaylists)->firstWhere('id', $validated['playlist_id']);

            if (! $meta) {
                $meta = [
                    'id' => $validated['playlist_id'],
                    'name' => $adapter->label().' Playlist',
                    'description' => null,
                ];
            }

            $tracks = $adapter->getPlaylistTracks($user, $validated['playlist_id']);
        } catch (Throwable $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'needs_reconnect' => true,
            ], 502);
        }

        if (count($tracks) === 0) {
            return response()->json([
                'message' => __('No importable tracks.'),
            ], 422);
        }

        try {
            /** @var array{0: Playlist, 1: list<array{song_id: string, duration_ms: int|null}>} $imported */
            $imported = DB::transaction(function () use ($user, $meta, $tracks, $adapter) {
                $playlist = $user->playlists()->create([
                    'name' => $meta['name'] ?: ($adapter->label().' Playlist'),
                    'description' => $meta['description'] ?? null,
                ]);

                $attach = [];
                $position = 1;
                /** @var list<array{song_id: string, duration_ms: int|null}> $pendingLyrics */
                $pendingLyrics = [];

                foreach ($tracks as $track) {
                    $durationMs = isset($track['duration_ms']) ? (int) $track['duration_ms'] : null;
                    $result = $this->catalog->createOrMerge($user, [
                        'title' => mb_substr($track['name'], 0, 255),
                        'artist' => mb_substr($track['artist'], 0, 255),
                        'lyrics' => '',
                        'duration_ms' => $durationMs && $durationMs > 0 ? $durationMs : null,
                        'provider' => $adapter->id(),
                        'provider_track_id' => $track['id'],
                        'provider_uri' => $track['uri'],
                        'album_art_url' => $track['album_art_url'],
                    ]);
                    $song = $result['song'];

                    if (! isset($attach[$song->id])) {
                        $attach[$song->id] = ['position' => $position];
                        $position++;
                        $pendingLyrics[] = [
                            'song_id' => $song->id,
                            'duration_ms' => $song->duration_ms ?: ($durationMs && $durationMs > 0 ? $durationMs : null),
                        ];
                    }
                }

                if ($attach === []) {
                    throw new \RuntimeException(__('No songs to attach.'));
                }

                $playlist->songs()->attach($attach);

                return [$playlist, $pendingLyrics];
            });
        } catch (Throwable $e) {
            return response()->json([
                'message' => __('Import failed: :message', ['message' => $e->getMessage()]),
            ], 500);
        }

        [$playlist, $pendingLyrics] = $imported;
        $lyricsFound = $this->enrichImportedLyrics($pendingLyrics);

        $playlist->load([
            'user:id,name',
            'songs' => fn ($query) => $query->with('providers'),
        ]);
        $playlist->loadCount('songs');

        return response()->json([
            'data' => $playlist,
            'imported_tracks' => $playlist->songs_count,
            'lyrics_found' => $lyricsFound,
        ], 201);
    }

    /**
     * @param  list<array{song_id: string, duration_ms: int|null}>  $pending
     */
    private function enrichImportedLyrics(array $pending): int
    {
        $found = 0;

        foreach ($pending as $item) {
            $song = Song::query()->find($item['song_id']);
            if (! $song || trim((string) $song->lyrics) !== '') {
                continue;
            }

            try {
                $result = $this->lyrics->lookup(
                    (string) $song->title,
                    (string) $song->artist,
                    $item['duration_ms'],
                );
            } catch (Throwable) {
                continue;
            }

            if ($result === null || trim($result['lyrics']) === '') {
                continue;
            }

            $song->forceFill(['lyrics' => $result['lyrics']])->save();
            $found++;
        }

        return $found;
    }
}
