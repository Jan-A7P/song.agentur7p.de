<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            if ($this->hasUniqueIndex('songs', 'songs_tidal_track_id_unique')) {
                $table->dropUnique('songs_tidal_track_id_unique');
            }
        });

        Schema::table('songs', function (Blueprint $table) {
            if (Schema::hasColumn('songs', 'tidal_track_id')) {
                $table->dropColumn('tidal_track_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->string('tidal_track_id')->nullable()->after('spotify_uri');
        });

        Schema::table('songs', function (Blueprint $table) {
            $table->unique('tidal_track_id');
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
