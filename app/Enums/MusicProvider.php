<?php

namespace App\Enums;

enum MusicProvider: string
{
    case Spotify = 'spotify';
    case Tidal = 'tidal';

    public function label(): string
    {
        return match ($this) {
            self::Spotify => 'Spotify',
            self::Tidal => 'TIDAL',
        };
    }
}
