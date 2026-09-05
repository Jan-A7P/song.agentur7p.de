<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'listening_room_id',
    'user_id',
    'role',
    'last_seen_at',
])]
class ListeningRoomMember extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
        ];
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(ListeningRoom::class, 'listening_room_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function canControlPlayback(): bool
    {
        return in_array($this->role, ['host', 'moderator'], true);
    }

    public function isHost(): bool
    {
        return $this->role === 'host';
    }
}
