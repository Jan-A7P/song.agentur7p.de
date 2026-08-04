<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

#[Fillable([
    'host_user_id',
    'code',
    'name',
    'status',
    'current_song_id',
    'provider',
    'track_uri',
    'track_title',
    'track_artist',
    'album_art_url',
    'position_ms',
    'is_playing',
    'playback_updated_at',
])]
class ListeningRoom extends Model
{
    protected function casts(): array
    {
        return [
            'is_playing' => 'boolean',
            'position_ms' => 'integer',
            'playback_updated_at' => 'datetime',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(User::class, 'host_user_id');
    }

    public function currentSong(): BelongsTo
    {
        return $this->belongsTo(Song::class, 'current_song_id');
    }

    public function members(): HasMany
    {
        return $this->hasMany(ListeningRoomMember::class);
    }

    public function queueItems(): HasMany
    {
        return $this->hasMany(ListeningRoomQueueItem::class)->orderBy('position');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(ListeningRoomMessage::class);
    }

    public function reactions(): HasMany
    {
        return $this->hasMany(ListeningRoomReaction::class);
    }

    public function isOpen(): bool
    {
        return $this->status === 'open';
    }

    public function estimatedPositionMs(?\DateTimeInterface $now = null): int
    {
        $base = (int) $this->position_ms;
        if (! $this->is_playing || ! $this->playback_updated_at) {
            return $base;
        }

        $nowCarbon = $now ? Carbon::instance(\DateTimeImmutable::createFromInterface($now)) : now();
        $elapsed = (int) $this->playback_updated_at->diffInMilliseconds($nowCarbon, false);

        return max(0, $base + max(0, $elapsed));
    }
}
