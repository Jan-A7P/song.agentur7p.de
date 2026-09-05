type SuggestListener = (songId: string) => void;

const OPT_OUT_KEY = 'songtexte.favoriteSuggest.disabled';
const HISTORY_KEY = 'songtexte.favoriteSuggest.history';
const DISMISSED_KEY = 'songtexte.favoriteSuggest.dismissed';

/** Completions within this window count toward a suggestion. */
export const FAVORITE_SUGGEST_WINDOW_MS = 20 * 60 * 1000;
/** How many full plays trigger a suggestion. */
export const FAVORITE_SUGGEST_THRESHOLD = 3;
/** After dismiss, don't ask again for this song until cooldown expires. */
export const FAVORITE_SUGGEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const listeners = new Set<SuggestListener>();

type HistoryMap = Record<string, number[]>;
type DismissedMap = Record<string, number>;

function readJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return fallback;
        }
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function writeJson(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // ignore quota / private mode
    }
}

export function isFavoriteSuggestEnabled(): boolean {
    try {
        return localStorage.getItem(OPT_OUT_KEY) !== '1';
    } catch {
        return true;
    }
}

export function setFavoriteSuggestEnabled(enabled: boolean): void {
    try {
        if (enabled) {
            localStorage.removeItem(OPT_OUT_KEY);
        } else {
            localStorage.setItem(OPT_OUT_KEY, '1');
        }
    } catch {
        // ignore
    }
}

function prune(timestamps: number[], now: number): number[] {
    return timestamps.filter((at) => now - at <= FAVORITE_SUGGEST_WINDOW_MS);
}

export function markFavoriteSuggestDismissed(songId: string): void {
    const dismissed = readJson<DismissedMap>(DISMISSED_KEY, {});
    dismissed[songId] = Date.now();
    writeJson(DISMISSED_KEY, dismissed);
}

function wasRecentlyDismissed(songId: string, now: number): boolean {
    const dismissed = readJson<DismissedMap>(DISMISSED_KEY, {});
    const at = dismissed[songId];
    return typeof at === 'number' && now - at < FAVORITE_SUGGEST_COOLDOWN_MS;
}

/**
 * Record a successful full play. Emits a suggestion event when the song was
 * completed often enough in a short window (and suggestions are enabled).
 */
export function recordCompletedPlay(songId: string): void {
    if (!songId || !isFavoriteSuggestEnabled()) {
        return;
    }

    const now = Date.now();
    if (wasRecentlyDismissed(songId, now)) {
        return;
    }

    const history = readJson<HistoryMap>(HISTORY_KEY, {});
    const next = prune([...(history[songId] ?? []), now], now);
    history[songId] = next;
    writeJson(HISTORY_KEY, history);

    if (next.length < FAVORITE_SUGGEST_THRESHOLD) {
        return;
    }

    // Reset window so we don't re-fire on every subsequent completion immediately.
    history[songId] = [];
    writeJson(HISTORY_KEY, history);

    listeners.forEach((listener) => {
        try {
            listener(songId);
        } catch {
            // ignore
        }
    });
}

export function subscribeFavoriteSuggest(listener: SuggestListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
