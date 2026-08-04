<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->unsignedInteger('duration_ms')->nullable()->after('album_art_url');
        });

        Schema::table('song_plays', function (Blueprint $table) {
            $table->unsignedInteger('duration_ms')->nullable()->after('provider');
        });
    }

    public function down(): void
    {
        Schema::table('song_plays', function (Blueprint $table) {
            $table->dropColumn('duration_ms');
        });

        Schema::table('songs', function (Blueprint $table) {
            $table->dropColumn('duration_ms');
        });
    }
};
