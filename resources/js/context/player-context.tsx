import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import axios from 'axios';
import { useAuth } from '@/context/auth-context';
import api from '@/lib/api';
import {
    activeProviderId,
    connectedProviderIds,
    hasMusicConnected,
    isProviderConnected,
    providerFromUri,
    providerLabel,
    scoreProviderTrackMatch,
} from '@/lib/music';
import { playerTrackForProvider, songToPlayerTrack } from '@/lib/playable';
import { toast } from '@/lib/toast';
import { getProvider, releaseProvider, type MusicProvider, type PlayableTrack, type ProviderPlaybackState } from '@/music';
import type { MusicProviderId } from '@/music/types';
import type { ProviderTrack, Song, SongPlay } from '@/types';

export type PlayerTrack = PlayableTrack;

type QueueState = {
    playlistId: number | null;
    tracks: PlayerTrack[];
    order: number[];
    cursor: number;
};

type PlayerContextValue = {
    track: PlayerTrack | null;
    ready: boolean;
    playing: boolean;
    positionMs: number;
    durationMs: number;
    volume: number;
    error: string | null;
    queue: QueueState | null;
    shuffle: boolean;
    repeatOne: boolean;
    canPrev: boolean;
    canNext: boolean;
    controlsLocked: boolean;
    playTrack: (track: PlayerTrack) => Promise<void>;
    playPlaylist: (tracks: PlayerTrack[], options?: { playlistId?: number; startIndex?: number; shuffle?: boolean }) => Promise<void>;
    playNext: () => Promise<void>;
    playPrevious: () => Promise<void>;
    switchProvider: (provider: MusicProviderId) => Promise<void>;
    attachSongProviders: (song: Song) => void;
    toggle: () => Promise<void>;
    setVolume: (volume: number) => Promise<void>;
    seek: (positionMs: number) => Promise<void>;
    toggleShuffle: () => void;
    toggleRepeatOne: () => void;
    setControlsLocked: (locked: boolean) => void;
    syncFromRemote: (payload: {
        provider?: string | null;
        uri: string | null;
        title?: string | null;
        artist?: string | null;
        albumArtUrl?: string | null;
        songId?: number | null;
        positionMs: number;
        isPlaying: boolean;
    }) => Promise<void>;
    setOnTrackEnded: (handler: (() => void) | null) => void;
};

const PlayerContext = createContext<PlayerContextValue | undefined>(undefined);

const VOLUME_STORAGE_KEY = 'songtexte.player.volume';
const LAST_VOLUME_STORAGE_KEY = 'songtexte.player.lastVolume';
const SHUFFLE_STORAGE_KEY = 'songtexte.player.shuffle';
const REPEAT_STORAGE_KEY = 'songtexte.player.repeatOne';
const SESSION_STORAGE_KEY = 'songtexte.player.session';

type StoredSession = {
    track: PlayerTrack;
    positionMs: number;
    durationMs: number;
    queue: QueueState | null;
};

function readStoredSession(): StoredSession | null {
    try {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as StoredSession & { track: PlayerTrack & { provider?: string; trackId?: string } };
        if (!parsed?.track?.uri) {
            return null;
        }
        const track: PlayerTrack = {
            provider: (parsed.track.provider as PlayerTrack['provider']) || 'spotify',
            trackId: parsed.track.trackId || parsed.track.uri.split(':').pop() || '',
            uri: parsed.track.uri,
            title: parsed.track.title,
            artist: parsed.track.artist,
            albumArtUrl: parsed.track.albumArtUrl ?? null,
            songId: parsed.track.songId,
            lyrics: parsed.track.lyrics,
            providerLinks: parsed.track.providerLinks,
            preferredProvider: parsed.track.preferredProvider ?? null,
            lastWorkingProvider: parsed.track.lastWorkingProvider ?? null,
        };
        return {
            track,
            positionMs: Math.max(0, Number(parsed.positionMs) || 0),
            durationMs: Math.max(0, Number(parsed.durationMs) || 0),
            queue: parsed.queue ?? null,
        };
    } catch {
        return null;
    }
}

function writeStoredSession(session: StoredSession | null): void {
    try {
        if (!session) {
            localStorage.removeItem(SESSION_STORAGE_KEY);
            return;
        }
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch {
        // ignore
    }
}

function readStoredVolume(key: string, fallback: number): number {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) {
            return fallback;
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return fallback;
        }
        return Math.min(1, Math.max(0, value));
    } catch {
        return fallback;
    }
}

function writeStoredVolume(key: string, value: number): void {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // ignore
    }
}

function readStoredFlag(key: string, fallback: boolean): boolean {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) {
            return fallback;
        }
        return raw === '1' || raw === 'true';
    } catch {
        return fallback;
    }
}

function writeStoredFlag(key: string, value: boolean): void {
    try {
        localStorage.setItem(key, value ? '1' : '0');
    } catch {
        // ignore
    }
}

