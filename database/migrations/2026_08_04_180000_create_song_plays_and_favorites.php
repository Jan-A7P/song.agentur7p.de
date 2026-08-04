<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->unsignedBigInteger('play_count')->default(0)->after('album_art_url');
            $table->unsignedBigInteger('total_listen_ms')->default(0)->after('play_count');
            $table->timestamp('last_played_at')->nullable()->after('total_listen_ms');
        });

        Schema::create('song_plays', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('song_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 32)->nullable();
            $table->unsignedBigInteger('listened_ms')->default(0);
            $table->boolean('completed')->default(false);
            $table->timestamps();

            $table->index(['song_id', 'created_at']);
            $table->index(['user_id', 'created_at']);
        });

        Schema::create('song_favorites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('song_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'song_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('song_favorites');
        Schema::dropIfExists('song_plays');

        Schema::table('songs', function (Blueprint $table) {
            $table->dropColumn(['play_count', 'total_listen_ms', 'last_played_at']);
        });
    }
};
