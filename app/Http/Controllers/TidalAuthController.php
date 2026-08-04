<?php

namespace App\Http\Controllers;

use App\Services\TidalService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

class TidalAuthController extends Controller
{
    public function __construct(private TidalService $tidal) {}

    public function redirect(Request $request): RedirectResponse
    {
        abort_unless(Auth::check(), 401);
        abort_unless($this->tidal->isConfigured(), 503, 'TIDAL is not configured.');

        $state = Str::random(40);
        $pkce = $this->tidal->createPkcePair();

        $request->session()->put('tidal_oauth_state', $state);
        $request->session()->put('tidal_oauth_code_verifier', $pkce['verifier']);

        $redirect = $request->string('redirect')->toString();
        if ($redirect === '' || ! str_starts_with($redirect, '/')) {
            $redirect = '/settings';
        }
        $request->session()->put('tidal_oauth_redirect', $redirect);

        $force = $request->boolean('force');

        return redirect()->away($this->tidal->authorizationUrl($state, $pkce['challenge'], $force));
    }

    public function callback(Request $request): RedirectResponse
    {
        abort_unless(Auth::check(), 401);

        $redirect = $request->session()->pull('tidal_oauth_redirect', '/settings');
        if (! is_string($redirect) || $redirect === '' || ! str_starts_with($redirect, '/')) {
            $redirect = '/settings';
        }

        $query = http_build_query(['tidal' => 'error']);

        if ($request->string('error')->isNotEmpty()) {
            return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').$query);
        }

        $state = $request->session()->pull('tidal_oauth_state');
        $verifier = $request->session()->pull('tidal_oauth_code_verifier');

        if (! $state || $state !== $request->string('state')->toString() || ! is_string($verifier) || $verifier === '') {
            return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'tidal=invalid_state');
        }

        $code = $request->string('code')->toString();
        if ($code === '') {
            return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'tidal=missing_code');
        }

        try {
            $tokens = $this->tidal->exchangeCode($code, $verifier);
            $this->tidal->storeTokens($request->user(), $tokens);
        } catch (\Throwable) {
            return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'tidal=token_failed');
        }

        return redirect($redirect.(str_contains($redirect, '?') ? '&' : '?').'tidal=connected');
    }
}
