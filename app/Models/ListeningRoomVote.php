<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'queue_item_id',
    'user_id',
])]
class ListeningRoomVote extends Model
{
    use HasUuids;

    public function queueItem(): BelongsTo
    {
        return $this->belongsTo(ListeningRoomQueueItem::class, 'queue_item_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
