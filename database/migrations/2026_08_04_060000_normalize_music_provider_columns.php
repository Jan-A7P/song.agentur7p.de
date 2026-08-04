<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            if ($this->hasUniqueIndex('songs', 'songs_spotify_track_id_unique')) {
                $table->dropUnique('songs_spotify_track_id_unique');
            }
        });

        Schema::table('songs', function (Blueprint $table) {
            if (! Schema::hasColumn('songs', 'provider')) {
                $table->string('provider', 32)->nullable()->after('lyrics');
            }
            if (Schema::hasColumn('songs', 'spotify_track_id') && ! Schema::hasColumn('songs', 'provider_track_id')) {
                $table->renameColumn('spotify_track_id', 'provider_track_id');
            }
            if (Schema::hasColumn('songs', 'spotify_uri') && ! Schema::hasColumn('songs', 'provider_uri')) {
                $table->renameColumn('spotify_uri', 'provider_uri');
            }
        });

        DB::table('songs')
            ->whereNotNull('provider_track_id')
            ->where(function ($q) {
                $q->whereNull('provider')->orWhere('provider', '');
            })
            ->update(['provider' => 'spotify']);

        Schema::table('songs', function (Blueprint $table) {
            if (! $this->hasUniqueIndex('songs', 'songs_provider_provider_track_id_unique')) {
                $table->unique(['provider', 'provider_track_id']);
            }
        });

        Schema::table('listening_rooms', function (Blueprint $table) {
            if (! Schema::hasColumn('listening_rooms', 'provider')) {
                $table->string('provider', 32)->nullable()->after('current_song_id');
            }
            if (Schema::hasColumn('listening_rooms', 'spotify_uri') && ! Schema::hasColumn('listening_rooms', 'track_uri')) {
                $table->renameColumn('spotify_uri', 'track_uri');
            }
        });

        DB::table('listening_rooms')
            ->whereNotNull('track_uri')
            ->where(function ($q) {
                $q->whereNull('provider')->orWhere('provider', '');
            })
            ->update(['provider' => 'spotify']);

        Schema::table('listening_room_queue_items', function (Blueprint $table) {
            if (! Schema::hasColumn('listening_room_queue_items', 'provider')) {
                $table->string('provider', 32)->nullable()->after('added_by');
            }
            if (Schema::hasColumn('listening_room_queue_items', 'spotify_uri') && ! Schema::hasColumn('listening_room_queue_items', 'track_uri')) {
                $table->renameColumn('spotify_uri', 'track_uri');
            }
        });

        DB::table('listening_room_queue_items')
            ->whereNotNull('track_uri')
            ->where(function ($q) {
                $q->whereNull('provider')->orWhere('provider', '');
            })
            ->update(['provider' => 'spotify']);
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            if ($this->hasUniqueIndex('songs', 'songs_provider_provider_track_id_unique')) {
                $table->dropUnique(['provider', 'provider_track_id']);
            }
        });

        Schema::table('songs', function (Blueprint $table) {
            if (Schema::hasColumn('songs', 'provider_track_id') && ! Schema::hasColumn('songs', 'spotify_track_id')) {
                $table->renameColumn('provider_track_id', 'spotify_track_id');
            }
            if (Schema::hasColumn('songs', 'provider_uri') && ! Schema::hasColumn('songs', 'spotify_uri')) {
                $table->renameColumn('provider_uri', 'spotify_uri');
            }
            if (Schema::hasColumn('songs', 'provider')) {
                $table->dropColumn('provider');
            }
        });

        Schema::table('songs', function (Blueprint $table) {
            $table->unique('spotify_track_id');
        });

        Schema::table('listening_rooms', function (Blueprint $table) {
            if (Schema::hasColumn('listening_rooms', 'track_uri') && ! Schema::hasColumn('listening_rooms', 'spotify_uri')) {
                $table->renameColumn('track_uri', 'spotify_uri');
            }
            if (Schema::hasColumn('listening_rooms', 'provider')) {
                $table->dropColumn('provider');
            }
        });

        Schema::table('listening_room_queue_items', function (Blueprint $table) {
            if (Schema::hasColumn('listening_room_queue_items', 'track_uri') && ! Schema::hasColumn('listening_room_queue_items', 'spotify_uri')) {
                $table->renameColumn('track_uri', 'spotify_uri');
            }
            if (Schema::hasColumn('listening_room_queue_items', 'provider')) {
                $table->dropColumn('provider');
            }
        });
    }

    private function hasUniqueIndex(string $table, string $indexName): bool
    {
        foreach (Schema::getIndexes($table) as $index) {
            if ($index['name'] === $indexName && $index['unique']) {
                return true;
            }
        }

        return false;
    }
};
