<?php

namespace App\Contracts;

use App\Models\User;

interface MusicProviderContract
{
    public function id(): string;

    public function label(): string;

    public function isConfigured(): bool;

    public function getAccessToken(User $user): string;

    public function disconnect(User $user): void;

    /**
     * @return list<array{id: string, uri: string, name: string, artist: string, album_art_url: string|null, duration_ms: int|null}>
     */
    public function searchTracks(string $query, int $limit = 10): array;

    /**
     * @return list<array{id: string, name: string, description: string|null, image_url: string|null, tracks_total: int, owner: string, can_import: bool}>
     */
    public function getUserPlaylists(User $user, int $limit = 50): array;

    /**
     * @return list<array{id: string, uri: string, name: string, artist: string, album_art_url: string|null}>
     */
    public function getPlaylistTracks(User $user, string $playlistId): array;

    public function playUri(User $user, string $uri, string $deviceId, int $positionMs = 0): void;

    public function clientId(): ?string;
}
