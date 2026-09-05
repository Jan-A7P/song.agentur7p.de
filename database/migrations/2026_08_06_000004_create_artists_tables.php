<?php

use App\Models\Song;
use App\Services\ArtistService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('artists', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('slug')->unique();
            $table->string('normalized_name')->unique();
            $table->timestamps();

            $table->index('name');
        });

        Schema::create('artist_song', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('artist_id')->constrained('artists')->cascadeOnDelete();
            $table->foreignUuid('song_id')->constrained('songs')->cascadeOnDelete();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['artist_id', 'song_id']);
            $table->index(['song_id', 'position']);
        });

        $service = app(ArtistService::class);

        Song::query()->orderBy('id')->chunkById(100, function ($songs) use ($service) {
            foreach ($songs as $song) {
                $service->syncSongArtists($song);
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('artist_song');
        Schema::dropIfExists('artists');
    }
};
