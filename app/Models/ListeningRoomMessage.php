<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'listening_room_id',
    'user_id',
    'body',
])]
class ListeningRoomMessage extends Model
{
    public function room(): BelongsTo
    {
        return $this->belongsTo(ListeningRoom::class, 'listening_room_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
