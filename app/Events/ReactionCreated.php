<?php

namespace App\Events;

use App\Models\ListeningRoom;
use App\Models\User;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class ReactionCreated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public ListeningRoom $room,
        public User $user,
        public string $emoji,
        public int $reactionId,
    ) {}

    public function broadcastOn(): array
    {
        return [new PresenceChannel('listening-room.'.$this->room->code)];
    }

    public function broadcastAs(): string
    {
        return 'reaction.created';
    }

    public function broadcastWith(): array
    {
        return [
            'reaction' => [
                'id' => $this->reactionId,
                'emoji' => $this->emoji,
                'user' => [
                    'id' => $this->user->id,
                    'name' => $this->user->name,
                ],
                'created_at' => now()->toIso8601String(),
            ],
        ];
    }
}
