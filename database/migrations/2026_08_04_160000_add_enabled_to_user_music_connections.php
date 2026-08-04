<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('user_music_connections', function (Blueprint $table) {
            $table->boolean('enabled')->default(true)->after('sort_order');
        });
    }

    public function down(): void
    {
        Schema::table('user_music_connections', function (Blueprint $table) {
            $table->dropColumn('enabled');
        });
    }
};
