<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('song_providers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('song_id')->constrained('songs')->cascadeOnDelete();
            $table->string('provider', 32);
            $table->string('provider_track_id');
            $table->string('provider_uri');
            $table->string('album_art_url', 2048)->nullable();
            $table->timestamps();

            $table->unique(['song_id', 'provider']);
            $table->unique(['provider', 'provider_track_id']);
            $table->index('song_id');
        });

        Schema::table('songs', function (Blueprint $table) {
            $table->string('preferred_provider', 32)->nullable()->after('provider');
            $table->string('last_working_provider', 32)->nullable()->after('preferred_provider');
        });

        $songs = DB::table('songs')
            ->whereNotNull('provider')
            ->whereNotNull('provider_track_id')
            ->whereNotNull('provider_uri')
            ->get(['id', 'provider', 'provider_track_id', 'provider_uri', 'album_art_url']);

        foreach ($songs as $song) {
            DB::table('song_providers')->insert([
                'id' => (string) Str::uuid(),
                'song_id' => $song->id,
                'provider' => $song->provider,
                'provider_track_id' => $song->provider_track_id,
                'provider_uri' => $song->provider_uri,
                'album_art_url' => $song->album_art_url,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('songs')->where('id', $song->id)->update([
                'preferred_provider' => $song->provider,
                'last_working_provider' => $song->provider,
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->dropColumn(['preferred_provider', 'last_working_provider']);
        });

        Schema::dropIfExists('song_providers');
    }
};
