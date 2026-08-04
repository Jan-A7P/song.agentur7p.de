<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Tidal was dropped; leftover connection rows break MusicProvider enum casts.
        DB::table('user_music_connections')
            ->whereNotIn('provider', ['spotify'])
            ->delete();

        DB::table('songs')
            ->whereNotNull('provider')
            ->whereNotIn('provider', ['spotify'])
            ->update([
                'provider' => null,
                'provider_track_id' => null,
                'provider_uri' => null,
            ]);

        DB::table('listening_rooms')
            ->whereNotNull('provider')
            ->whereNotIn('provider', ['spotify'])
            ->update([
                'provider' => null,
                'track_uri' => null,
            ]);

        DB::table('listening_room_queue_items')
            ->whereNotNull('provider')
            ->whereNotIn('provider', ['spotify'])
            ->delete();
    }

    public function down(): void
    {
        // Irreversible cleanup of unsupported provider rows.
    }
};
