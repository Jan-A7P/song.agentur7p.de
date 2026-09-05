<?php

namespace App\Models;

use App\Enums\MusicProvider;
use App\Services\MusicConnectionService;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\HasApiTokens;

#[Fillable([
    'name',
    'email',
    'password',
    'avatar_path',
    'avatar_url',
    'spotify_access_token',
    'spotify_refresh_token',
    'spotify_token_expires_at',
])]
#[Hidden([
    'password',
    'remember_token',
    'spotify_access_token',
    'spotify_refresh_token',
    'avatar_path',
])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasUuids, Notifiable;

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

    public function favoriteSongs(): BelongsToMany
    {
        return $this->belongsToMany(Song::class, 'song_favorites')
            ->using(SongFavorite::class)
            ->withTimestamps();
    }

    public function songPlays(): HasMany
    {
        return $this->hasMany(SongPlay::class);
    }

    public function discoverySwipes(): HasMany
    {
        return $this->hasMany(DiscoverySwipe::class);
    }

    public function listeningRooms(): HasMany
    {
        return $this->hasMany(ListeningRoom::class, 'host_user_id');
    }

    public function musicConnections(): HasMany
    {
        return $this->hasMany(MusicConnection::class);
    }

    public function socialAccounts(): HasMany
    {
        return $this->hasMany(SocialAccount::class);
    }

    public function hasSpotifyConnected(): bool
    {
        return app(MusicConnectionService::class)->isConnected($this, MusicProvider::Spotify);
    }

    public function hasTidalConnected(): bool
    {
        return app(MusicConnectionService::class)->isConnected($this, MusicProvider::Tidal);
    }

    public function hasMusicConnected(): bool
    {
        return $this->hasSpotifyConnected() || $this->hasTidalConnected();
    }

    public function hasCustomAvatar(): bool
    {
        return filled($this->avatar_path);
    }

    public function resolvedAvatarUrl(): ?string
    {
        if ($this->hasCustomAvatar()) {
            return Storage::disk('public')->url($this->avatar_path);
        }

        return filled($this->avatar_url) ? $this->avatar_url : null;
    }

    /**
     * Take over a social provider avatar URL unless a custom upload exists.
     */
    public function applySocialAvatar(?string $url): void
    {
        if (! is_string($url) || $url === '' || $this->hasCustomAvatar()) {
            return;
        }

        if ($this->avatar_url === $url) {
            return;
        }

        $this->forceFill(['avatar_url' => $url])->save();
    }

    /**
     * @return array{
     *   id: string,
     *   name: string,
     *   email: string,
     *   avatar: string|null,
     *   has_custom_avatar: bool,
     *   music_connections: list<array{provider: string, connected: bool, enabled: bool}>,
     *   active_provider: string|null,
     *   spotify_connected: bool,
     * }
     */
    public function toApiArray(): array
    {
        $connections = app(MusicConnectionService::class);
        $active = $connections->activeProvider($this);

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'avatar' => $this->resolvedAvatarUrl(),
            'has_custom_avatar' => $this->hasCustomAvatar(),
            'music_connections' => $connections->connectionsPayload($this),
            'active_provider' => $active?->value,
            'spotify_connected' => $this->hasSpotifyConnected(),
        ];
    }
}
