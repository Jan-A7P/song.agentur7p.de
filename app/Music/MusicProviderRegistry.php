<?php

namespace App\Music;

use App\Contracts\MusicProviderContract;
use App\Enums\MusicProvider;
use App\Models\User;
use App\Services\MusicConnectionService;
use App\Services\SpotifyService;
use App\Services\TidalService;
use InvalidArgumentException;

class MusicProviderRegistry
{
    public function __construct(
        private SpotifyService $spotify,
        private TidalService $tidal,
        private MusicConnectionService $connections,
    ) {}

    public function resolve(string|MusicProvider $provider): MusicProviderContract
    {
        $enum = $provider instanceof MusicProvider
            ? $provider
            : MusicProvider::tryFrom(strtolower($provider));

        if (! $enum) {
            throw new InvalidArgumentException('Unbekannter Musik-Anbieter: '.(string) $provider);
        }

        return match ($enum) {
            MusicProvider::Spotify => new SpotifyMusicProvider($this->spotify),
            MusicProvider::Tidal => new TidalMusicProvider($this->tidal),
        };
    }

    /**
     * @return list<array{id: string, label: string, configured: bool}>
     */
    public function listProviders(): array
    {
        return collect(MusicProvider::cases())->map(function (MusicProvider $provider) {
            $adapter = $this->resolve($provider);

            return [
                'id' => $adapter->id(),
                'label' => $adapter->label(),
                'configured' => $adapter->isConfigured(),
            ];
        })->values()->all();
    }

    public function isConnected(User $user, string|MusicProvider $provider): bool
    {
        $enum = $provider instanceof MusicProvider
            ? $provider
            : MusicProvider::from(strtolower((string) $provider));

        return $this->connections->isConnected($user, $enum);
    }
}
