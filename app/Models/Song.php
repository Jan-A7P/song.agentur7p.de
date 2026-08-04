<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'title',
    'artist',
    'lyrics',
    'provider',
    'preferred_provider',
    'last_working_provider',
    'provider_track_id',
    'provider_uri',
    'album_art_url',
    'duration_ms',
    'play_count',
    'total_listen_ms',
    'last_played_at',
    'user_id',
])]
class Song extends Model
{
    protected $with = ['providers'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'duration_ms' => 'integer',
            'play_count' => 'integer',
            'total_listen_ms' => 'integer',
            'last_played_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function playlists(): BelongsToMany
    {
        return $this->belongsToMany(Playlist::class)
            ->withPivot(['id', 'position'])
            ->withTimestamps();
    }

    public function favoritedBy(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'song_favorites')->withTimestamps();
    }

    public function plays(): HasMany
    {
        return $this->hasMany(SongPlay::class);
    }

    public function providers(): HasMany
    {
        return $this->hasMany(SongProvider::class)->orderBy('provider');
    }

    public function isPlayable(): bool
    {
        if ($this->relationLoaded('providers') && $this->providers->isNotEmpty()) {
            return true;
        }

        return filled($this->provider) && filled($this->provider_uri);
    }

    public function linkFor(?string $provider): ?SongProvider
    {
        if (! filled($provider)) {
            return null;
        }

        if ($this->relationLoaded('providers')) {
            return $this->providers->firstWhere('provider', $provider);
        }

        return $this->providers()->where('provider', $provider)->first();
    }
}
