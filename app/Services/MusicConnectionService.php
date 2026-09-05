<?php

namespace App\Services;

use App\Enums\MusicProvider;
use App\Models\MusicConnection;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class MusicConnectionService
{
    /**
     * @return Collection<int, MusicConnection>
     */
    public function connectionsFor(User $user): Collection
    {
        return $user->musicConnections()->orderBy('sort_order')->orderBy('connected_at')->get()
            ->filter(fn (MusicConnection $connection) => MusicProvider::tryFrom($connection->provider) !== null)
            ->values();
    }

    public function get(User $user, MusicProvider $provider): ?MusicConnection
    {
        return $user->musicConnections()->where('provider', $provider->value)->first();
    }

    public function isLinked(User $user, MusicProvider $provider): bool
    {
        $connection = $this->get($user, $provider);
        if ($connection !== null) {
            return $connection->isLinked();
        }

        // Legacy Spotify tokens only when no connection row exists yet.
        return $provider === MusicProvider::Spotify && filled($user->spotify_refresh_token);
    }

    public function isConnected(User $user, MusicProvider $provider): bool
    {
        $connection = $this->get($user, $provider);
        if ($connection !== null) {
            return $connection->isEnabled();
        }

        // Legacy Spotify tokens only when no connection row exists yet.
        return $provider === MusicProvider::Spotify && filled($user->spotify_refresh_token);
    }

    public function activeProvider(User $user): ?MusicProvider
    {
        foreach ($this->connectionsFor($user) as $connection) {
            if ($connection->isEnabled()) {
                return MusicProvider::tryFrom((string) $connection->provider);
            }
        }

        if (! $this->get($user, MusicProvider::Spotify) && filled($user->spotify_refresh_token)) {
            return MusicProvider::Spotify;
        }

        return null;
    }

    /**
     * @return list<array{provider: string, connected: bool, enabled: bool}>
     */
    public function connectionsPayload(User $user): array
    {
        return collect($this->statusPayload($user))
            ->map(fn (array $row) => [
                'provider' => $row['provider'],
                'connected' => $row['connected'],
                'enabled' => $row['enabled'],
            ])
            ->values()
            ->all();
    }

    /**
     * @param  list<string>  $providers
     */
    public function reorder(User $user, array $providers): Collection
    {
        $allowed = collect(MusicProvider::cases())->map->value->all();
        $normalized = collect($providers)
            ->map(fn ($p) => strtolower((string) $p))
            ->filter(fn ($p) => in_array($p, $allowed, true))
            ->unique()
            ->values();

        $existing = $this->connectionsFor($user)->keyBy(fn (MusicConnection $c) => (string) $c->provider);

        DB::transaction(function () use ($normalized, $existing) {
            $order = 0;
            foreach ($normalized as $provider) {
                if (! $existing->has($provider)) {
                    continue;
                }
                $existing[$provider]->update(['sort_order' => $order]);
                $order++;
            }

            foreach ($existing as $provider => $connection) {
                if ($normalized->contains($provider)) {
                    continue;
                }
                $connection->update(['sort_order' => $order]);
                $order++;
            }
        });

        return $this->connectionsFor($user->fresh());
    }

    public function bumpToFront(User $user, MusicProvider $provider): MusicConnection
    {
        return DB::transaction(function () use ($user, $provider) {
            $user->musicConnections()->where('provider', '!=', $provider->value)->increment('sort_order');

            $connection = $user->musicConnections()->where('provider', $provider->value)->first();
            if (! $connection) {
                throw new RuntimeException(__('Connection not found.'));
            }

            $connection->update([
                'sort_order' => 0,
                'connected_at' => now(),
            ]);

            return $connection->fresh();
        });
    }

    public function setEnabled(User $user, MusicProvider $provider, bool $enabled): MusicConnection
    {
        return DB::transaction(function () use ($user, $provider, $enabled) {
            $connection = $this->get($user, $provider);

            // Promote legacy Spotify tokens into a connection row so enable/disable works.
            if (
                ! $connection
                && $provider === MusicProvider::Spotify
                && filled($user->spotify_refresh_token)
            ) {
                $connection = $user->musicConnections()->create([
                    'provider' => MusicProvider::Spotify->value,
                    'access_token' => $user->spotify_access_token,
                    'refresh_token' => $user->spotify_refresh_token,
                    'token_expires_at' => $user->spotify_token_expires_at,
                    'enabled' => true,
                    'sort_order' => 0,
                    'connected_at' => now(),
                ]);
            }

            if (! $connection || ! $connection->isLinked()) {
                throw new RuntimeException(__('Connection not found.'));
            }

            $connection->forceFill(['enabled' => $enabled])->save();

            if ($enabled) {
                $user->musicConnections()
                    ->where('provider', '!=', $provider->value)
                    ->increment('sort_order');

                $connection->forceFill([
                    'sort_order' => 0,
                    'connected_at' => now(),
                ])->save();
            }

            return $connection->fresh();
        });
    }

    public function upsertTokens(
        User $user,
        MusicProvider $provider,
        array $tokens,
        ?string $externalUserId = null,
        bool $bumpToFront = false,
    ): MusicConnection {
        $connection = $user->musicConnections()->where('provider', $provider->value)->first();

        $payload = [
            'access_token' => $tokens['access_token'],
            'refresh_token' => $tokens['refresh_token'] ?? $connection?->refresh_token,
            'token_expires_at' => now()->addSeconds((int) ($tokens['expires_in'] ?? 3600) - 60),
        ];

        if ($externalUserId !== null) {
            $payload['external_user_id'] = $externalUserId;
        }

        if ($connection) {
            if ($bumpToFront) {
                $payload['connected_at'] = now();
                $payload['enabled'] = true;
            }
            $connection->update($payload);
        } else {
            $maxOrder = (int) $user->musicConnections()->max('sort_order');
            $connection = $user->musicConnections()->create([
                ...$payload,
                'provider' => $provider->value,
                'enabled' => true,
                'sort_order' => $user->musicConnections()->exists() ? $maxOrder + 1 : 0,
                'connected_at' => now(),
            ]);
        }

        if ($bumpToFront) {
            $this->bumpToFront($user, $provider);
        }

        // Keep legacy Spotify columns in sync for transitional reads
        if ($provider === MusicProvider::Spotify) {
            $fresh = $this->get($user->fresh(), $provider);
            $user->forceFill([
                'spotify_access_token' => $fresh?->access_token,
                'spotify_refresh_token' => $fresh?->refresh_token,
                'spotify_token_expires_at' => $fresh?->token_expires_at,
            ])->save();
        }

        return $this->get($user->fresh(), $provider);
    }

    public function disconnect(User $user, MusicProvider $provider): void
    {
        $user->musicConnections()->where('provider', $provider->value)->delete();

        // Keep legacy Spotify columns in sync when disconnecting Spotify
        if ($provider === MusicProvider::Spotify) {
            $user->forceFill([
                'spotify_access_token' => null,
                'spotify_refresh_token' => null,
                'spotify_token_expires_at' => null,
            ])->save();
        }
    }

    /**
     * @return list<array{provider: string, label: string, connected: bool, enabled: bool, sort_order: int|null, connected_at: string|null}>
     */
    public function statusPayload(User $user): array
    {
        return collect(MusicProvider::cases())->map(function (MusicProvider $provider) use ($user) {
            $row = $this->get($user, $provider);
            $linked = $this->isLinked($user, $provider);
            $enabled = $this->isConnected($user, $provider);

            return [
                'provider' => $provider->value,
                'label' => $provider->label(),
                'connected' => $linked,
                'enabled' => $enabled,
                'sort_order' => $row?->sort_order,
                'connected_at' => $row?->connected_at?->toIso8601String(),
                'id' => $row?->id,
            ];
        })->values()->all();
    }
}
