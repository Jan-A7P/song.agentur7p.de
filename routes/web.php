<?php

use App\Http\Controllers\SpotifyAuthController;
use App\Http\Controllers\TidalAuthController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth')->group(function () {
    Route::get('/music/spotify/redirect', [SpotifyAuthController::class, 'redirect'])->name('music.spotify.redirect');
    Route::get('/music/spotify/callback', [SpotifyAuthController::class, 'callback'])->name('music.spotify.callback');

    Route::get('/music/tidal/redirect', [TidalAuthController::class, 'redirect'])->name('music.tidal.redirect');
    Route::get('/music/tidal/callback', [TidalAuthController::class, 'callback'])->name('music.tidal.callback');

    // Legacy Spotify aliases
    Route::get('/spotify/redirect', [SpotifyAuthController::class, 'redirect'])->name('spotify.redirect');
    Route::get('/spotify/callback', [SpotifyAuthController::class, 'callback'])->name('spotify.callback');
});

Route::view('/', 'app');
Route::view('/{any}', 'app')
    ->where('any', '^(?!api|sanctum|spotify|music|broadcasting|up|storage|build|vendor).*$');
