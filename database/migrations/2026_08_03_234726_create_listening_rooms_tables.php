<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('listening_rooms', function (Blueprint $table) {
            $table->id();
            $table->foreignId('host_user_id')->constrained('users')->cascadeOnDelete();
            $table->string('code', 12)->unique();
            $table->string('name');
            $table->string('status', 16)->default('open'); // open|closed
            $table->foreignId('current_song_id')->nullable()->constrained('songs')->nullOnDelete();
            $table->string('spotify_uri')->nullable();
            $table->string('track_title')->nullable();
            $table->string('track_artist')->nullable();
            $table->string('album_art_url', 2048)->nullable();
            $table->unsignedInteger('position_ms')->default(0);
            $table->boolean('is_playing')->default(false);
            $table->timestamp('playback_updated_at')->nullable();
            $table->timestamps();
        });

        Schema::create('listening_room_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listening_room_id')->constrained('listening_rooms')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('role', 16)->default('member'); // host|moderator|member
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();

            $table->unique(['listening_room_id', 'user_id']);
        });

        Schema::create('listening_room_queue_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listening_room_id')->constrained('listening_rooms')->cascadeOnDelete();
            $table->foreignId('song_id')->nullable()->constrained('songs')->nullOnDelete();
            $table->foreignId('added_by')->constrained('users')->cascadeOnDelete();
            $table->string('spotify_uri');
            $table->string('title');
            $table->string('artist');
            $table->string('album_art_url', 2048)->nullable();
            $table->unsignedInteger('position')->default(0);
            $table->string('status', 16)->default('queued'); // queued|playing|played|skipped
            $table->timestamps();

            $table->index(['listening_room_id', 'status', 'position'], 'lr_queue_room_status_pos_idx');
        });

        Schema::create('listening_room_votes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('queue_item_id')->constrained('listening_room_queue_items')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['queue_item_id', 'user_id']);
        });

        Schema::create('listening_room_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listening_room_id')->constrained('listening_rooms')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('body', 500);
            $table->timestamps();
        });

        Schema::create('listening_room_reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('listening_room_id')->constrained('listening_rooms')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('emoji', 16);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('listening_room_reactions');
        Schema::dropIfExists('listening_room_messages');
        Schema::dropIfExists('listening_room_votes');
        Schema::dropIfExists('listening_room_queue_items');
        Schema::dropIfExists('listening_room_members');
        Schema::dropIfExists('listening_rooms');
    }
};
