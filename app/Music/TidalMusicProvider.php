<?php

namespace App\Music;

use App\Contracts\MusicProviderContract;
use App\Enums\MusicProvider;
use App\Models\User;
use App\Services\TidalService;

class TidalMusicProvider implements MusicProviderContract
{
    public function __construct(private TidalService $tidal) {}

    public function id(): string
    {
        return MusicProvider::Tidal->value;
    }

    public function label(): string
    {
        return MusicProvider::Tidal->label();
    }

    public function isConfigured(): bool
    {
        return $this->tidal->isConfigured();
    }

    public function getAccessToken(User $user): string
    {
        return $this->tidal->getAccessToken($user);
    }

    public function disconnect(User $user): void
    {
        $this->tidal->disconnect($user);
    }

    public function searchTracks(string $query, int $limit = 10): array
    {
        return $this->tidal->searchTracks($query, $limit);
    }

    public function getUserPlaylists(User $user, int $limit = 50): array
    {
        return $this->tidal->getUserPlaylists($user, $limit);
    }

    public function getPlaylistTracks(User $user, string $playlistId): array
    {
        return $this->tidal->getPlaylistTracks($user, $playlistId);
    }

    public function playUri(User $user, string $uri, string $deviceId, int $positionMs = 0): void
    {
        $this->tidal->playUri($user, $uri, $deviceId, $positionMs);
    }

    public function clientId(): ?string
    {
        return $this->tidal->isConfigured() ? $this->tidal->publicClientId() : null;
    }
}
