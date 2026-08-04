<?php

namespace App\Events;

use App\Models\ListeningRoom;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class RoomStateUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(public ListeningRoom $room) {}

    public function broadcastOn(): array
    {
        return [new PresenceChannel('listening-room.'.$this->room->code)];
    }

    public function broadcastAs(): string
    {
        return 'room.state';
    }

    public function broadcastWith(): array
    {
        return [
            'state' => [
                'provider' => $this->room->provider,
                'track_uri' => $this->room->track_uri,
                'track_title' => $this->room->track_title,
                'track_artist' => $this->room->track_artist,
                'album_art_url' => $this->room->album_art_url,
                'current_song_id' => $this->room->current_song_id,
                'position_ms' => $this->room->estimatedPositionMs(),
                'is_playing' => $this->room->is_playing,
                'playback_updated_at' => optional($this->room->playback_updated_at)?->toIso8601String(),
            ],
        ];
    }
}
