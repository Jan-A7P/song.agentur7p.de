<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\Pivot;

class SongFavorite extends Pivot
{
    use HasUuids;

    protected $table = 'song_favorites';
}
