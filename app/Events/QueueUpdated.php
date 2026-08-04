<?php

namespace App\Events;

use App\Models\ListeningRoom;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class QueueUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    /**
     * @param  list<array<string, mixed>>  $queue
     */
    public function __construct(
        public ListeningRoom $room,
        public array $queue,
    ) {}

    public function broadcastOn(): array
    {
        return [new PresenceChannel('listening-room.'.$this->room->code)];
    }

    public function broadcastAs(): string
    {
        return 'queue.updated';
    }

    public function broadcastWith(): array
    {
        return ['queue' => $this->queue];
    }
}
