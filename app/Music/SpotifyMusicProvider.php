<?php

namespace App\Music;

use App\Contracts\MusicProviderContract;
use App\Enums\MusicProvider;
use App\Models\User;
use App\Services\SpotifyService;

class SpotifyMusicProvider implements MusicProviderContract
{
    public function __construct(private SpotifyService $spotify) {}

    public function id(): string
    {
        return MusicProvider::Spotify->value;
    }

    public function label(): string
    {
        return MusicProvider::Spotify->label();
    }

    public function isConfigured(): bool
    {
        return $this->spotify->isConfigured();
    }

    public function getAccessToken(User $user): string
    {
        return $this->spotify->getAccessToken($user);
    }

    public function disconnect(User $user): void
    {
        $this->spotify->disconnect($user);
    }

    public function searchTracks(string $query, int $limit = 10): array
    {
        return $this->spotify->searchTracks($query, $limit);
    }

    public function getUserPlaylists(User $user, int $limit = 50): array
    {
        return $this->spotify->getUserPlaylists($user, $limit);
    }

    public function getPlaylistTracks(User $user, string $playlistId): array
    {
        return $this->spotify->getPlaylistTracks($user, $playlistId);
    }

    public function playUri(User $user, string $uri, string $deviceId, int $positionMs = 0): void
    {
        $this->spotify->playUri($user, $uri, $deviceId, $positionMs);
    }
}
