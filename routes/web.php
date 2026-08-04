<?php

use App\Http\Controllers\SpotifyAuthController;
use Illuminate\Support\Facades\Route;

Route::middleware('auth')->group(function () {
    Route::get('/spotify/redirect', [SpotifyAuthController::class, 'redirect'])->name('spotify.redirect');
    Route::get('/spotify/callback', [SpotifyAuthController::class, 'callback'])->name('spotify.callback');
});

Route::view('/', 'app');
Route::view('/{any}', 'app')
    ->where('any', '^(?!api|sanctum|spotify|broadcasting|up|storage|build|vendor).*$');
