<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[Fillable([
    'name',
    'slug',
    'normalized_name',
])]
class Artist extends Model
{
    use HasUuids;

    /**
     * @var list<string>
     */
    protected $hidden = [
        'normalized_name',
        'created_at',
        'updated_at',
        'pivot',
    ];

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    public function songs(): BelongsToMany
    {
        return $this->belongsToMany(Song::class)
            ->using(ArtistSong::class)
            ->withPivot(['id', 'position'])
            ->withTimestamps()
            ->orderByPivot('position');
    }
}
