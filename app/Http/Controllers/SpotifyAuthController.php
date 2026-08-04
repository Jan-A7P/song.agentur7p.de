<?php

namespace App\Http\Controllers;

use App\Services\SpotifyService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class SpotifyAuthController extends Controller
{
    public function __construct(private SpotifyService $spotify) {}

    public function redirect(Request $request): RedirectResponse
    {
        abort_unless(Auth::check(), 401);
        abort_unless($this->spotify->isConfigured(), 503, 'Spotify is not configured.');

        $state = Str::random(40);
        $request->session()->put('spotify_oauth_state', $state);

        $redirect = $request->string('redirect')->toString();
        if ($redirect === '' || ! str_starts_with($redirect, '/')) {
            $redirect = '/';
        }
        $request->session()->put('spotify_oauth_redirect', $redirect);

        $force = $request->boolean('force');

        return redirect()->away($this->spotify->authorizationUrl($state, $force));
    }

    public function callback(Request $request): RedirectResponse
    {
        abort_unless(Auth::check(), 401);

        $redirect = $request->session()->pull('spotify_oauth_redirect', '/');
        if (! is_string($redirect) || $redirect === '' || ! str_starts_with($redirect, '/')) {
            $redirect = '/';
        }

        if ($request->string('error')->isNotEmpty()) {
            return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'spotify=error');
        }

        $state = $request->session()->pull('spotify_oauth_state');

        if (! $state || $state !== $request->string('state')->toString()) {
            return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'spotify=invalid_state');
        }

        $code = $request->string('code')->toString();

        if ($code === '') {
            return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'spotify=missing_code');
        }

        try {
            $tokens = $this->spotify->exchangeCode($code);
            $this->spotify->storeTokens($request->user(), $tokens);
        } catch (\Throwable) {
            return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'spotify=token_failed');
        }

        return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'spotify=connected');
    }
}
