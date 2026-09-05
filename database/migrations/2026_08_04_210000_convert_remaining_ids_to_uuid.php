<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Convert remaining app primary keys (and user FKs) to UUID.
 * Skips Laravel infrastructure: migrations, jobs, failed_jobs, job_batches, cache.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('users') || $this->conversionComplete()) {
            return;
        }

        $driver = Schema::getConnection()->getDriverName();
        $this->disableForeignKeyChecks($driver);

        try {
            $this->dropAllForeignKeysOn([
                'songs',
                'playlists',
                'playlist_song',
                'song_plays',
                'song_favorites',
                'song_providers',
                'user_music_connections',
                'listening_rooms',
                'listening_room_members',
                'listening_room_queue_items',
                'listening_room_votes',
                'listening_room_messages',
                'listening_room_reactions',
                'personal_access_tokens',
                'users',
            ]);

            $userMap = $this->isUuidPrimary('users')
                ? $this->recoverUserMap()
                : $this->convertPrimaryKeyToUuid('users');

            if ($userMap !== []) {
                $this->remapForeignColumn('songs', 'user_id', $userMap);
                $this->remapForeignColumn('playlists', 'user_id', $userMap);
                $this->remapForeignColumn('song_plays', 'user_id', $userMap);
                $this->remapForeignColumn('song_favorites', 'user_id', $userMap);
                $this->remapForeignColumn('user_music_connections', 'user_id', $userMap);
                $this->remapForeignColumn('listening_rooms', 'host_user_id', $userMap);
                $this->remapForeignColumn('listening_room_members', 'user_id', $userMap);
                $this->remapForeignColumn('listening_room_queue_items', 'added_by', $userMap);
                $this->remapForeignColumn('listening_room_votes', 'user_id', $userMap);
                $this->remapForeignColumn('listening_room_messages', 'user_id', $userMap);
                $this->remapForeignColumn('listening_room_reactions', 'user_id', $userMap);
                $this->remapSessionsUserId($userMap);
                $this->remapTokenableUserId($userMap);
            }

            $this->convertPrimaryKeyToUuid('song_plays');
            $this->convertPrimaryKeyToUuid('song_favorites');
            $this->convertPrimaryKeyToUuid('playlist_song');
            $this->convertPrimaryKeyToUuid('listening_room_members');
            $this->convertPrimaryKeyToUuid('listening_room_messages');
            $this->convertPrimaryKeyToUuid('listening_room_reactions');

            $queueMap = $this->isUuidPrimary('listening_room_queue_items')
                ? []
                : $this->convertPrimaryKeyToUuid('listening_room_queue_items');
            if ($queueMap !== []) {
                $this->remapForeignColumn('listening_room_votes', 'queue_item_id', $queueMap);
            }

            $this->convertPrimaryKeyToUuid('listening_room_votes');
            $this->convertPrimaryKeyToUuid('personal_access_tokens');

            $this->ensurePlaylistSongIndexes();
            $this->ensureMemberUnique();
            $this->ensureFavoriteUnique();
            $this->ensureVoteUnique();
            $this->recreateForeignKeys();
        } finally {
            $this->enableForeignKeyChecks($driver);
        }
    }

    public function down(): void
    {
        // Irreversible.
    }

    private function conversionComplete(): bool
    {
        return $this->isUuidPrimary('users')
            && $this->isUuidPrimary('song_plays')
            && $this->isUuidPrimary('listening_room_queue_items')
            && $this->columnLooksLikeUuid('songs', 'user_id');
    }

    private function isUuidPrimary(string $table): bool
    {
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'id')) {
            return true;
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
     * @return array<string, string>
     */
    private function recoverUserMap(): array
    {
        $path = storage_path('app/user_uuid_map.json');
        if (is_file($path)) {
            /** @var array<string, string> $map */
            $map = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

            return $map;
        }

        throw new RuntimeException('users already UUID but conversion incomplete — missing storage/app/user_uuid_map.json');
    }

    /**
     * @return array<string, string>
     */
    private function convertPrimaryKeyToUuid(string $table): array
    {
        if (! Schema::hasTable($table) || $this->isUuidPrimary($table)) {
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

        // Persist before PK swap so a mid-flight failure can resume FK remaps.
        if ($table === 'users') {
            $this->storeMapArtifact('user_uuid_map', $map);
        }

        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql') {
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
    private function storeMapArtifact(string $name, array $map): void
    {
        $path = storage_path("app/{$name}.json");
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0777, true);
        }
        file_put_contents($path, json_encode($map));
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

        if ($pk) {
            foreach (DB::table($table)->whereNotNull($column)->get([$pk, $column, $tmp]) as $row) {
                if (! empty($row->{$tmp})) {
                    continue;
                }
                $old = (string) $row->{$column};
                DB::table($table)->where($pk, $row->{$pk})->update([
                    $tmp => $map[$old] ?? null,
                ]);
            }
        } else {
            foreach (DB::table($table)->whereNotNull($column)->get() as $row) {
                if (! empty($row->{$tmp} ?? null)) {
                    continue;
                }
                $old = (string) $row->{$column};
                DB::table($table)->where($column, $row->{$column})->update([
                    $tmp => $map[$old] ?? null,
                ]);
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

    /**
     * @param  array<string, string>  $map
     */
    private function remapSessionsUserId(array $map): void
    {
        if (! Schema::hasTable('sessions') || ! Schema::hasColumn('sessions', 'user_id')) {
            return;
        }

        if ($this->columnLooksLikeUuid('sessions', 'user_id')) {
            return;
        }

        $tmp = 'user_id_uuid_tmp';
        if (! Schema::hasColumn('sessions', $tmp)) {
            Schema::table('sessions', function (Blueprint $blueprint) use ($tmp) {
                $blueprint->uuid($tmp)->nullable();
            });
        }

        foreach (DB::table('sessions')->whereNotNull('user_id')->get(['id', 'user_id', $tmp]) as $row) {
            if (! empty($row->{$tmp})) {
                continue;
            }
            DB::table('sessions')->where('id', $row->id)->update([
                $tmp => $map[(string) $row->user_id] ?? null,
            ]);
        }

        $this->dropIndexesContaining('sessions', 'user_id');
        Schema::table('sessions', function (Blueprint $blueprint) {
            $blueprint->dropColumn('user_id');
        });
        Schema::table('sessions', function (Blueprint $blueprint) use ($tmp) {
            $blueprint->renameColumn($tmp, 'user_id');
        });
        Schema::table('sessions', function (Blueprint $blueprint) {
            $blueprint->index('user_id');
        });
    }

    /**
     * @param  array<string, string>  $map
     */
    private function remapTokenableUserId(array $map): void
    {
        if (! Schema::hasTable('personal_access_tokens') || ! Schema::hasColumn('personal_access_tokens', 'tokenable_id')) {
            return;
        }

        if ($this->columnLooksLikeUuid('personal_access_tokens', 'tokenable_id')) {
            return;
        }

        $tmp = 'tokenable_id_uuid_tmp';
        if (! Schema::hasColumn('personal_access_tokens', $tmp)) {
            Schema::table('personal_access_tokens', function (Blueprint $blueprint) use ($tmp) {
                $blueprint->uuid($tmp)->nullable();
            });
        }

        $userType = 'App\\Models\\User';
        foreach (DB::table('personal_access_tokens')->where('tokenable_type', $userType)->get(['id', 'tokenable_id', $tmp]) as $row) {
            if (! empty($row->{$tmp})) {
                continue;
            }
            DB::table('personal_access_tokens')->where('id', $row->id)->update([
                $tmp => $map[(string) $row->tokenable_id] ?? null,
            ]);
        }

        $this->dropIndexesContaining('personal_access_tokens', 'tokenable_id');

        Schema::table('personal_access_tokens', function (Blueprint $blueprint) {
            $blueprint->dropColumn('tokenable_id');
        });
        Schema::table('personal_access_tokens', function (Blueprint $blueprint) use ($tmp) {
            $blueprint->renameColumn($tmp, 'tokenable_id');
        });

        // Recreate morph index if missing.
        $names = collect(Schema::getIndexes('personal_access_tokens'))->pluck('name');
        if (! $names->contains('personal_access_tokens_tokenable_type_tokenable_id_index')) {
            Schema::table('personal_access_tokens', function (Blueprint $blueprint) {
                $blueprint->index(['tokenable_type', 'tokenable_id']);
            });
        }
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

    private function ensureMemberUnique(): void
    {
        if (! Schema::hasTable('listening_room_members')) {
            return;
        }
        $names = collect(Schema::getIndexes('listening_room_members'))->pluck('name');
        if (! $names->contains('listening_room_members_listening_room_id_user_id_unique')) {
            Schema::table('listening_room_members', function (Blueprint $blueprint) {
                $blueprint->unique(['listening_room_id', 'user_id']);
            });
        }
    }

    private function ensureFavoriteUnique(): void
    {
        if (! Schema::hasTable('song_favorites')) {
            return;
        }
        $names = collect(Schema::getIndexes('song_favorites'))->pluck('name');
        if (! $names->contains('song_favorites_user_id_song_id_unique')) {
            Schema::table('song_favorites', function (Blueprint $blueprint) {
                $blueprint->unique(['user_id', 'song_id']);
            });
        }
    }

    private function ensureVoteUnique(): void
    {
        if (! Schema::hasTable('listening_room_votes')) {
            return;
        }
        $names = collect(Schema::getIndexes('listening_room_votes'))->pluck('name');
        if (! $names->contains('listening_room_votes_queue_item_id_user_id_unique')) {
            Schema::table('listening_room_votes', function (Blueprint $blueprint) {
                $blueprint->unique(['queue_item_id', 'user_id']);
            });
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
        $this->safeForeign('user_music_connections', 'user_id', 'users', 'id', 'cascade');
        $this->safeForeign('listening_rooms', 'host_user_id', 'users', 'id', 'cascade');
        $this->safeForeign('listening_rooms', 'current_song_id', 'songs', 'id', 'null');
        $this->safeForeign('listening_room_members', 'listening_room_id', 'listening_rooms', 'id', 'cascade');
        $this->safeForeign('listening_room_members', 'user_id', 'users', 'id', 'cascade');
        $this->safeForeign('listening_room_queue_items', 'listening_room_id', 'listening_rooms', 'id', 'cascade');
        $this->safeForeign('listening_room_queue_items', 'song_id', 'songs', 'id', 'null');
        $this->safeForeign('listening_room_queue_items', 'added_by', 'users', 'id', 'cascade');
        $this->safeForeign('listening_room_votes', 'queue_item_id', 'listening_room_queue_items', 'id', 'cascade');
        $this->safeForeign('listening_room_votes', 'user_id', 'users', 'id', 'cascade');
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
