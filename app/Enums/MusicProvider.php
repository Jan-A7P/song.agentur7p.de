<?php

namespace App\Enums;

enum MusicProvider: string
{
    case Spotify = 'spotify';

    public function label(): string
    {
        return match ($this) {
            self::Spotify => 'Spotify',
        };
    }
}
