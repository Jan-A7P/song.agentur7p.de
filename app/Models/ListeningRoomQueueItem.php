<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'listening_room_id',
    'song_id',
    'added_by',
    'provider',
    'track_uri',
    'title',
    'artist',
    'album_art_url',
    'position',
    'status',
])]
class ListeningRoomQueueItem extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'position' => 'integer',
        ];
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(ListeningRoom::class, 'listening_room_id');
    }

    public function song(): BelongsTo
    {
        return $this->belongsTo(Song::class);
    }

    public function addedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'added_by');
    }

    public function votes(): HasMany
    {
        return $this->hasMany(ListeningRoomVote::class, 'queue_item_id');
    }
}
