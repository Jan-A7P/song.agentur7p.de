<?php

namespace App\Models;

use App\Enums\MusicProvider;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'song_id',
    'provider',
    'provider_track_id',
    'provider_uri',
    'album_art_url',
])]
class SongProvider extends Model
{
    use HasUuids;

    protected $table = 'song_providers';

    public function song(): BelongsTo
    {
        return $this->belongsTo(Song::class);
    }

    public function providerEnum(): ?MusicProvider
    {
        return MusicProvider::tryFrom((string) $this->provider);
    }
}
