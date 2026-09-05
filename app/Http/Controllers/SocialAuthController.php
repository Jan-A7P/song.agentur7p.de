<?php

namespace App\Http\Controllers;

use App\Services\GoogleOAuthService;
use App\Services\SocialAuthService;
use App\Services\SpotifyService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class SocialAuthController extends Controller
{
    public function __construct(
        private GoogleOAuthService $google,
        private SpotifyService $spotify,
        private SocialAuthService $socialAuth,
    ) {}

    public function redirect(Request $request, string $provider): RedirectResponse
    {
        $provider = strtolower($provider);
        abort_unless(in_array($provider, ['google', 'spotify'], true), 404);

        if (Auth::check()) {
            return redirect('/');
        }

        $intent = $this->socialAuth->safeRedirectPath($request->string('redirect')->toString());
        $state = Str::random(40);

        $request->session()->put('social_oauth_provider', $provider);
        $request->session()->put('social_oauth_state', $state);
        $request->session()->put('social_oauth_redirect', $intent);

        if ($provider === 'google') {
            abort_unless($this->google->isConfigured(), 503, 'Google Login ist nicht konfiguriert.');

            return redirect()->away($this->google->authorizationUrl($state));
        }

        abort_unless($this->spotify->isLoginConfigured(), 503, 'Spotify Login ist nicht konfiguriert.');

        return redirect()->away(
            $this->spotify->authorizationUrl($state, forceConsent: false, redirectUri: $this->spotify->loginRedirectUri())
        );
    }

    public function callback(Request $request, string $provider): RedirectResponse
    {
        $provider = strtolower($provider);
        abort_unless(in_array($provider, ['google', 'spotify'], true), 404);

        $intent = $this->socialAuth->safeRedirectPath(
            $request->session()->pull('social_oauth_redirect', '/')
        );

        $fail = fn (string $status) => redirect(
            $this->socialAuth->redirectWithAuthQuery('/login', $status)
        );

        if ($request->string('error')->isNotEmpty()) {
            return $fail('denied');
        }

        $expectedProvider = $request->session()->pull('social_oauth_provider');
        $state = $request->session()->pull('social_oauth_state');

        if ($expectedProvider !== $provider || ! $state || $state !== $request->string('state')->toString()) {
            return $fail('invalid_state');
        }

        $code = $request->string('code')->toString();
        if ($code === '') {
            return $fail('missing_code');
        }

        try {
            if ($provider === 'google') {
                $tokens = $this->google->exchangeCode($code);
                $profile = $this->google->fetchProfile($tokens['access_token']);
                $user = $this->socialAuth->findOrCreateUser('google', $profile);
            } else {
                $loginRedirect = $this->spotify->loginRedirectUri();
                $tokens = $this->spotify->exchangeCode($code, $loginRedirect);
                $profile = $this->spotify->fetchProfile($tokens['access_token']);
                $user = $this->socialAuth->findOrCreateUser('spotify', $profile, $tokens);
            }
        } catch (\Throwable) {
            return $fail('failed');
        }

        Auth::login($user, remember: true);
        $request->session()->regenerate();

        return redirect($intent);
    }
}
