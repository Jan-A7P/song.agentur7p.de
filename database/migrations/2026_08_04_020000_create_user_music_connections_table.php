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
        Schema::create('user_music_connections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('provider', 32);
            $table->text('access_token')->nullable();
            $table->text('refresh_token')->nullable();
            $table->timestamp('token_expires_at')->nullable();
            $table->string('external_user_id')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamp('connected_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'provider']);
            $table->index(['user_id', 'sort_order']);
        });

        $users = DB::table('users')
            ->whereNotNull('spotify_refresh_token')
            ->get(['id', 'spotify_access_token', 'spotify_refresh_token', 'spotify_token_expires_at']);

        foreach ($users as $index => $user) {
            DB::table('user_music_connections')->insert([
                'id' => (string) Str::uuid(),
                'user_id' => $user->id,
                'provider' => 'spotify',
                'access_token' => $user->spotify_access_token,
                'refresh_token' => $user->spotify_refresh_token,
                'token_expires_at' => $user->spotify_token_expires_at,
                'external_user_id' => null,
                'sort_order' => 0,
                'connected_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        Schema::table('songs', function (Blueprint $table) {
            $table->string('tidal_track_id')->nullable()->after('spotify_uri');
        });
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->dropColumn('tidal_track_id');
        });

        Schema::dropIfExists('user_music_connections');
    }
};
