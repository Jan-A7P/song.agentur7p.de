<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ListeningRoom;
use App\Models\ListeningRoomQueueItem;
use App\Models\User;
use App\Services\ListeningRoomService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Throwable;

class ListeningRoomController extends Controller
{
    public function __construct(private ListeningRoomService $rooms) {}

    public function index(Request $request): JsonResponse
    {
        $rooms = ListeningRoom::query()
            ->where('status', 'open')
            ->whereHas('members', fn ($q) => $q->where('user_id', $request->user()->id))
            ->with(['host:id,name'])
            ->withCount('members')
            ->latest()
            ->get();

        return response()->json(['data' => $rooms]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
        ]);

        $room = $this->rooms->create($request->user(), $validated['name']);

        return response()->json(['data' => $this->payload($room, $request->user())], 201);
    }

    public function show(Request $request, string $code): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();
        $this->rooms->memberOrFail($room, $request->user());

        return response()->json(['data' => $this->payload($this->rooms->snapshot($room), $request->user())]);
    }

    public function join(Request $request, string $code): JsonResponse
    {
        try {
            $room = $this->rooms->join($request->user(), $code);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $this->payload($room, $request->user())]);
    }

    public function leave(Request $request, string $code): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();

        try {
            $this->rooms->leave($request->user(), $room);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['ok' => true]);
    }

    public function close(Request $request, string $code): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();

        try {
            $room = $this->rooms->close($request->user(), $room);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 403);
        }

        return response()->json(['data' => $this->payload($this->rooms->snapshot($room), $request->user())]);
    }

    public function playback(Request $request, string $code): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();
        $validated = $request->validate([
            'action' => ['required', 'string', 'in:play,pause,seek,load,next,heartbeat'],
            'position_ms' => ['nullable', 'integer', 'min:0'],
            'provider' => ['nullable', 'string', 'max:32'],
            'track_uri' => ['nullable', 'string', 'max:255'],
            'track_title' => ['nullable', 'string', 'max:255'],
            'track_artist' => ['nullable', 'string', 'max:255'],
            'album_art_url' => ['nullable', 'string', 'max:2048'],
            'current_song_id' => ['nullable', 'uuid', 'exists:songs,id'],
            'ended' => ['nullable', 'boolean'],
        ]);

        try {
            $room = match ($validated['action']) {
                'next' => $this->rooms->playNext($request->user(), $room),
                'heartbeat' => $this->rooms->heartbeat(
                    $request->user(),
                    $room,
                    (int) ($validated['position_ms'] ?? 0),
                    (bool) ($validated['ended'] ?? false),
                ),
                'pause' => $this->rooms->setPlayback($request->user(), $room, [
                    'is_playing' => false,
                    'position_ms' => $validated['position_ms'] ?? $room->estimatedPositionMs(),
                ]),
                'play' => $this->rooms->setPlayback($request->user(), $room, [
                    'is_playing' => true,
                    'position_ms' => $validated['position_ms'] ?? $room->position_ms,
                ]),
                'seek' => $this->rooms->setPlayback($request->user(), $room, [
                    'position_ms' => $validated['position_ms'] ?? 0,
                    'is_playing' => $room->is_playing,
                ]),
                'load' => $this->rooms->setPlayback($request->user(), $room, [
                    'provider' => $validated['provider'] ?? 'spotify',
                    'track_uri' => $validated['track_uri'],
                    'track_title' => $validated['track_title'] ?? null,
                    'track_artist' => $validated['track_artist'] ?? null,
                    'album_art_url' => $validated['album_art_url'] ?? null,
                    'current_song_id' => $validated['current_song_id'] ?? null,
                    'position_ms' => $validated['position_ms'] ?? 0,
                    'is_playing' => true,
                ]),
            };
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 403);
        } catch (Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 500);
        }

        return response()->json(['data' => $this->payload($this->rooms->snapshot($room), $request->user())]);
    }

    public function addQueue(Request $request, string $code): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();
        $validated = $request->validate([
            'song_id' => ['nullable', 'uuid', 'exists:songs,id'],
            'provider' => ['nullable', 'string', 'max:32'],
            'track_uri' => ['nullable', 'string', 'max:255'],
            'title' => ['nullable', 'string', 'max:255'],
            'artist' => ['nullable', 'string', 'max:255'],
            'album_art_url' => ['nullable', 'string', 'max:2048'],
        ]);

        try {
            $item = $this->rooms->addToQueue($request->user(), $room, $validated);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $room = $this->rooms->snapshot($room->fresh());

        return response()->json([
            'data' => $this->payload($room, $request->user()),
            'item' => $this->rooms->serializeQueueItem($item->loadCount('votes')->load(['addedBy:id,name', 'votes'])),
        ], 201);
    }

    public function removeQueue(Request $request, string $code, ListeningRoomQueueItem $item): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();

        try {
            $this->rooms->removeFromQueue($request->user(), $room, $item);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 403);
        }

        return response()->json([
            'data' => $this->payload($this->rooms->snapshot($room->fresh()), $request->user()),
        ]);
    }

    public function vote(Request $request, string $code, ListeningRoomQueueItem $item): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();

        try {
            $result = $this->rooms->toggleVote($request->user(), $room, $item);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json($result);
    }

    public function messages(Request $request, string $code): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();
        $this->rooms->memberOrFail($room, $request->user());

        $messages = $room->messages()
            ->with('user:id,name')
            ->latest('id')
            ->limit(50)
            ->get()
            ->sortBy('id')
            ->values();

        return response()->json(['data' => $messages]);
    }

    public function postMessage(Request $request, string $code): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();
        $validated = $request->validate([
            'body' => ['required', 'string', 'min:1', 'max:500'],
        ]);

        try {
            $message = $this->rooms->postMessage($request->user(), $room, $validated['body']);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 403);
        }

        return response()->json(['data' => $message], 201);
    }

    public function react(Request $request, string $code): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();
        $validated = $request->validate([
            'emoji' => ['required', 'string', 'max:16'],
        ]);

        try {
            $reaction = $this->rooms->react($request->user(), $room, $validated['emoji']);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 403);
        }

        return response()->json(['data' => $reaction], 201);
    }

    public function setRole(Request $request, string $code, User $user): JsonResponse
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();
        $validated = $request->validate([
            'role' => ['required', 'string', 'in:moderator,member'],
        ]);

        try {
            $member = $this->rooms->setRole($request->user(), $room, $user, $validated['role']);
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 403);
        }

        return response()->json(['data' => $member]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(ListeningRoom $room, User $user): array
    {
        $member = $room->members->firstWhere('user_id', $user->id)
            ?? $room->members()->where('user_id', $user->id)->first();

        return [
            'id' => $room->id,
            'code' => $room->code,
            'name' => $room->name,
            'status' => $room->status,
            'host' => $room->host ? ['id' => $room->host->id, 'name' => $room->host->name] : null,
            'my_role' => $member?->role,
            'can_control' => ($member?->canControlPlayback() ?? false)
                || (string) $room->host_user_id === (string) $user->id,
            'state' => [
                'provider' => $room->provider,
                'track_uri' => $room->track_uri,
                'track_title' => $room->track_title,
                'track_artist' => $room->track_artist,
                'album_art_url' => $room->album_art_url,
                'current_song_id' => $room->current_song_id,
                'position_ms' => $room->estimatedPositionMs(),
                'is_playing' => $room->is_playing,
                'playback_updated_at' => optional($room->playback_updated_at)?->toIso8601String(),
            ],
            'members' => $room->members->map(fn ($m) => [
                'id' => $m->id,
                'role' => $m->role,
                'user' => $m->user ? ['id' => $m->user->id, 'name' => $m->user->name] : null,
            ])->values(),
            'queue' => $this->rooms->serializeQueue($room),
            'join_url' => url('/rooms/'.$room->code),
        ];
    }
}
