<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class GoogleOAuthService
{
    private const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

    public const SCOPES = [
        'openid',
        'email',
        'profile',
    ];

    public function isConfigured(): bool
    {
        return filled($this->clientId()) && filled($this->clientSecret()) && filled($this->redirectUri());
    }

    public function authorizationUrl(string $state): string
    {
        $params = [
            'response_type' => 'code',
            'client_id' => $this->clientId(),
            'redirect_uri' => $this->redirectUri(),
            'scope' => implode(' ', self::SCOPES),
            'state' => $state,
            'access_type' => 'online',
            'prompt' => 'select_account',
        ];

        return self::AUTH_URL.'?'.http_build_query($params);
    }

    /**
     * @return array{access_token: string, expires_in?: int, id_token?: string, token_type?: string}
     */
    public function exchangeCode(string $code): array
    {
        $response = Http::asForm()->post(self::TOKEN_URL, [
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => $this->redirectUri(),
            'client_id' => $this->clientId(),
            'client_secret' => $this->clientSecret(),
        ]);

        if ($response->failed()) {
            throw new RuntimeException('Google token exchange failed: '.$response->body());
        }

        return $response->json();
    }

    /**
     * @return array{id: string, email: string, name: string, avatar: string|null}
     */
    public function fetchProfile(string $accessToken): array
    {
        $response = Http::withToken($accessToken)->get(self::USERINFO_URL);

        if ($response->failed()) {
            throw new RuntimeException('Google profile failed: '.$response->body());
        }

        $id = $response->json('sub');
        $email = $response->json('email');
        $name = $response->json('name') ?: $response->json('given_name') ?: 'Google User';
        $picture = $response->json('picture');

        if (! is_string($id) || $id === '') {
            throw new RuntimeException('Google profile missing user id.');
        }

        if (! is_string($email) || $email === '') {
            throw new RuntimeException('Google profile missing email.');
        }

        return [
            'id' => $id,
            'email' => $email,
            'name' => is_string($name) && $name !== '' ? $name : 'Google User',
            'avatar' => is_string($picture) && $picture !== '' ? $picture : null,
        ];
    }

    private function clientId(): string
    {
        return (string) config('services.google.client_id');
    }

    private function clientSecret(): string
    {
        return (string) config('services.google.client_secret');
    }

    private function redirectUri(): string
    {
        return (string) config('services.google.redirect');
    }
}
