<?php

namespace App\Models;

use App\Enums\MusicProvider;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'user_id',
    'provider',
    'access_token',
    'refresh_token',
    'token_expires_at',
    'external_user_id',
    'sort_order',
    'connected_at',
])]
class MusicConnection extends Model
{
    use HasUuids;

    protected $table = 'user_music_connections';

    protected function casts(): array
    {
        return [
            'token_expires_at' => 'datetime',
            'connected_at' => 'datetime',
            'access_token' => 'encrypted',
            'refresh_token' => 'encrypted',
            'sort_order' => 'integer',
        ];
    }

    public function providerEnum(): ?MusicProvider
    {
        return MusicProvider::tryFrom((string) $this->provider);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isTokenFresh(): bool
    {
        return $this->token_expires_at !== null && $this->token_expires_at->isFuture();
    }
}
