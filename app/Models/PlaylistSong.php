<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\Pivot;

class PlaylistSong extends Pivot
{
    use HasUuids;

    protected $table = 'playlist_song';
}
