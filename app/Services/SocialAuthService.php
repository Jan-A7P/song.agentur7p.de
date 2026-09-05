<?php

namespace App\Services;

use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class SocialAuthService
{
    public function __construct(private SpotifyService $spotify) {}

    /**
     * @param  array{id: string, email: string, name: string, avatar?: string|null}  $profile
     * @param  array{access_token: string, refresh_token?: string, expires_in?: int}|null  $spotifyTokens
     */
    public function findOrCreateUser(string $provider, array $profile, ?array $spotifyTokens = null): User
    {
        return DB::transaction(function () use ($provider, $profile, $spotifyTokens) {
            $account = SocialAccount::query()
                ->where('provider', $provider)
                ->where('provider_user_id', $profile['id'])
                ->first();

            if ($account) {
                $user = $account->user;
            } else {
                $user = User::query()->where('email', $profile['email'])->first();

                if (! $user) {
                    $user = User::create([
                        'name' => $profile['name'],
                        'email' => $profile['email'],
                        'password' => null,
                        'email_verified_at' => now(),
                    ]);
                } elseif ($user->email_verified_at === null) {
                    $user->forceFill(['email_verified_at' => now()])->save();
                }

                SocialAccount::create([
                    'user_id' => $user->id,
                    'provider' => $provider,
                    'provider_user_id' => $profile['id'],
                ]);
            }

            $user->applySocialAvatar($profile['avatar'] ?? null);

            if ($provider === 'spotify' && $spotifyTokens !== null) {
                $this->spotify->storeTokens($user, $spotifyTokens, bumpToFront: true);
            }

            return $user->fresh();
        });
    }

    public function safeRedirectPath(?string $path): string
    {
        if (! is_string($path) || $path === '' || ! str_starts_with($path, '/') || str_starts_with($path, '//')) {
            return '/';
        }

        return $path;
    }

    public function redirectWithAuthQuery(string $path, string $status): string
    {
        $separator = str_contains($path, '?') ? '&' : '?';

        return $path.$separator.'auth='.$status;
    }
}
