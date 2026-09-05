import type { Song } from '@/types';

export type SongListFilter = 'all' | 'favorites';

export type SongListCacheEntry = {
    songs: Song[];
    page: number;
    lastPage: number;
};

const cache = new Map<SongListFilter, SongListCacheEntry>();
const listeners = new Set<() => void>();

export function getSongListCache(filter: SongListFilter): SongListCacheEntry | null {
    return cache.get(filter) ?? null;
}

export function setSongListCache(filter: SongListFilter, entry: SongListCacheEntry): void {
    cache.set(filter, {
        songs: entry.songs,
        page: entry.page,
        lastPage: entry.lastPage,
    });
}

export function clearSongListCache(filter?: SongListFilter): void {
    if (filter) {
        cache.delete(filter);
        return;
    }
    cache.clear();
}

/** Drop cached lists and notify open song index views to refetch. */
export function invalidateSongListCache(filter?: SongListFilter): void {
    clearSongListCache(filter);
    listeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // ignore
        }
    });
}

export function subscribeSongListInvalidation(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