function shuffleIndices(length: number, preferFirst?: number): number[] {
    const indices = Array.from({ length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    if (preferFirst != null && preferFirst >= 0 && preferFirst < length) {
        const at = indices.indexOf(preferFirst);
        if (at > 0) {
            indices.splice(at, 1);
            indices.unshift(preferFirst);
        }
    }

    return indices;
}

function sequentialIndices(length: number): number[] {
    return Array.from({ length }, (_, i) => i);
}

function normalizeTrack(track: PlayerTrack): PlayerTrack {
    const inferred = providerFromUri(track.uri);
    const provider = track.provider || inferred || 'spotify';

    return {
        ...track,
        provider,
        trackId: track.trackId || track.uri.split(':').pop() || '',
    };
}

async function resolveFallbackTrack(
    track: PlayerTrack,
    user: Parameters<typeof connectedProviderIds>[0],
): Promise<PlayerTrack | null> {
    const connected = connectedProviderIds(user);
    if (connected.length === 0) {
        return null;
    }

    // 1) Prefer other *stored* links for this song (no search guesswork).
    const stored = track.providerLinks ?? [];
    if (stored.length > 0) {
        const byProvider = new Map(stored.map((l) => [l.provider, l]));
        const order: MusicProviderId[] = [];
        if (track.preferredProvider) {
            order.push(track.preferredProvider);
        }
        if (track.lastWorkingProvider) {
            order.push(track.lastWorkingProvider);
        }
        const active = activeProviderId(user);
        if (active) {
            order.push(active);
        }
        for (const link of stored) {
            order.push(link.provider);
        }

        const seen = new Set<MusicProviderId>();
        for (const id of order) {
            if (seen.has(id) || id === track.provider) {
                continue;
            }
            seen.add(id);
            if (!connected.includes(id)) {
                continue;
            }
            const link = byProvider.get(id);
            if (!link) {
                continue;
            }
            return {
                ...track,
                provider: link.provider,
                trackId: link.trackId,
                uri: link.uri,
                albumArtUrl: link.albumArtUrl ?? track.albumArtUrl,
            };
        }
    }

    // 2) Last resort: search by title/artist on other connected providers.
    const alternatives = connected.filter((id) => id !== track.provider);
    const query = [track.title, track.artist].filter(Boolean).join(' ').trim();
    if (alternatives.length === 0 || !query) {
        return null;
    }

    let best: { score: number; track: PlayerTrack } | null = null;

    for (const providerId of alternatives) {
        try {
            const { data } = await api.get<{ tracks: ProviderTrack[] }>(`/music/${providerId}/search`, {
                params: { q: query },
            });

            for (const candidate of data.tracks ?? []) {
                const score = scoreProviderTrackMatch(candidate, track.title, track.artist);
                if (score < 60) {
                    continue;
                }
                if (!best || score > best.score) {
                    best = {
                        score,
                        track: {
                            ...track,
                            provider: candidate.provider || providerId,
                            trackId: candidate.id,
                            uri: candidate.uri,
                            title: candidate.name || track.title,
                            artist: candidate.artist || track.artist,
                            albumArtUrl: candidate.album_art_url ?? track.albumArtUrl,
                            providerLinks: track.providerLinks,
                            preferredProvider: track.preferredProvider,
                            lastWorkingProvider: track.lastWorkingProvider,
                        },
                    };
                }
            }
        } catch {
            // try next provider
        }
    }

    return best?.track ?? null;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const musicConnected = hasMusicConnected(user);
    const providerId = activeProviderId(user);
    const connectedIds = connectedProviderIds(user);
    const providerRef = useRef<MusicProvider | null>(null);
    const providersRef = useRef<Map<MusicProviderId, MusicProvider>>(new Map());
    const userRef = useRef(user);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const positionAnchorRef = useRef<{ position: number; at: number; playing: boolean }>({
        position: 0,
        at: Date.now(),
        playing: false,
    });
    const advancingRef = useRef(false);
    const queueRef = useRef<QueueState | null>(null);
    const repeatOneRef = useRef(false);
    const shuffleRef = useRef(false);
    const restoredRef = useRef(false);
    const trackRef = useRef<PlayerTrack | null>(null);
    const positionMsRef = useRef(0);
    const durationMsRef = useRef(0);
    const resumeGuardRef = useRef<{ until: number; minPosition: number } | null>(null);
    const onTrackEndedRef = useRef<(() => void) | null>(null);
    const syncingRemoteRef = useRef(false);
    const activePlayRef = useRef<{ songId: number; playId: number; reportedMs: number } | null>(null);
    const playListenAnchorRef = useRef<{ at: number; baseMs: number; playing: boolean } | null>(null);

    const [track, setTrack] = useState<PlayerTrack | null>(null);
    const [providerReady, setProviderReady] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [positionMs, setPositionMs] = useState(0);
    const [durationMs, setDurationMs] = useState(0);
    const [volume, setVolumeState] = useState(() => readStoredVolume(VOLUME_STORAGE_KEY, 0.7));
    const [error, setErrorState] = useState<string | null>(null);
    const [queue, setQueue] = useState<QueueState | null>(null);
    const [shuffle, setShuffle] = useState(() => readStoredFlag(SHUFFLE_STORAGE_KEY, false));
    const [repeatOne, setRepeatOne] = useState(() => readStoredFlag(REPEAT_STORAGE_KEY, false));
    const [controlsLocked, setControlsLocked] = useState(false);
    const volumeRef = useRef(volume);

    const setError = useCallback((message: string | null) => {
        setErrorState(message);
        if (message) {
            toast.error(message, 'Player');
        }
    }, []);

    const ready = musicConnected && providerReady;

    useEffect(() => {
        volumeRef.current = volume;
    }, [volume]);

    useEffect(() => {
        queueRef.current = queue;
    }, [queue]);

    useEffect(() => {
        trackRef.current = track;
    }, [track]);

    useEffect(() => {
        positionMsRef.current = positionMs;
    }, [positionMs]);

    useEffect(() => {
        durationMsRef.current = durationMs;
    }, [durationMs]);

    useEffect(() => {
        repeatOneRef.current = repeatOne;
    }, [repeatOne]);

    useEffect(() => {
        shuffleRef.current = shuffle;
    }, [shuffle]);

    const applyState = useCallback((state: ProviderPlaybackState | null) => {
        if (!state) {
            return;
        }

        const guard = resumeGuardRef.current;
        const statePosition = state.position;
        if (guard && Date.now() < guard.until && statePosition + 1500 < guard.minPosition) {
            setPlaying(!state.paused);
            if (state.duration > 0) {
                setDurationMs(state.duration);
            }
            return;
        }

        if (guard && Date.now() >= guard.until) {
            resumeGuardRef.current = null;
        }

        const now = Date.now();
        positionAnchorRef.current = {
            position: statePosition,
            at: now,
            playing: !state.paused,
        };

        setPlaying(!state.paused);
        setPositionMs(statePosition);
        setDurationMs(state.duration);

        const current = state.track;
        if (current) {
            setTrack((prev) => ({
                provider: prev?.provider || providerFromUri(current.uri) || providerId || 'spotify',
                trackId: prev?.uri === current.uri ? prev.trackId : current.uri.split(':').pop() || '',
                uri: current.uri,
                title: current.name,
                artist: current.artists.join(', '),
                albumArtUrl: current.albumArtUrl ?? prev?.albumArtUrl ?? null,
                songId: prev?.songId,
                lyrics: prev?.lyrics,
                providerLinks: prev?.providerLinks,
                preferredProvider: prev?.preferredProvider,
                lastWorkingProvider: prev?.lastWorkingProvider,
            }));
        }
    }, [providerId]);

    useEffect(() => {
        if (!musicConnected || connectedIds.length === 0) {
            restoredRef.current = false;
            [...providersRef.current.keys()].forEach((id) => releaseProvider(id));
            providersRef.current.clear();
            providerRef.current = null;
            setProviderReady(false);
            setPlaying(false);
            setTrack(null);
            setQueue(null);
            setPositionMs(0);
            setDurationMs(0);
            return;
        }

        const activeSet = new Set(connectedIds);
        const unsubscribers: Array<() => void> = [];
        let cancelled = false;

        // Tear down providers that are no longer active+connected (stops TIDAL ping etc.).
        for (const id of [...providersRef.current.keys()]) {
            if (!activeSet.has(id)) {
                releaseProvider(id);
                providersRef.current.delete(id);
                if (providerRef.current?.id === id) {
                    providerRef.current = null;
                }
            }
        }

        void (async () => {
            const connected: MusicProvider[] = [];

            // Eagerly initialize only the preferred active provider.
            // Other active providers connect on demand in ensureProviderForTrack.
            const eagerId =
                (providerId && activeSet.has(providerId) ? providerId : null) ??
                connectedIds[0] ??
                null;

            const idsToWire = eagerId ? [eagerId] : [];

            for (const id of idsToWire) {
                if (cancelled) {
                    return;
                }

                const provider = getProvider(id);
                providersRef.current.set(id, provider);

                unsubscribers.push(
                    provider.onStateChange((state) => {
                        if (providerRef.current?.id === provider.id) {
                            applyState(state);
                        }
                    }),
                );
                unsubscribers.push(
                    provider.onReadyChange((isReady) => {
                        if (providerRef.current?.id === provider.id) {
                            setProviderReady(isReady);
                            if (isReady) {
                                setError(null);
                            }
                        }
                    }),
                );
                unsubscribers.push(provider.onError((message) => setError(message)));

                try {
                    await provider.setVolume(volumeRef.current);
                    await provider.connect();
                    connected.push(provider);
                } catch (e) {
                    if (!cancelled) {
                        const label = providerLabel(id);
                        const message =
                            e instanceof Error ? e.message : `${label}-Player konnte nicht gestartet werden.`;
                        setError(`${label}: ${message}`);
                    }
                }
            }

            if (cancelled) {
                return;
            }

            const preferred =
                (eagerId && providersRef.current.get(eagerId)) ||
                connected[0] ||
                providersRef.current.values().next().value ||
                null;
            providerRef.current = preferred ?? null;
            setProviderReady(Boolean(preferred?.ready));
        })();

        return () => {
            cancelled = true;
            unsubscribers.forEach((fn) => fn());
            // Keep active provider instances across StrictMode remounts; only release
            // when the effect re-runs with an empty connected set or inactive ids.
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [musicConnected, connectedIds.join(','), providerId, applyState]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const anchor = positionAnchorRef.current;
            if (!anchor.playing) {
                return;
            }
            const elapsed = Date.now() - anchor.at;
            setPositionMs(Math.min(anchor.position + elapsed, durationMs || Number.MAX_SAFE_INTEGER));
        }, 250);

        return () => window.clearInterval(timer);
    }, [durationMs]);

    const ensureProviderForTrack = useCallback(async (next: PlayerTrack): Promise<{ provider: MusicProvider; track: PlayerTrack }> => {
        // Honor the track as given (preferred is resolved earlier in songToPlayerTrack /
        // resolveSongPlayback). Re-forcing preferred here breaks switchProvider().
        let playable = normalizeTrack(next);

        let needed = playable.provider;

        if (!isProviderConnected(userRef.current, needed)) {
            const fallback = await resolveFallbackTrack(playable, userRef.current);
            if (!fallback) {
                const alternatives = connectedProviderIds(userRef.current)
                    .filter((id) => id !== needed)
                    .map(providerLabel);
                const hint =
                    alternatives.length > 0
                        ? ` Kein Treffer bei ${alternatives.join(', ')}.`
                        : '';
                throw new Error(
                    `${providerLabel(needed)} ist nicht aktiv.${hint} Bitte einen Musikdienst in den Einstellungen aktivieren.`,
                );
            }
            playable = fallback;
            needed = playable.provider;
        }

        let provider = providersRef.current.get(needed);
        if (!provider) {
            provider = getProvider(needed);
            providersRef.current.set(needed, provider);
            provider.onStateChange((state) => {
                if (providerRef.current?.id === provider!.id) {
                    applyState(state);
                }
            });
            provider.onReadyChange((isReady) => {
                if (providerRef.current?.id === provider!.id) {
                    setProviderReady(isReady);
                }
            });
            provider.onError((message) => setError(message));
            await provider.setVolume(volumeRef.current);
            await provider.connect();
        }

        if (providerRef.current && providerRef.current.id !== needed) {
            try {
                await providerRef.current.pause();
            } catch {
                // ignore
            }
        }

        providerRef.current = provider;
        setProviderReady(provider.ready);

        if (!provider.ready) {
            await provider.connect();
        }

        return { provider, track: playable };
    }, [applyState]);

    const currentListenedMs = useCallback((): number => {
        const active = activePlayRef.current;
        const anchor = playListenAnchorRef.current;
        if (!active) {
            return 0;
        }
        if (!anchor) {
            return active.reportedMs;
        }
        let ms = anchor.baseMs;
        if (anchor.playing) {
            ms += Date.now() - anchor.at;
        }
        return Math.max(active.reportedMs, Math.floor(ms));
    }, []);

    const flushPlayProgress = useCallback(
        async (options?: { completed?: boolean; clear?: boolean }) => {
            const active = activePlayRef.current;
            if (!active) {
                return;
            }

            const listenedMs = currentListenedMs();
            const completed = Boolean(options?.completed);
            const shouldClear = Boolean(options?.clear);

            if (playListenAnchorRef.current) {
                playListenAnchorRef.current = {
                    at: Date.now(),
                    baseMs: listenedMs,
                    playing: playListenAnchorRef.current.playing && !shouldClear,
                };
            }

            const shouldReport = listenedMs > active.reportedMs || completed || shouldClear;
            if (!shouldReport) {
                if (shouldClear) {
                    activePlayRef.current = null;
                    playListenAnchorRef.current = null;
                }
                return;
            }

            active.reportedMs = listenedMs;

            try {
                await api.patch(
                    `/songs/${active.songId}/plays/${active.playId}`,
                    {
                        listened_ms: listenedMs,
                        duration_ms: durationMsRef.current > 0 ? Math.floor(durationMsRef.current) : undefined,
                        completed,
                    },
                    { skipErrorToast: true },
                );
            } catch {
                // non-blocking
            }

            if (shouldClear) {
                activePlayRef.current = null;
                playListenAnchorRef.current = null;
            }
        },
        [currentListenedMs],
    );

    const playEngine = useCallback(async (next: PlayerTrack, startAt: number) => {
        const { provider, track: playable } = await ensureProviderForTrack(next);
        setTrack(playable);

        if (startAt > 0) {
            resumeGuardRef.current = {
                until: Date.now() + 2500,
                minPosition: startAt,
            };
        } else {
            resumeGuardRef.current = null;
        }

        await provider.play(playable, startAt);

        const trackPlay = Boolean(playable.songId) && !syncingRemoteRef.current;
        const isFreshStart = startAt < 2500;
        const prev = activePlayRef.current;

        if (trackPlay && playable.songId) {
            if (prev && (prev.songId !== playable.songId || isFreshStart)) {
                await flushPlayProgress({
                    clear: true,
                    completed: prev.songId === playable.songId,
                });
            }

            if (isFreshStart || !activePlayRef.current || activePlayRef.current.songId !== playable.songId) {
                void api
                    .post<{ data: Song; play: SongPlay | null }>(
                        `/songs/${playable.songId}/played`,
                        {
                            provider: playable.provider,
                            provider_track_id: playable.trackId,
                            provider_uri: playable.uri,
                            album_art_url: playable.albumArtUrl,
                            duration_ms: durationMsRef.current > 0 ? Math.floor(durationMsRef.current) : undefined,
                            track: true,
                        },
                        { skipErrorToast: true },
                    )
                    .then(({ data }) => {
                        if (!data.play?.id || trackRef.current?.songId !== playable.songId) {
                            return;
                        }
                        activePlayRef.current = {
                            songId: playable.songId!,
                            playId: data.play.id,
                            reportedMs: 0,
                        };
                        playListenAnchorRef.current = {
                            at: Date.now(),
                            baseMs: 0,
                            playing: true,
                        };
                    })
                    .catch(() => {
                        // non-blocking
                    });
            } else {
                // Same session continued (e.g. provider switch mid-track).
                const listened = currentListenedMs();
                playListenAnchorRef.current = {
                    at: Date.now(),
                    baseMs: listened,
                    playing: true,
                };
            }
        } else if (prev) {
            // Room sync / no song id — stop tracking the previous local play.
            void flushPlayProgress({ clear: true });
        } else if (playable.songId && syncingRemoteRef.current) {
            // Still enrich last-working provider without counting a play.
            void api
                .post(
                    `/songs/${playable.songId}/played`,
                    {
                        provider: playable.provider,
                        provider_track_id: playable.trackId,
                        provider_uri: playable.uri,
                        album_art_url: playable.albumArtUrl,
                        track: false,
                    },
                    { skipErrorToast: true },
                )
                .catch(() => {
                    // non-blocking
                });
        }
    }, [ensureProviderForTrack, flushPlayProgress, currentListenedMs]);

    const playTrackInternal = useCallback(
        async (next: PlayerTrack, options?: { startPositionMs?: number }) => {
            if (!musicConnected) {
                setError('Bitte einen Musikdienst in den Einstellungen verbinden.');
                return;
            }

            const normalized = normalizeTrack(next);
            if (!normalized.uri) {
                setError('Track hat keine abspielbare URI.');
                return;
            }

            const startAt = Math.max(0, Math.floor(options?.startPositionMs ?? 0));

            setTrack(normalized);
            setError(null);

            try {
                await playEngine(normalized, startAt);

                setPlaying(true);
                positionAnchorRef.current = { position: startAt, at: Date.now(), playing: true };
                setPositionMs(startAt);
                if (startAt === 0) {
                    setDurationMs(0);
                }
            } catch (err) {
                resumeGuardRef.current = null;
                let message = 'Wiedergabe fehlgeschlagen.';
                if (axios.isAxiosError(err)) {
                    const data = err.response?.data as
                        | { message?: string; errors?: Record<string, string[]> }
                        | undefined;
                    const firstError = data?.errors ? Object.values(data.errors)[0]?.[0] : undefined;
                    message = firstError || data?.message || message;
                } else if (err instanceof Error && err.message) {
                    message = err.message;
                }
                setError(message);
            }
        },
        [musicConnected, playEngine],
    );

    const playTrack = useCallback(
        async (next: PlayerTrack) => {
            setQueue(null);
            await playTrackInternal(next);
        },
        [playTrackInternal],
    );

    const playAtCursor = useCallback(
        async (nextQueue: QueueState) => {
            const trackIndex = nextQueue.order[nextQueue.cursor];
            const nextTrack = nextQueue.tracks[trackIndex];
            if (!nextTrack) {
                return;
            }
            setQueue(nextQueue);
            await playTrackInternal(nextTrack);
        },
        [playTrackInternal],
    );

    const playPlaylist = useCallback(
        async (
            tracks: PlayerTrack[],
            options?: { playlistId?: number; startIndex?: number; shuffle?: boolean },
        ) => {
            const playable = tracks.filter((t) => Boolean(t.uri)).map(normalizeTrack);
            if (playable.length === 0) {
                setError('Keine abspielbaren Tracks in der Playlist.');
                return;
            }

            const useShuffle = options?.shuffle ?? shuffleRef.current;

            if (options?.shuffle === true) {
                setShuffle(true);
                shuffleRef.current = true;
                writeStoredFlag(SHUFFLE_STORAGE_KEY, true);
            } else if (options?.shuffle === false) {
                setShuffle(false);
                shuffleRef.current = false;
                writeStoredFlag(SHUFFLE_STORAGE_KEY, false);
            }

            const hasStartIndex = typeof options?.startIndex === 'number';
            const startIndex = hasStartIndex
                ? Math.min(Math.max(options.startIndex as number, 0), playable.length - 1)
                : 0;

            const order = useShuffle
                ? shuffleIndices(playable.length, hasStartIndex ? startIndex : undefined)
                : sequentialIndices(playable.length);

            const cursor = useShuffle ? 0 : startIndex;

            const nextQueue: QueueState = {
                playlistId: options?.playlistId ?? null,
                tracks: playable,
                order,
                cursor,
            };

            await playAtCursor(nextQueue);
        },
        [playAtCursor],
    );

    const rebuildOrderKeepingCurrent = useCallback((tracks: PlayerTrack[], current: PlayerTrack | null, enableShuffle: boolean) => {
        const currentIndex = current
            ? tracks.findIndex((t) => t.uri === current.uri && (t.songId == null || t.songId === current.songId))
            : 0;
        const safeIndex = currentIndex >= 0 ? currentIndex : 0;
        const order = enableShuffle
            ? shuffleIndices(tracks.length, safeIndex)
            : sequentialIndices(tracks.length);
        const cursor = enableShuffle ? 0 : safeIndex;
        return { order, cursor };
    }, []);

    const playPrevious = useCallback(async () => {
        if (controlsLocked) {
            return;
        }
        const currentQueue = queueRef.current;
        if (!currentQueue || currentQueue.tracks.length === 0) {
            return;
        }

        if (positionAnchorRef.current.position > 3000) {
            await providerRef.current?.seek(0);
            positionAnchorRef.current = { position: 0, at: Date.now(), playing: positionAnchorRef.current.playing };
            setPositionMs(0);
            return;
        }

        if (currentQueue.cursor > 0) {
            await playAtCursor({ ...currentQueue, cursor: currentQueue.cursor - 1 });
            return;
        }

        await playAtCursor({ ...currentQueue, cursor: currentQueue.order.length - 1 });
    }, [playAtCursor, controlsLocked]);

    const playNext = useCallback(async () => {
        if (controlsLocked) {
            return;
        }
        const currentQueue = queueRef.current;
        if (!currentQueue || currentQueue.tracks.length === 0) {
            return;
        }

        if (currentQueue.cursor < currentQueue.order.length - 1) {
            await playAtCursor({ ...currentQueue, cursor: currentQueue.cursor + 1 });
            return;
        }

        if (shuffleRef.current) {
            const order = shuffleIndices(currentQueue.tracks.length);
            await playAtCursor({ ...currentQueue, order, cursor: 0 });
            return;
        }

        await playAtCursor({ ...currentQueue, cursor: 0 });
    }, [playAtCursor, controlsLocked]);

    const switchProvider = useCallback(
        async (provider: MusicProviderId) => {
            if (controlsLocked) {
                return;
            }

            const current = trackRef.current;
            if (!current) {
                return;
            }
            if (current.provider === provider) {
                return;
            }

            let next = playerTrackForProvider(current, provider);
            if (!next && current.songId) {
                try {
                    const { data } = await api.get<{ data: Song }>(`/songs/${current.songId}`);
                    const resolved = songToPlayerTrack(data.data, userRef.current);
                    if (resolved?.providerLinks) {
                        setTrack((prev) =>
                            prev && prev.songId === current.songId
                                ? {
                                      ...prev,
                                      providerLinks: resolved.providerLinks,
                                      preferredProvider: resolved.preferredProvider,
                                      lastWorkingProvider: resolved.lastWorkingProvider,
                                  }
                                : prev,
                        );
                        next = playerTrackForProvider(
                            {
                                ...current,
                                providerLinks: resolved.providerLinks,
                                preferredProvider: resolved.preferredProvider,
                                lastWorkingProvider: resolved.lastWorkingProvider,
                            },
                            provider,
                        );
                    }
                } catch {
                    // fall through
                }
            }

            if (!next) {
                setError(`Kein ${providerLabel(provider)}-Link für diesen Song.`);
                return;
            }

            if (!isProviderConnected(userRef.current, provider)) {
                setError(`${providerLabel(provider)} ist nicht aktiv. Bitte in den Einstellungen aktivieren.`);
                return;
            }

            await playTrackInternal(next, { startPositionMs: positionMsRef.current });
        },
        [controlsLocked, playTrackInternal],
    );

    const attachSongProviders = useCallback((song: Song) => {
        const resolved = songToPlayerTrack(song, userRef.current);
        if (!resolved) {
            return;
        }
        setTrack((prev) => {
            if (!prev || prev.songId !== song.id) {
                return prev;
            }
            return {
                ...prev,
                providerLinks: resolved.providerLinks,
                preferredProvider: resolved.preferredProvider,
                lastWorkingProvider: resolved.lastWorkingProvider,
            };
        });
    }, []);

    const toggle = useCallback(async () => {
        if (controlsLocked) {
            return;
        }

        const provider = providerRef.current;
        if (!provider) {
            return;
        }

        if (!playing && track) {
            const resumeAt = Math.max(
                0,
                Math.floor(positionMsRef.current || positionAnchorRef.current.position || positionMs || 0),
            );
            const state = await provider.getCurrentState();
            const currentUri = state?.track?.uri;
            const statePosition = state?.position ?? 0;

            if (!state || currentUri !== track.uri || (resumeAt > 1500 && statePosition + 2000 < resumeAt)) {
                await playTrackInternal(track, { startPositionMs: resumeAt });
                return;
            }

            if (resumeAt > 1500 && Math.abs(statePosition - resumeAt) > 1500) {
                resumeGuardRef.current = {
                    until: Date.now() + 2500,
                    minPosition: resumeAt,
                };
                await provider.seek(resumeAt);
                positionAnchorRef.current = { position: resumeAt, at: Date.now(), playing: true };
                setPositionMs(resumeAt);
            }

            await provider.resume();
            setPlaying(true);
            positionAnchorRef.current = {
                position: resumeAt > 0 ? resumeAt : positionAnchorRef.current.position || statePosition,
                at: Date.now(),
                playing: true,
            };
            return;
        }

        if (playing) {
            await provider.pause();
            const pausedAt = positionMsRef.current || positionMs;
            setPlaying(false);
            positionAnchorRef.current = {
                position: pausedAt,
                at: Date.now(),
                playing: false,
            };
            setPositionMs(pausedAt);
        }
    }, [playing, track, playTrackInternal, positionMs, controlsLocked]);

    const seek = useCallback(async (nextPositionMs: number) => {
        if (controlsLocked) {
            return;
        }
        const clamped = Math.max(0, Math.min(nextPositionMs, durationMs || nextPositionMs));
        await providerRef.current?.seek(clamped);
        positionAnchorRef.current = {
            position: clamped,
            at: Date.now(),
            playing: positionAnchorRef.current.playing,
        };
        setPositionMs(clamped);
    }, [durationMs, controlsLocked]);

    const syncFromRemote = useCallback(
        async (payload: {
            provider?: string | null;
            uri: string | null;
            title?: string | null;
            artist?: string | null;
            albumArtUrl?: string | null;
            songId?: number | null;
            positionMs: number;
            isPlaying: boolean;
        }) => {
            const provider = providerRef.current;

            if (!payload.uri) {
                if (provider && playing) {
                    await provider.pause();
                }
                setPlaying(false);
                setPositionMs(0);
                positionAnchorRef.current = { position: 0, at: Date.now(), playing: false };
                return;
            }

            const nextTrack: PlayerTrack = {
                provider: (payload.provider as PlayerTrack['provider']) || track?.provider || 'spotify',
                trackId: payload.uri.split(':').pop() || '',
                uri: payload.uri,
                title: payload.title || track?.title || 'Track',
                artist: payload.artist || track?.artist || '',
                albumArtUrl: payload.albumArtUrl ?? track?.albumArtUrl ?? null,
                songId: payload.songId ?? track?.songId,
            };

            const targetPos = Math.max(0, Math.floor(payload.positionMs));
            const uriChanged = track?.uri !== payload.uri;
            const drift = Math.abs(positionMsRef.current - targetPos);

            syncingRemoteRef.current = true;
            try {
                if (uriChanged || (payload.isPlaying && !playing)) {
                    setQueue(null);
                    await playTrackInternal(nextTrack, { startPositionMs: targetPos });
                    if (!payload.isPlaying) {
                        await provider?.pause();
                        setPlaying(false);
                        positionAnchorRef.current = { position: targetPos, at: Date.now(), playing: false };
                        setPositionMs(targetPos);
                    }
                    return;
                }

                setTrack(nextTrack);

                if (drift > 1500) {
                    resumeGuardRef.current = {
                        until: Date.now() + 2000,
                        minPosition: targetPos,
                    };
                    await provider?.seek(targetPos);
                    setPositionMs(targetPos);
                    positionAnchorRef.current = {
                        position: targetPos,
                        at: Date.now(),
                        playing: payload.isPlaying,
                    };
                }

                if (!payload.isPlaying && playing) {
                    await provider?.pause();
                    setPlaying(false);
                    positionAnchorRef.current = {
                        position: targetPos,
                        at: Date.now(),
                        playing: false,
                    };
                    setPositionMs(targetPos);
                }
            } finally {
                window.setTimeout(() => {
                    syncingRemoteRef.current = false;
                }, 400);
            }
        },
        [playTrackInternal, playing, track],
    );

    const setOnTrackEnded = useCallback((handler: (() => void) | null) => {
        onTrackEndedRef.current = handler;
    }, []);

    const setVolume = useCallback(async (next: number) => {
        const clamped = Math.min(1, Math.max(0, next));
        setVolumeState(clamped);
        volumeRef.current = clamped;
        writeStoredVolume(VOLUME_STORAGE_KEY, clamped);
        if (clamped > 0) {
            writeStoredVolume(LAST_VOLUME_STORAGE_KEY, clamped);
        }
        await providerRef.current?.setVolume(clamped);
    }, []);

    const toggleShuffle = useCallback(() => {
        setShuffle((prev) => {
            const next = !prev;
            writeStoredFlag(SHUFFLE_STORAGE_KEY, next);
            shuffleRef.current = next;

            setQueue((current) => {
                if (!current || current.tracks.length === 0) {
                    return current;
                }
                const rebuilt = rebuildOrderKeepingCurrent(current.tracks, track, next);
                return { ...current, ...rebuilt };
            });

            return next;
        });
    }, [rebuildOrderKeepingCurrent, track]);

    const toggleRepeatOne = useCallback(() => {
        setRepeatOne((prev) => {
            const next = !prev;
            writeStoredFlag(REPEAT_STORAGE_KEY, next);
            repeatOneRef.current = next;
            return next;
        });
    }, []);

    useEffect(() => {
        if (!ready || !musicConnected || restoredRef.current) {
            return;
        }
        restoredRef.current = true;

        const session = readStoredSession();
        if (!session) {
            return;
        }

        setTrack(session.track);
        setQueue(session.queue);
        setPositionMs(session.positionMs);
        setDurationMs(session.durationMs);
        setPlaying(false);
        positionAnchorRef.current = {
            position: session.positionMs,
            at: Date.now(),
            playing: false,
        };
    }, [ready, musicConnected]);

    useEffect(() => {
        if (!musicConnected || !track) {
            return;
        }

        const persist = () => {
            const currentTrack = trackRef.current;
            if (!currentTrack) {
                return;
            }
            writeStoredSession({
                track: currentTrack,
                positionMs: positionMsRef.current,
                durationMs: durationMsRef.current,
                queue: queueRef.current,
            });
        };

        persist();
        const timer = window.setInterval(persist, 2000);
        window.addEventListener('beforeunload', persist);

        return () => {
            window.clearInterval(timer);
            window.removeEventListener('beforeunload', persist);
            persist();
        };
    }, [musicConnected, track, queue]);

    useEffect(() => {
        const anchor = playListenAnchorRef.current;
        if (!activePlayRef.current || !anchor) {
            return;
        }

        if (playing && !anchor.playing) {
            playListenAnchorRef.current = {
                at: Date.now(),
                baseMs: anchor.baseMs,
                playing: true,
            };
            return;
        }

        if (!playing && anchor.playing) {
            const listened = anchor.baseMs + (Date.now() - anchor.at);
            playListenAnchorRef.current = {
                at: Date.now(),
                baseMs: listened,
                playing: false,
            };
            void flushPlayProgress();
        }
    }, [playing, flushPlayProgress]);

    useEffect(() => {
        if (!playing || !activePlayRef.current) {
            return;
        }

        const timer = window.setInterval(() => {
            void flushPlayProgress();
        }, 15000);

        return () => window.clearInterval(timer);
    }, [playing, flushPlayProgress, track?.songId]);

    useEffect(() => {
        const onUnload = () => {
            const active = activePlayRef.current;
            if (!active) {
                return;
            }
            const listenedMs = currentListenedMs();
            if (listenedMs <= active.reportedMs) {
                return;
            }
            try {
                const xsrf = document.cookie
                    .match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1]
                    ?.replace(/\+/g, ' ');
                void fetch(`/api/songs/${active.songId}/plays/${active.playId}`, {
                    method: 'PATCH',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        ...(xsrf
                            ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) }
                            : {}),
                    },
                    body: JSON.stringify({
                        listened_ms: listenedMs,
                        duration_ms: durationMsRef.current > 0 ? Math.floor(durationMsRef.current) : undefined,
                        completed: false,
                    }),
                    credentials: 'include',
                    keepalive: true,
                });
            } catch {
                // ignore
            }
        };

        window.addEventListener('pagehide', onUnload);
        return () => window.removeEventListener('pagehide', onUnload);
    }, [currentListenedMs]);

    useEffect(() => {
        if (!playing || !durationMs || durationMs < 1000) {
            return;
        }
        if (positionMs < durationMs - 500) {
            advancingRef.current = false;
            return;
        }
        if (advancingRef.current || syncingRemoteRef.current) {
            return;
        }
        advancingRef.current = true;

        void (async () => {
            await flushPlayProgress({ clear: true, completed: true });

            if (onTrackEndedRef.current) {
                onTrackEndedRef.current();
                window.setTimeout(() => {
                    advancingRef.current = false;
                }, 800);
                return;
            }

            if (repeatOneRef.current) {
                await seek(0);
                await providerRef.current?.resume();
                setPlaying(true);
                positionAnchorRef.current = { position: 0, at: Date.now(), playing: true };
                // Count repeat as a fresh play.
                const current = trackRef.current;
                if (current?.songId && !syncingRemoteRef.current) {
                    void api
                        .post<{ data: Song; play: SongPlay | null }>(
                            `/songs/${current.songId}/played`,
                            {
                                provider: current.provider,
                                provider_track_id: current.trackId,
                                provider_uri: current.uri,
                                album_art_url: current.albumArtUrl,
                                duration_ms: durationMsRef.current > 0 ? Math.floor(durationMsRef.current) : undefined,
                                track: true,
                            },
                            { skipErrorToast: true },
                        )
                        .then(({ data }) => {
                            if (!data.play?.id || trackRef.current?.songId !== current.songId) {
                                return;
                            }
                            activePlayRef.current = {
                                songId: current.songId,
                                playId: data.play.id,
                                reportedMs: 0,
                            };
                            playListenAnchorRef.current = {
                                at: Date.now(),
                                baseMs: 0,
                                playing: true,
                            };
                        })
                        .catch(() => {
                            // ignore
                        });
                }
                advancingRef.current = false;
                return;
            }

            if (queueRef.current) {
                await playNext();
            } else {
                setPlaying(false);
                setPositionMs(0);
                positionAnchorRef.current = { position: 0, at: Date.now(), playing: false };
                const provider = providerRef.current;
                if (provider) {
                    try {
                        await provider.pause();
                        await provider.seek(0);
                    } catch {
                        // ignore
                    }
                }
            }
            window.setTimeout(() => {
                advancingRef.current = false;
            }, 800);
        })();
    }, [positionMs, durationMs, playing, seek, playNext, flushPlayProgress]);

    const canPrev = Boolean(queue && queue.tracks.length > 0) && !controlsLocked;
    const canNext = Boolean(queue && queue.tracks.length > 0) && !controlsLocked;

    const value = useMemo(
        () => ({
            track,
            ready,
            playing,
            positionMs,
            durationMs,
            volume,
            error,
            queue,
            shuffle,
            repeatOne,
            canPrev,
            canNext,
            controlsLocked,
            playTrack,
            playPlaylist,
            playNext,
            playPrevious,
            switchProvider,
            attachSongProviders,
            toggle,
            setVolume,
            seek,
            toggleShuffle,
            toggleRepeatOne,
            setControlsLocked,
            syncFromRemote,
            setOnTrackEnded,
        }),
        [
            track,
            ready,
            playing,
            positionMs,
            durationMs,
            volume,
            error,
            queue,
            shuffle,
            repeatOne,
            canPrev,
            canNext,
            controlsLocked,
            playTrack,
            playPlaylist,
            playNext,
            playPrevious,
            switchProvider,
            attachSongProviders,
            toggle,
            setVolume,
            seek,
            toggleShuffle,
            toggleRepeatOne,
            syncFromRemote,
            setOnTrackEnded,
        ],
    );

    return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
    const ctx = useContext(PlayerContext);
    if (!ctx) {
        throw new Error('usePlayer must be used within PlayerProvider');
    }
    return ctx;
}

export function formatTime(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
        return '0:00';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatTimePrecise(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
        return '0:00.00';
    }
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0');
    return `${minutes}:${seconds}`;
}
