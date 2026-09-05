<?php

namespace App\Services;

use App\Events\MessageCreated;
use App\Events\QueueUpdated;
use App\Events\ReactionCreated;
use App\Events\RoomStateUpdated;
use App\Models\ListeningRoom;
use App\Models\ListeningRoomMember;
use App\Models\ListeningRoomMessage;
use App\Models\ListeningRoomQueueItem;
use App\Models\ListeningRoomReaction;
use App\Models\ListeningRoomVote;
use App\Models\Song;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class ListeningRoomService
{
    public function create(User $host, string $name): ListeningRoom
    {
        return DB::transaction(function () use ($host, $name) {
            $room = ListeningRoom::query()->create([
                'host_user_id' => $host->id,
                'code' => $this->generateUniqueCode(),
                'name' => $name,
                'status' => 'open',
                'position_ms' => 0,
                'is_playing' => false,
                'playback_updated_at' => now(),
            ]);

            $room->members()->create([
                'user_id' => $host->id,
                'role' => 'host',
                'last_seen_at' => now(),
            ]);

            return $room->fresh(['host:id,name', 'members.user:id,name']);
        });
    }

    public function join(User $user, string $code): ListeningRoom
    {
        $room = ListeningRoom::query()->where('code', strtoupper($code))->firstOrFail();

        if (! $room->isOpen()) {
            throw new RuntimeException(__('This listening room is closed.'));
        }

        $existing = $room->members()->where('user_id', $user->id)->first();

        if ($existing) {
            $existing->update([
                'last_seen_at' => now(),
                'role' => (string) $room->host_user_id === (string) $user->id ? 'host' : $existing->role,
            ]);
        } else {
            $room->members()->create([
                'user_id' => $user->id,
                'role' => (string) $room->host_user_id === (string) $user->id ? 'host' : 'member',
                'last_seen_at' => now(),
            ]);
        }

        return $this->snapshot($room->fresh());
    }

    public function leave(User $user, ListeningRoom $room): void
    {
        $member = $this->memberOrFail($room, $user);

        if ($member->isHost()) {
            // Host leaving keeps room open; transfer to oldest moderator if any
            $nextHost = $room->members()
                ->where('user_id', '!=', $user->id)
                ->where('role', 'moderator')
                ->orderBy('created_at')
                ->first()
                ?? $room->members()
                    ->where('user_id', '!=', $user->id)
                    ->orderBy('created_at')
                    ->first();

            if ($nextHost) {
                $nextHost->update(['role' => 'host']);
                $room->update(['host_user_id' => $nextHost->user_id]);
            } else {
                $room->update([
                    'status' => 'closed',
                    'is_playing' => false,
                    'playback_updated_at' => now(),
                ]);
                $this->broadcast(new RoomStateUpdated($room->fresh()));
            }
        }

        $member->delete();
    }

    public function close(User $user, ListeningRoom $room): ListeningRoom
    {
        $this->assertHost($room, $user);
        $room->update([
            'status' => 'closed',
            'is_playing' => false,
            'playback_updated_at' => now(),
        ]);
        $this->broadcast(new RoomStateUpdated($room->fresh()));

        return $room->fresh();
    }

    public function snapshot(ListeningRoom $room): ListeningRoom
    {
        $room->load([
            'host:id,name',
            'members.user:id,name',
            'queueItems' => fn ($q) => $q->whereIn('status', ['queued', 'playing'])
                ->with(['addedBy:id,name', 'votes:id,queue_item_id,user_id'])
                ->withCount('votes'),
        ]);

        return $room;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function serializeQueue(ListeningRoom $room): array
    {
        $items = $room->queueItems()
            ->whereIn('status', ['queued', 'playing'])
            ->with(['addedBy:id,name', 'votes:id,queue_item_id,user_id'])
            ->withCount('votes')
            ->orderBy('position')
            ->get();

        return $items->map(fn (ListeningRoomQueueItem $item) => $this->serializeQueueItem($item))->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function serializeQueueItem(ListeningRoomQueueItem $item): array
    {
        return [
            'id' => $item->id,
            'song_id' => $item->song_id,
            'provider' => $item->provider,
            'track_uri' => $item->track_uri,
            'title' => $item->title,
            'artist' => $item->artist,
            'album_art_url' => $item->album_art_url,
            'position' => $item->position,
            'status' => $item->status,
            'votes_count' => $item->votes_count ?? $item->votes()->count(),
            'voted_user_ids' => $item->relationLoaded('votes')
                ? $item->votes->pluck('user_id')->all()
                : $item->votes()->pluck('user_id')->all(),
            'added_by' => $item->addedBy ? [
                'id' => $item->addedBy->id,
                'name' => $item->addedBy->name,
            ] : null,
        ];
    }

    public function setPlayback(
        User $user,
        ListeningRoom $room,
        array $payload,
    ): ListeningRoom {
        $this->assertCanControlPlayback($room, $user);

        $updates = [
            'playback_updated_at' => now(),
        ];

        if (array_key_exists('is_playing', $payload)) {
            $updates['is_playing'] = (bool) $payload['is_playing'];
        }
        if (array_key_exists('position_ms', $payload)) {
            $updates['position_ms'] = max(0, (int) $payload['position_ms']);
        }
        if (array_key_exists('track_uri', $payload) && filled($payload['track_uri'])) {
            $updates['track_uri'] = $payload['track_uri'];
            $updates['provider'] = $payload['provider'] ?? $room->provider ?? 'spotify';
            $updates['track_title'] = $payload['track_title'] ?? $room->track_title;
            $updates['track_artist'] = $payload['track_artist'] ?? $room->track_artist;
            $updates['album_art_url'] = $payload['album_art_url'] ?? $room->album_art_url;
            $updates['current_song_id'] = $payload['current_song_id'] ?? $room->current_song_id;
            if (! array_key_exists('position_ms', $payload)) {
                $updates['position_ms'] = 0;
            }
            if (! array_key_exists('is_playing', $payload)) {
                $updates['is_playing'] = true;
            }
        }

        $room->update($updates);
        $room = $room->fresh();
        $this->broadcast(new RoomStateUpdated($room));

        return $room;
    }

    public function playNext(User $user, ListeningRoom $room): ListeningRoom
    {
        $this->assertCanControlPlayback($room, $user);

        return $this->advanceToNextTrack($room);
    }

    public function advanceToNextTrack(ListeningRoom $room): ListeningRoom
    {
        $room->queueItems()->where('status', 'playing')->update(['status' => 'played']);

        $next = $room->queueItems()
            ->where('status', 'queued')
            ->withCount('votes')
            ->orderByDesc('votes_count')
            ->orderBy('position')
            ->first();

        if (! $next) {
            $room->update([
                'is_playing' => false,
                'position_ms' => 0,
                'playback_updated_at' => now(),
                'provider' => null,
                'track_uri' => null,
                'track_title' => null,
                'track_artist' => null,
                'album_art_url' => null,
                'current_song_id' => null,
            ]);
            $this->broadcast(new RoomStateUpdated($room->fresh()));
            $this->broadcast(new QueueUpdated($room, $this->serializeQueue($room)));

            return $room->fresh();
        }

        $next->update(['status' => 'playing']);

        $room->update([
            'provider' => $next->provider,
            'track_uri' => $next->track_uri,
            'track_title' => $next->title,
            'track_artist' => $next->artist,
            'album_art_url' => $next->album_art_url,
            'current_song_id' => $next->song_id,
            'position_ms' => 0,
            'is_playing' => true,
            'playback_updated_at' => now(),
        ]);

        $this->broadcast(new RoomStateUpdated($room->fresh()));
        $this->broadcast(new QueueUpdated($room, $this->serializeQueue($room)));

        return $room->fresh();
    }

    public function heartbeat(User $user, ListeningRoom $room, int $positionMs, bool $ended = false): ListeningRoom
    {
        $this->assertCanControlPlayback($room, $user);

        if ($ended) {
            return $this->advanceToNextTrack($room);
        }

        if (! filled($room->track_uri)) {
            return $room;
        }

        // Only touch position while still playing — never force resume after pause.
        ListeningRoom::query()
            ->whereKey($room->id)
            ->where('is_playing', true)
            ->update([
                'position_ms' => max(0, $positionMs),
                'playback_updated_at' => now(),
            ]);

        return $room->fresh();
    }

    public function addToQueue(User $user, ListeningRoom $room, array $payload): ListeningRoomQueueItem
    {
        $this->memberOrFail($room, $user);

        $songId = $payload['song_id'] ?? null;
        if ($songId) {
            $song = Song::query()->findOrFail($songId);
            if (! $song->isPlayable()) {
                throw new RuntimeException(__('Song has no playable provider URI.'));
            }
            $payload = [
                'song_id' => $song->id,
                'provider' => $song->provider,
                'track_uri' => $song->provider_uri,
                'title' => $song->title,
                'artist' => $song->artist,
                'album_art_url' => $song->album_art_url,
            ];
        }

        if (empty($payload['track_uri'])) {
            throw new RuntimeException(__('Track URI missing.'));
        }

        $provider = $payload['provider'] ?? $room->provider ?? 'spotify';
        if (filled($room->provider) && $room->provider !== $provider && filled($room->track_uri)) {
            throw new RuntimeException(__('Room already uses another music provider.'));
        }

        $position = (int) $room->queueItems()->where('status', 'queued')->max('position') + 1;

        $item = $room->queueItems()->create([
            'song_id' => $payload['song_id'] ?? null,
            'added_by' => $user->id,
            'provider' => $provider,
            'track_uri' => $payload['track_uri'],
            'title' => mb_substr($payload['title'] ?? 'Track', 0, 255),
            'artist' => mb_substr($payload['artist'] ?? 'Unbekannt', 0, 255),
            'album_art_url' => $payload['album_art_url'] ?? null,
            'position' => $position,
            'status' => 'queued',
        ]);

        // Auto-start if nothing playing
        if (! $room->track_uri && ! $room->is_playing) {
            $this->advanceToNextTrack($room);
        } else {
            $this->broadcast(new QueueUpdated($room, $this->serializeQueue($room)));
        }

        return $item->fresh(['addedBy:id,name', 'votes'])->loadCount('votes');
    }

    public function removeFromQueue(User $user, ListeningRoom $room, ListeningRoomQueueItem $item): void
    {
        $member = $this->memberOrFail($room, $user);
        if (! $member->canControlPlayback() && $item->added_by !== $user->id) {
            throw new RuntimeException(__('Not authorized.'));
        }
        if ($item->listening_room_id !== $room->id) {
            throw new RuntimeException(__('Song does not belong to this room.'));
        }

        $item->delete();
        $this->broadcast(new QueueUpdated($room, $this->serializeQueue($room)));
    }

    public function toggleVote(User $user, ListeningRoom $room, ListeningRoomQueueItem $item): array
    {
        $this->memberOrFail($room, $user);
        if ($item->listening_room_id !== $room->id || $item->status !== 'queued') {
            throw new RuntimeException(__('Voting is not possible.'));
        }

        $existing = ListeningRoomVote::query()
            ->where('queue_item_id', $item->id)
            ->where('user_id', $user->id)
            ->first();

        if ($existing) {
            $existing->delete();
            $voted = false;
        } else {
            ListeningRoomVote::query()->create([
                'queue_item_id' => $item->id,
                'user_id' => $user->id,
            ]);
            $voted = true;
        }

        $this->broadcast(new QueueUpdated($room, $this->serializeQueue($room)));

        return [
            'voted' => $voted,
            'votes_count' => $item->votes()->count(),
            'queue' => $this->serializeQueue($room),
        ];
    }

    public function postMessage(User $user, ListeningRoom $room, string $body): ListeningRoomMessage
    {
        $this->memberOrFail($room, $user);

        $message = $room->messages()->create([
            'user_id' => $user->id,
            'body' => trim($body),
        ]);
        $message->load('user:id,name');
        $this->broadcast(new MessageCreated($room, $message));

        return $message;
    }

    public function react(User $user, ListeningRoom $room, string $emoji): ListeningRoomReaction
    {
        $this->memberOrFail($room, $user);

        $reaction = $room->reactions()->create([
            'user_id' => $user->id,
            'emoji' => $emoji,
        ]);

        $this->broadcast(new ReactionCreated($room, $user, $emoji, $reaction->id));

        return $reaction;
    }

    public function setRole(User $actor, ListeningRoom $room, User $target, string $role): ListeningRoomMember
    {
        $this->assertHost($room, $actor);

        if (! in_array($role, ['moderator', 'member'], true)) {
            throw new RuntimeException(__('Invalid role.'));
        }
        if ($target->id === $room->host_user_id) {
            throw new RuntimeException(__('Host role cannot be changed.'));
        }

        $member = $room->members()->where('user_id', $target->id)->firstOrFail();
        $member->update(['role' => $role]);

        return $member->fresh('user:id,name');
    }

    public function memberOrFail(ListeningRoom $room, User $user): ListeningRoomMember
    {
        $member = $room->members()->where('user_id', $user->id)->first();
        if (! $member) {
            throw new RuntimeException(__('You are not a member of this room.'));
        }

        return $member;
    }

    public function assertCanControlPlayback(ListeningRoom $room, User $user): void
    {
        $member = $this->memberOrFail($room, $user);

        if ((string) $room->host_user_id === (string) $user->id && $member->role !== 'host') {
            $member->update(['role' => 'host']);
            $member->refresh();
        }

        if (! $member->canControlPlayback()) {
            throw new RuntimeException(__('Only the host or a moderator control playback.'));
        }
    }

    public function assertHost(ListeningRoom $room, User $user): void
    {
        $member = $this->memberOrFail($room, $user);
        if (! $member->isHost() && (string) $room->host_user_id !== (string) $user->id) {
            throw new RuntimeException(__('Only the host may do that.'));
        }
    }

    private function broadcast(object $event): void
    {
        try {
            event($event);
        } catch (Throwable $e) {
            Log::warning('Listening room broadcast failed: '.$e->getMessage(), [
                'event' => $event::class,
            ]);
        }
    }

    private function generateUniqueCode(): string
    {
        do {
            $code = strtoupper(Str::random(6));
        } while (ListeningRoom::query()->where('code', $code)->exists());

        return $code;
    }
}
