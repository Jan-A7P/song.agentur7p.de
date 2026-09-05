<?php

use Illuminate\Database\Migrations\Migration;

/**
 * Listening-room tables were moved to 2026_08_04_000004 so they run after songs.
 * Kept as a no-op so existing migration history stays valid.
 */
return new class extends Migration
{
    public function up(): void
    {
        //
    }

    public function down(): void
    {
        //
    }
};
