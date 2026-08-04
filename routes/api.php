<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ListeningRoomController;
use App\Http\Controllers\Api\LyricsController;
use App\Http\Controllers\Api\PlaylistController;
use App\Http\Controllers\Api\SongController;
use App\Http\Controllers\Api\SpotifyController;
use Illuminate\Support\Facades\Route;

Route::post('/register', [AuthController::class, 'register']);
Route::post('/login', [AuthController::class, 'login']);

Route::get('/songs', [SongController::class, 'index']);
Route::get('/songs/{song}', [SongController::class, 'show']);

Route::get('/playlists', [PlaylistController::class, 'index']);
Route::get('/playlists/{playlist}', [PlaylistController::class, 'show']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', [AuthController::class, 'user']);
    Route::post('/logout', [AuthController::class, 'logout']);

    Route::post('/songs', [SongController::class, 'store']);
    Route::put('/songs/{song}', [SongController::class, 'update']);
    Route::patch('/songs/{song}', [SongController::class, 'update']);
    Route::delete('/songs/{song}', [SongController::class, 'destroy']);

    Route::post('/playlists', [PlaylistController::class, 'store']);
    Route::put('/playlists/{playlist}', [PlaylistController::class, 'update']);
    Route::patch('/playlists/{playlist}', [PlaylistController::class, 'update']);
    Route::delete('/playlists/{playlist}', [PlaylistController::class, 'destroy']);
    Route::post('/playlists/{playlist}/songs', [PlaylistController::class, 'addSong']);
    Route::delete('/playlists/{playlist}/songs/{song}', [PlaylistController::class, 'removeSong']);
    Route::put('/playlists/{playlist}/reorder', [PlaylistController::class, 'reorder']);

    Route::get('/spotify/status', [SpotifyController::class, 'status']);
    Route::get('/spotify/token', [SpotifyController::class, 'token']);
    Route::get('/spotify/search', [SpotifyController::class, 'search']);
    Route::get('/spotify/playlists', [SpotifyController::class, 'playlists']);
    Route::post('/spotify/playlists/import', [SpotifyController::class, 'importPlaylist']);
    Route::post('/spotify/play', [SpotifyController::class, 'play']);
    Route::post('/spotify/disconnect', [SpotifyController::class, 'disconnect']);

    Route::get('/lyrics/lookup', [LyricsController::class, 'lookup']);

    Route::get('/rooms', [ListeningRoomController::class, 'index']);
    Route::post('/rooms', [ListeningRoomController::class, 'store']);
    Route::get('/rooms/{code}', [ListeningRoomController::class, 'show']);
    Route::post('/rooms/{code}/join', [ListeningRoomController::class, 'join']);
    Route::post('/rooms/{code}/leave', [ListeningRoomController::class, 'leave']);
    Route::post('/rooms/{code}/close', [ListeningRoomController::class, 'close']);
    Route::post('/rooms/{code}/playback', [ListeningRoomController::class, 'playback']);
    Route::post('/rooms/{code}/queue', [ListeningRoomController::class, 'addQueue']);
    Route::delete('/rooms/{code}/queue/{item}', [ListeningRoomController::class, 'removeQueue']);
    Route::post('/rooms/{code}/queue/{item}/vote', [ListeningRoomController::class, 'vote']);
    Route::get('/rooms/{code}/messages', [ListeningRoomController::class, 'messages']);
    Route::post('/rooms/{code}/messages', [ListeningRoomController::class, 'postMessage']);
    Route::post('/rooms/{code}/reactions', [ListeningRoomController::class, 'react']);
    Route::post('/rooms/{code}/members/{user}/role', [ListeningRoomController::class, 'setRole']);
});
