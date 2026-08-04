<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Deduplicate existing rows before unique indexes (keep lowest id).
        $this->dedupeByColumn('spotify_track_id');
        $this->dedupeByColumn('tidal_track_id');

        Schema::table('songs', function (Blueprint $table) {
            $table->unique('spotify_track_id');
            $table->unique('tidal_track_id');
        });
    }

    public function down(): void
    {
        Schema::table('songs', function (Blueprint $table) {
            $table->dropUnique(['spotify_track_id']);
            $table->dropUnique(['tidal_track_id']);
        });
    }

    private function dedupeByColumn(string $column): void
    {
        $duplicates = DB::table('songs')
            ->select($column, DB::raw('MIN(id) as keep_id'), DB::raw('COUNT(*) as c'))
            ->whereNotNull($column)
            ->where($column, '!=', '')
            ->groupBy($column)
            ->having('c', '>', 1)
            ->get();

        foreach ($duplicates as $row) {
            $ids = DB::table('songs')
                ->where($column, $row->{$column})
                ->where('id', '!=', $row->keep_id)
                ->pluck('id');

            foreach ($ids as $dupId) {
                // Move playlist pivots to kept song when missing
                $pivots = DB::table('playlist_song')->where('song_id', $dupId)->get();
                foreach ($pivots as $pivot) {
                    $exists = DB::table('playlist_song')
                        ->where('playlist_id', $pivot->playlist_id)
                        ->where('song_id', $row->keep_id)
                        ->exists();

                    if ($exists) {
                        DB::table('playlist_song')->where('id', $pivot->id)->delete();
                    } else {
                        DB::table('playlist_song')->where('id', $pivot->id)->update(['song_id' => $row->keep_id]);
                    }
                }

                DB::table('songs')->where('id', $dupId)->delete();
            }
        }
    }
};
