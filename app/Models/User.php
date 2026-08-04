<?php

namespace App\Models;

use App\Enums\MusicProvider;
use App\Services\MusicConnectionService;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Fillable([
    'name',
    'email',
    'password',
    'spotify_access_token',
    'spotify_refresh_token',
    'spotify_token_expires_at',
])]
#[Hidden([
    'password',
    'remember_token',
    'spotify_access_token',
    'spotify_refresh_token',
])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'spotify_token_expires_at' => 'datetime',
            'spotify_access_token' => 'encrypted',
            'spotify_refresh_token' => 'encrypted',
        ];
    }

    public function songs(): HasMany
    {
        return $this->hasMany(Song::class);
    }

    public function playlists(): HasMany
    {
        return $this->hasMany(Playlist::class);
    }

    public function listeningRooms(): HasMany
    {
        return $this->hasMany(ListeningRoom::class, 'host_user_id');
    }

    public function musicConnections(): HasMany
    {
        return $this->hasMany(MusicConnection::class);
    }

    public function hasSpotifyConnected(): bool
    {
        return app(MusicConnectionService::class)->isConnected($this, MusicProvider::Spotify)
            || filled($this->spotify_refresh_token);
    }
}
