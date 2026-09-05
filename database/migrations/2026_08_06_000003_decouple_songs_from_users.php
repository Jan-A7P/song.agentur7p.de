<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->dropForeign(['user_id']);
        });

        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql') {
            DB::statement('ALTER TABLE songs MODIFY user_id CHAR(36) NULL');
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE songs ALTER COLUMN user_id DROP NOT NULL');
        } else {
            // sqlite / others: recreate handled by nullable recreate if needed
            Schema::table('songs', function (Blueprint $table) {
                $table->uuid('user_id')->nullable()->change();
            });
        }

        DB::table('songs')->update(['user_id' => null]);

        Schema::table('songs', function (Blueprint $table) {
            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->dropForeign(['user_id']);
        });

        // Cannot safely restore NOT NULL if nulls exist; leave nullable on rollback.
        Schema::table('songs', function (Blueprint $table) {
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }
};
