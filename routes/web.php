<?php

use App\Http\Controllers\SpotifyAuthController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth')->group(function () {
    // Canonical OAuth paths
    Route::get('/music/spotify/redirect', [SpotifyAuthController::class, 'redirect'])->name('music.spotify.redirect');
    Route::get('/music/spotify/callback', [SpotifyAuthController::class, 'callback'])->name('music.spotify.callback');

    // Legacy aliases (Spotify dashboard redirect URI may still point here)
    Route::get('/spotify/redirect', [SpotifyAuthController::class, 'redirect'])->name('spotify.redirect');
    Route::get('/spotify/callback', [SpotifyAuthController::class, 'callback'])->name('spotify.callback');
});

Route::view('/', 'app');
Route::view('/{any}', 'app')
    ->where('any', '^(?!api|sanctum|spotify|music|broadcasting|up|storage|build|vendor).*$');
