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
        if (! Schema::hasTable('songs')) {
            return;
        }

        if ($this->conversionComplete()) {
            return;
        }

        $driver = Schema::getConnection()->getDriverName();
        $this->disableForeignKeyChecks($driver);

        try {
            $this->dropAllForeignKeysOn([
                'playlist_song',
                'song_plays',
                'song_favorites',
                'song_providers',
                'listening_rooms',
                'listening_room_members',
                'listening_room_queue_items',
                'listening_room_messages',
                'listening_room_reactions',
                'songs',
                'playlists',
            ]);

            $songMap = $this->isUuidPrimary('songs')
                ? $this->recoverSongMap()
                : $this->convertPrimaryKeyToUuid('songs');

            $this->remapForeignColumn('playlist_song', 'song_id', $songMap);
            $this->remapForeignColumn('song_plays', 'song_id', $songMap);
            $this->remapForeignColumn('song_favorites', 'song_id', $songMap);
            $this->remapForeignColumn('song_providers', 'song_id', $songMap);
            $this->remapForeignColumn('listening_rooms', 'current_song_id', $songMap);
            $this->remapForeignColumn('listening_room_queue_items', 'song_id', $songMap);

            $playlistMap = $this->isUuidPrimary('playlists')
                ? []
                : $this->convertPrimaryKeyToUuid('playlists');
            if ($playlistMap !== []) {
                $this->remapForeignColumn('playlist_song', 'playlist_id', $playlistMap);
            } elseif (! $this->columnLooksLikeUuid('playlist_song', 'playlist_id')) {
                // Playlists already UUID but pivot still has ints — should not happen without map.
                throw new RuntimeException('playlist_song.playlist_id still needs remapping but playlists are already UUID.');
            }

            $roomMap = $this->isUuidPrimary('listening_rooms')
                ? []
                : $this->convertPrimaryKeyToUuid('listening_rooms');
            if ($roomMap !== []) {
                $this->remapForeignColumn('listening_room_members', 'listening_room_id', $roomMap);
                $this->remapForeignColumn('listening_room_queue_items', 'listening_room_id', $roomMap);
                $this->remapForeignColumn('listening_room_messages', 'listening_room_id', $roomMap);
                $this->remapForeignColumn('listening_room_reactions', 'listening_room_id', $roomMap);
            }

            $this->ensurePlaylistSongIndexes();
            $this->recreateForeignKeys();
        } finally {
            $this->enableForeignKeyChecks($driver);
        }
    }

    public function down(): void
    {
        // Irreversible: UUID primary keys cannot be restored to original autoincrement IDs.
    }

    private function conversionComplete(): bool
    {
        return $this->isUuidPrimary('songs')
            && $this->isUuidPrimary('playlists')
            && $this->isUuidPrimary('listening_rooms')
            && $this->columnLooksLikeUuid('song_providers', 'song_id')
            && $this->columnLooksLikeUuid('playlist_song', 'song_id')
            && $this->columnLooksLikeUuid('playlist_song', 'playlist_id');
    }

    private function isUuidPrimary(string $table): bool
    {
        if (! Schema::hasTable($table)) {
            return false;
        }

        return $this->columnLooksLikeUuid($table, 'id');
    }

    private function columnLooksLikeUuid(string $table, string $column): bool
    {
        if (! Schema::hasColumn($table, $column)) {
            return false;
        }

        $type = Schema::getColumnType($table, $column);

        if (in_array($type, ['bigint', 'integer', 'int'], true)) {
            return false;
        }

        $sample = DB::table($table)->whereNotNull($column)->value($column);

        if ($sample === null) {
            return in_array($type, ['string', 'guid', 'uuid', 'char'], true);
        }

        return is_string($sample) && preg_match('/^[0-9a-f-]{36}$/i', (string) $sample) === 1;
    }

    /**
     * Rebuild old-int => uuid map after a partial failed run (songs already converted).
     *
     * @return array<string, string>
     */
    private function recoverSongMap(): array
    {
        $map = [];

        if (Schema::hasColumn('playlist_song', 'song_id_uuid_tmp')) {
            foreach (DB::table('playlist_song')->whereNotNull('song_id_uuid_tmp')->get(['song_id', 'song_id_uuid_tmp']) as $row) {
                if ($row->song_id !== null) {
                    $map[(string) $row->song_id] = (string) $row->song_id_uuid_tmp;
                }
            }
        }

        if (Schema::hasTable('song_providers') && Schema::hasColumn('songs', 'provider_track_id')) {
            foreach (DB::table('song_providers')->get(['song_id', 'provider_track_id']) as $link) {
                $old = (string) $link->song_id;
                if (isset($map[$old]) || ! filled($link->provider_track_id)) {
                    continue;
                }
                $song = DB::table('songs')->where('provider_track_id', $link->provider_track_id)->first();
                if ($song) {
                    $map[$old] = (string) $song->id;
                }
            }
        }

        $referenced = collect();
        foreach ([
            ['song_providers', 'song_id'],
            ['song_plays', 'song_id'],
            ['song_favorites', 'song_id'],
            ['playlist_song', 'song_id'],
            ['listening_rooms', 'current_song_id'],
            ['listening_room_queue_items', 'song_id'],
        ] as [$table, $column]) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
                continue;
            }
            $referenced = $referenced->merge(
                DB::table($table)->whereNotNull($column)->pluck($column)->map(fn ($id) => (string) $id)
            );
        }
        $referenced = $referenced->unique()->values();
        $missingOld = $referenced->filter(fn ($id) => ! isset($map[$id]))->values();
        $missingNew = DB::table('songs')->whereNotIn('id', array_values($map))->pluck('id');

        if ($missingOld->count() === 1 && $missingNew->count() === 1) {
            $map[$missingOld->first()] = (string) $missingNew->first();
        }

        if ($missingOld->filter(fn ($id) => ! isset($map[$id]))->isNotEmpty()) {
            throw new RuntimeException(
                'Cannot recover song UUID map for old ids: '.$missingOld->filter(fn ($id) => ! isset($map[$id]))->implode(',')
            );
        }

        return $map;
    }

    /**
     * @return array<string, string> oldId => newUuid
     */
    private function convertPrimaryKeyToUuid(string $table): array
    {
        if ($this->isUuidPrimary($table)) {
            return [];
        }

        $map = [];

        if (Schema::hasColumn($table, 'uuid_tmp')) {
            foreach (DB::table($table)->get(['id', 'uuid_tmp']) as $row) {
                $uuid = $row->uuid_tmp ?: (string) Str::uuid();
                $map[(string) $row->id] = (string) $uuid;
                if (! $row->uuid_tmp) {
                    DB::table($table)->where('id', $row->id)->update(['uuid_tmp' => $uuid]);
                }
            }
        } else {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->uuid('uuid_tmp')->nullable();
            });

            foreach (DB::table($table)->orderBy('id')->pluck('id') as $oldId) {
                $map[(string) $oldId] = (string) Str::uuid();
            }

            foreach ($map as $oldId => $newId) {
                DB::table($table)->where('id', $oldId)->update(['uuid_tmp' => $newId]);
            }
        }

        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql') {
            // AUTO_INCREMENT columns cannot lose PRIMARY KEY — strip it first.
            DB::statement("ALTER TABLE `{$table}` MODIFY `id` BIGINT UNSIGNED NOT NULL");
            DB::statement("ALTER TABLE `{$table}` DROP PRIMARY KEY");
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropColumn('id');
            });
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->renameColumn('uuid_tmp', 'id');
            });
            DB::statement("ALTER TABLE `{$table}` MODIFY `id` CHAR(36) NOT NULL");
            DB::statement("ALTER TABLE `{$table}` ADD PRIMARY KEY (`id`)");
        } else {
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->dropColumn('id');
            });
            Schema::table($table, function (Blueprint $blueprint) {
                $blueprint->renameColumn('uuid_tmp', 'id');
            });
        }

        return $map;
    }

    /**
     * @param  array<string, string>  $map
     */
    private function remapForeignColumn(string $table, string $column, array $map): void
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
            return;
        }

        if ($this->columnLooksLikeUuid($table, $column)) {
            $tmpDone = "{$column}_uuid_tmp";
            if (Schema::hasColumn($table, $tmpDone)) {
                Schema::table($table, function (Blueprint $blueprint) use ($tmpDone) {
                    $blueprint->dropColumn($tmpDone);
                });
            }

            return;
        }

        $tmp = "{$column}_uuid_tmp";

        if (! Schema::hasColumn($table, $tmp)) {
            Schema::table($table, function (Blueprint $blueprint) use ($tmp) {
                $blueprint->uuid($tmp)->nullable();
            });
        }

        $pk = Schema::hasColumn($table, 'id') ? 'id' : null;
        $query = DB::table($table)->whereNotNull($column);

        if ($pk) {
            foreach ($query->get([$pk, $column, $tmp]) as $row) {
                if (! empty($row->{$tmp})) {
                    continue;
                }
                $old = (string) $row->{$column};
                DB::table($table)->where($pk, $row->{$pk})->update([
                    $tmp => $map[$old] ?? null,
                ]);
            }
        } else {
            foreach ($query->get() as $row) {
                if (! empty($row->{$tmp})) {
                    continue;
                }
                $old = (string) $row->{$column};
                DB::table($table)
                    ->where($column, $row->{$column})
                    ->update([$tmp => $map[$old] ?? null]);
            }
        }

        $this->dropIndexesContaining($table, $column);

        Schema::table($table, function (Blueprint $blueprint) use ($column) {
            $blueprint->dropColumn($column);
        });

        Schema::table($table, function (Blueprint $blueprint) use ($tmp, $column) {
            $blueprint->renameColumn($tmp, $column);
        });
    }

    private function dropIndexesContaining(string $table, string $column): void
    {
        foreach (Schema::getIndexes($table) as $index) {
            if ($index['primary'] ?? false) {
                continue;
            }
            if (! in_array($column, $index['columns'], true)) {
                continue;
            }

            Schema::table($table, function (Blueprint $blueprint) use ($index) {
                if ($index['unique'] ?? false) {
                    $blueprint->dropUnique($index['name']);
                } else {
                    $blueprint->dropIndex($index['name']);
                }
            });
        }
    }

    private function ensurePlaylistSongIndexes(): void
    {
        if (! Schema::hasTable('playlist_song')) {
            return;
        }

        $names = collect(Schema::getIndexes('playlist_song'))->pluck('name');

        Schema::table('playlist_song', function (Blueprint $blueprint) use ($names) {
            if (! $names->contains('playlist_song_playlist_id_song_id_unique')) {
                $blueprint->unique(['playlist_id', 'song_id']);
            }
            if (! $names->contains('playlist_song_playlist_id_position_index')) {
                $blueprint->index(['playlist_id', 'position']);
            }
        });
    }

    /**
     * @param  list<string>  $tables
     */
    private function dropAllForeignKeysOn(array $tables): void
    {
        foreach ($tables as $table) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            foreach (Schema::getForeignKeys($table) as $foreignKey) {
                Schema::table($table, function (Blueprint $blueprint) use ($foreignKey) {
                    $blueprint->dropForeign($foreignKey['name']);
                });
            }
        }
    }

    private function recreateForeignKeys(): void
    {
        $this->safeForeign('songs', 'user_id', 'users', 'id', 'cascade');
        $this->safeForeign('playlists', 'user_id', 'users', 'id', 'cascade');
        $this->safeForeign('playlist_song', 'playlist_id', 'playlists', 'id', 'cascade');
        $this->safeForeign('playlist_song', 'song_id', 'songs', 'id', 'cascade');
        $this->safeForeign('song_plays', 'user_id', 'users', 'id', 'cascade');
        $this->safeForeign('song_plays', 'song_id', 'songs', 'id', 'cascade');
        $this->safeForeign('song_favorites', 'user_id', 'users', 'id', 'cascade');
        $this->safeForeign('song_favorites', 'song_id', 'songs', 'id', 'cascade');
        $this->safeForeign('song_providers', 'song_id', 'songs', 'id', 'cascade');
        $this->safeForeign('listening_rooms', 'host_user_id', 'users', 'id', 'cascade');
        $this->safeForeign('listening_rooms', 'current_song_id', 'songs', 'id', 'null');
        $this->safeForeign('listening_room_members', 'listening_room_id', 'listening_rooms', 'id', 'cascade');
        $this->safeForeign('listening_room_members', 'user_id', 'users', 'id', 'cascade');
        $this->safeForeign('listening_room_queue_items', 'listening_room_id', 'listening_rooms', 'id', 'cascade');
        $this->safeForeign('listening_room_queue_items', 'song_id', 'songs', 'id', 'null');
        $this->safeForeign('listening_room_queue_items', 'added_by', 'users', 'id', 'cascade');
        $this->safeForeign('listening_room_messages', 'listening_room_id', 'listening_rooms', 'id', 'cascade');
        $this->safeForeign('listening_room_messages', 'user_id', 'users', 'id', 'cascade');
        $this->safeForeign('listening_room_reactions', 'listening_room_id', 'listening_rooms', 'id', 'cascade');
        $this->safeForeign('listening_room_reactions', 'user_id', 'users', 'id', 'cascade');
    }

    private function safeForeign(
        string $table,
        string $column,
        string $refTable,
        string $refColumn,
        string $onDelete,
    ): void {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
            return;
        }

        foreach (Schema::getForeignKeys($table) as $fk) {
            if (in_array($column, $fk['columns'], true)) {
                return;
            }
        }

        Schema::table($table, function (Blueprint $blueprint) use ($column, $refTable, $refColumn, $onDelete) {
            $fk = $blueprint->foreign($column)->references($refColumn)->on($refTable);
            if ($onDelete === 'cascade') {
                $fk->cascadeOnDelete();
            } elseif ($onDelete === 'null') {
                $fk->nullOnDelete();
            }
        });
    }

    private function disableForeignKeyChecks(string $driver): void
    {
        if ($driver === 'mysql') {
            DB::statement('SET FOREIGN_KEY_CHECKS=0');
        } elseif ($driver === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = OFF');
        }
    }

    private function enableForeignKeyChecks(string $driver): void
    {
        if ($driver === 'mysql') {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        } elseif ($driver === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = ON');
        }
    }
};
