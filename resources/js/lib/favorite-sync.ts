type FavoriteListener = (songId: string, favorited: boolean) => void;

const listeners = new Set<FavoriteListener>();

export function emitFavoriteChange(songId: string, favorited: boolean): void {
    listeners.forEach((listener) => {
        try {
            listener(songId, favorited);
        } catch {
            // ignore listener errors
        }
    });
}

export function subscribeFavoriteChange(listener: FavoriteListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
