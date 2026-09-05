<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('discovery_swipes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('song_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('provider', 32)->nullable();
            $table->string('provider_track_id')->nullable();
            $table->string('direction', 16);
            $table->timestamps();

            $table->index(['user_id', 'direction']);
            $table->index(['user_id', 'song_id']);
            $table->index(['user_id', 'provider', 'provider_track_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('discovery_swipes');
    }
};
