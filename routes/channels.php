<?php

use App\Models\ListeningRoom;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (string) $user->id === (string) $id;
});

Broadcast::channel('listening-room.{code}', function ($user, string $code) {
    $room = ListeningRoom::query()
        ->where('code', strtoupper($code))
        ->where('status', 'open')
        ->first();

    if (! $room) {
        return false;
    }

    $member = $room->members()->where('user_id', $user->id)->first();
    if (! $member) {
        return false;
    }

    return [
        'id' => $user->id,
        'name' => $user->name,
        'role' => $member->role,
    ];
});
