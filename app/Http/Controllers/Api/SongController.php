<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Song;
use App\Models\SongPlay;
use App\Models\User;
use App\Services\ArtistService;
use App\Services\SongCatalogService;
use App\Services\SongPlayTrackingService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class SongController extends Controller
{
    public function __construct(
        private SongCatalogService $catalog,
        private ArtistService $artists,
        private SongPlayTrackingService $playTracking,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $query = Song::query()
            ->with(['providers', 'artists'])
            ->latest();

        $this->applyFavoriteExists($query, $user);

        if ($search = $request->string('q')->trim()->toString()) {
            $query->where(function ($builder) use ($search) {
                $builder
                    ->where('title', 'like', "%{$search}%")
                    ->orWhere('artist', 'like', "%{$search}%")
                    ->orWhereHas('artists', function (Builder $artists) use ($search) {
                        $artists->where('name', 'like', "%{$search}%");
                    });
            });
        }

        if ($request->boolean('favorites') && $user) {
            $query->whereHas('favoritedBy', fn (Builder $builder) => $builder->where('users.id', $user->id));
        }

        $sort = $request->string('sort')->toString();
        if ($sort === 'plays') {
            $query->reorder()->orderByDesc('play_count')->orderByDesc('id');
        } elseif ($sort === 'recently_played') {
            $query->reorder()->orderByDesc('last_played_at')->orderByDesc('id');
        }

        $songs = $query->paginate(20);

        return response()->json($songs);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $this->validateSong($request);
        $validated['lyrics'] = $validated['lyrics'] ?? '';

        $result = $this->catalog->createOrMerge($request->user(), $validated);
        $song = $this->decorateSong($result['song']->load(['providers', 'artists']), $request->user());

        return response()->json([
            'data' => $song,
            'created' => $result['created'],
            'merged' => ! $result['created'],
        ], $result['created'] ? 201 : 200);
    }

    public function show(Request $request, Song $song): JsonResponse
    {
        $song->load(['providers', 'artists']);
        $user = $request->user();

        if (! $song->duration_ms || $song->duration_ms <= 0) {
            $song = $this->catalog->fillMissingDuration($song);
            $song->load(['providers', 'artists']);
        }

        $completedCount = $song->plays()->where('completed', true)->count();

        $myStats = null;
        $recentPlays = [];

        if ($user) {
            $myPlays = $song->plays()->where('user_id', $user->id);

            $myStats = [
                'play_count' => (int) $myPlays->count(),
                'total_listen_ms' => (int) $song->plays()->where('user_id', $user->id)->sum('listened_ms'),
                'completed_count' => (int) $song->plays()->where('user_id', $user->id)->where('completed', true)->count(),
                'last_played_at' => $song->plays()->where('user_id', $user->id)->latest('created_at')->value('created_at'),
            ];

            if ($myStats['last_played_at'] instanceof \DateTimeInterface) {
                $myStats['last_played_at'] = $myStats['last_played_at']->format(\DateTimeInterface::ATOM);
            }

            $recentPlays = $song->plays()
                ->where('user_id', $user->id)
                ->latest('created_at')
                ->limit(8)
                ->get(['id', 'provider', 'listened_ms', 'completed', 'created_at'])
                ->map(fn (SongPlay $play) => [
                    'id' => $play->id,
                    'provider' => $play->provider,
                    'listened_ms' => $play->listened_ms,
                    'completed' => $play->completed,
                    'created_at' => $play->created_at?->toIso8601String(),
                ])
                ->all();
        }

        return response()->json([
            'data' => $this->decorateSong($song, $user),
            'stats' => [
                'play_count' => (int) $song->play_count,
                'total_listen_ms' => (int) $song->total_listen_ms,
                'completed_count' => $completedCount,
                'duration_ms' => $this->resolveSongDurationMs($song),
                'last_played_at' => $song->last_played_at?->toIso8601String(),
                'my' => $myStats,
                'recent_plays' => $recentPlays,
                'daily' => $this->dailyPlaySeries($song, days: 30),
            ],
        ]);
    }

    public function update(Request $request, Song $song): JsonResponse
    {
        $validated = $this->validateSong($request);
        $validated['lyrics'] = $validated['lyrics'] ?? '';

        $payload = [
            'title' => $validated['title'],
            'artist' => $validated['artist'],
            'lyrics' => $validated['lyrics'],
            'album_art_url' => $validated['album_art_url'] ?? $song->album_art_url,
        ];

        if ((! $song->duration_ms || $song->duration_ms <= 0) && ! empty($validated['duration_ms'])) {
            $payload['duration_ms'] = (int) $validated['duration_ms'];
        }

        $song->update($payload);
        $this->artists->syncSongArtists($song->fresh(), $validated['artist']);

        if (array_key_exists('providers', $validated)) {
            $this->catalog->syncProviderLinks(
                $song,
                $validated['providers'] ?? [],
                $validated['preferred_provider'] ?? null,
            );
        } else {
            $this->catalog->mergeProviderData($song, $validated);
        }

        return response()->json([
            'data' => $this->decorateSong($song->fresh()->load(['providers', 'artists']), $request->user()),
        ]);
    }

    public function markPlayed(Request $request, Song $song): JsonResponse
    {
        $validated = $request->validate([
            'provider' => ['required', 'string', 'max:32'],
            'provider_track_id' => ['nullable', 'string', 'max:255'],
            'provider_uri' => ['nullable', 'string', 'max:255'],
            'album_art_url' => ['nullable', 'string', 'max:2048'],
            'duration_ms' => ['nullable', 'integer', 'min:1', 'max:3600000'],
            'track' => ['sometimes', 'boolean'],
        ]);

        if (filled($validated['provider_track_id'] ?? null) && filled($validated['provider_uri'] ?? null)) {
            $this->catalog->enrichFromPlayable($song, $validated['provider'], [
                'id' => $validated['provider_track_id'],
                'uri' => $validated['provider_uri'],
                'album_art_url' => $validated['album_art_url'] ?? null,
            ]);
            $song = $song->fresh()->load(['providers']);
        } else {
            $song = $this->catalog->markLastWorking($song, $validated['provider']);
        }

        if ((! $song->duration_ms || $song->duration_ms <= 0) && empty($validated['duration_ms'])) {
            $song = $this->catalog->fillMissingDuration($song);
        }

        $play = null;
        if ($request->boolean('track', true)) {
            $play = $this->playTracking->start($request->user(), $song, [
                'provider' => $validated['provider'],
                'duration_ms' => $validated['duration_ms'] ?? null,
            ]);
            $song = $song->fresh()->load(['providers']);
        }

        return response()->json([
            'data' => $this->decorateSong($song, $request->user()),
            'play' => $play ? [
                'id' => $play->id,
                'song_id' => $play->song_id,
                'listened_ms' => $play->listened_ms,
                'duration_ms' => $play->duration_ms,
                'completed' => $play->completed,
            ] : null,
        ]);
    }

    public function updatePlay(Request $request, Song $song, SongPlay $play): JsonResponse
    {
        abort_unless($play->song_id === $song->id, 404);

        $validated = $request->validate([
            'listened_ms' => ['required', 'integer', 'min:0'],
            'duration_ms' => ['nullable', 'integer', 'min:1', 'max:3600000'],
            'completed' => ['sometimes', 'boolean'],
        ]);

        $play = $this->playTracking->updateProgress(
            $request->user(),
            $play,
            $validated['listened_ms'],
            $request->boolean('completed'),
            isset($validated['duration_ms']) ? (int) $validated['duration_ms'] : null,
        );

        return response()->json([
            'play' => [
                'id' => $play->id,
                'song_id' => $play->song_id,
                'listened_ms' => $play->listened_ms,
                'duration_ms' => $play->duration_ms,
                'completed' => $play->completed,
            ],
            'data' => $this->decorateSong($song->fresh()->load(['providers']), $request->user()),
        ]);
    }

    public function favorite(Request $request, Song $song): JsonResponse
    {
        $request->user()->favoriteSongs()->syncWithoutDetaching([$song->id]);

        return response()->json([
            'data' => $this->decorateSong($song->fresh()->load(['providers']), $request->user()),
        ]);
    }

    public function unfavorite(Request $request, Song $song): JsonResponse
    {
        $request->user()->favoriteSongs()->detach($song->id);

        return response()->json([
            'data' => $this->decorateSong($song->fresh()->load(['providers']), $request->user()),
        ]);
    }

    public function destroy(Request $request, Song $song): JsonResponse
    {
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
            'preferred_provider' => ['nullable', 'string', 'max:32'],
            'provider_track_id' => ['nullable', 'string', 'max:255'],
            'provider_uri' => ['nullable', 'string', 'max:255'],
            'album_art_url' => ['nullable', 'string', 'max:2048'],
            'duration_ms' => ['nullable', 'integer', 'min:1', 'max:3600000'],
            'providers' => ['nullable', 'array'],
            'providers.*.provider' => ['required_with:providers', 'string', 'max:32'],
            'providers.*.provider_track_id' => ['required_with:providers', 'string', 'max:255'],
            'providers.*.provider_uri' => ['required_with:providers', 'string', 'max:255'],
            'providers.*.album_art_url' => ['nullable', 'string', 'max:2048'],
        ]);
    }

    /**
     * @param  Builder<Song>  $query
     */
    private function applyFavoriteExists(Builder $query, ?User $user): void
    {
        if (! $user) {
            return;
        }

        $query->withExists([
            'favoritedBy as is_favorited' => fn (Builder $builder) => $builder->where('users.id', $user->id),
        ]);
    }

    private function decorateSong(Song $song, ?User $user): Song
    {
        if ($user) {
            if (! array_key_exists('is_favorited', $song->getAttributes())) {
                $song->setAttribute(
                    'is_favorited',
                    $user->favoriteSongs()->where('songs.id', $song->id)->exists(),
                );
            }
        } else {
            $song->setAttribute('is_favorited', false);
        }

        return $song;
    }

    /**
     * @return list<array{date: string, plays: int, listen_ms: int, avg_listen_ms: int}>
     */
    private function dailyPlaySeries(Song $song, int $days = 30): array
    {
        $from = Carbon::now()->subDays($days - 1)->startOfDay();
        $driver = DB::connection()->getDriverName();
        $dayExpression = $driver === 'sqlite'
            ? "strftime('%Y-%m-%d', created_at)"
            : 'DATE(created_at)';

        $rows = $song->plays()
            ->where('created_at', '>=', $from)
            ->selectRaw("{$dayExpression} as day, COUNT(*) as plays, COALESCE(SUM(listened_ms), 0) as listen_ms, COALESCE(AVG(listened_ms), 0) as avg_listen_ms")
            ->groupBy(DB::raw($dayExpression))
            ->orderBy('day')
            ->get()
            ->keyBy(fn ($row) => (string) $row->day);

        $series = [];
        for ($i = 0; $i < $days; $i++) {
            $date = $from->copy()->addDays($i)->toDateString();
            $row = $rows->get($date);
            $series[] = [
                'date' => $date,
                'plays' => (int) ($row->plays ?? 0),
                'listen_ms' => (int) ($row->listen_ms ?? 0),
                'avg_listen_ms' => (int) round((float) ($row->avg_listen_ms ?? 0)),
            ];
        }

        return $series;
    }

    private function resolveSongDurationMs(Song $song): ?int
    {
        if ($song->duration_ms && $song->duration_ms > 0) {
            return (int) $song->duration_ms;
        }

        $fromPlays = $song->plays()
            ->whereNotNull('duration_ms')
            ->where('duration_ms', '>', 0)
            ->max('duration_ms');

        if ($fromPlays) {
            return (int) $fromPlays;
        }

        $fromCompleted = $song->plays()
            ->where('completed', true)
            ->where('listened_ms', '>', 0)
            ->max('listened_ms');

        return $fromCompleted ? (int) $fromCompleted : null;
    }
}
