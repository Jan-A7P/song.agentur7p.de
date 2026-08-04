<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('songs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->string('artist');
            $table->text('lyrics');
            $table->string('spotify_track_id')->nullable();
            $table->string('spotify_uri')->nullable();
            $table->string('album_art_url', 2048)->nullable();
            $table->timestamps();

            $table->index(['title', 'artist']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('songs');
    }
};
