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
import { useI18n } from '@/context/locale-context';
import api from '@/lib/api';
import {
    activeProviderId,
    playbackProviderIds,
    isPlaybackProviderConnected,
    providerFromUri,
    providerLabel,
    scoreProviderTrackMatch,
} from '@/lib/music';
import { playerTrackForProvider, rememberSongPlaybackProvider, songToPlayerTrack } from '@/lib/playable';
import { toast } from '@/lib/toast';
import { recordCompletedPlay } from '@/lib/favorite-suggest';
import { getProvider, releaseProvider, type MusicProvider, type PlayableTrack, type ProviderPlaybackState } from '@/music';
import type { MusicProviderId } from '@/music/types';
import type { ProviderTrack, Song, SongPlay } from '@/types';

export type PlayerTrack = PlayableTrack;

export type QueueMode = 'playlist' | 'radio';

export type QueueState = {
    playlistId: string | null;
    mode: QueueMode;
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
    playTrack: (track: PlayerTrack, options?: { radio?: boolean }) => Promise<void>;
    playPlaylist: (tracks: PlayerTrack[], options?: { playlistId?: string; startIndex?: number; shuffle?: boolean }) => Promise<void>;
    playNext: (options?: { ignoreLock?: boolean }) => Promise<void>;
    playPrevious: () => Promise<void>;
    playQueueCursor: (cursor: number) => Promise<void>;
    removeUpcoming: (orderIndex: number) => void;
    syncPlaylistQueue: (playlistId: string, tracks: PlayerTrack[]) => void;
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
        songId?: string | null;
        positionMs: number;
        isPlaying: boolean;
    }) => Promise<void>;
    setOnTrackEnded: (handler: (() => void) | null) => void;
    subscribeTrackEnded: (handler: (track: PlayerTrack) => void) => () => void;
    clearPlayback: () => Promise<void>;
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

const END_POSITION_TOLERANCE_MS = 2000;

function isNearEnd(position: number, duration: number, tolerance = END_POSITION_TOLERANCE_MS): boolean {
    return duration >= 1000 && position >= Math.max(0, duration - tolerance);
}

function playbackUrisMatch(
    expectedUri: string | null,
    track: { uri: string; linkedFromUri?: string | null } | null,
): boolean {
    if (!expectedUri || !track?.uri) {
        return false;
    }
    const candidates = [track.uri, track.linkedFromUri ?? null].filter((uri): uri is string => Boolean(uri));
    if (candidates.includes(expectedUri)) {
        return true;
    }
    const expectedId = expectedUri.split(':').pop();
    if (!expectedId) {
        return false;
    }
    return candidates.some((uri) => uri.split(':').pop() === expectedId);
}

async function silenceProvider(provider: MusicProvider): Promise<void> {
    try {
        await provider.silence();
    } catch {
        // ignore
    }
}

async function silenceOtherProviders(
    providers: Map<MusicProviderId, MusicProvider>,
    ownerId: MusicProviderId,
): Promise<void> {
    await Promise.all(
        [...providers.values()]
            .filter((provider) => provider.id !== ownerId)
            .map((provider) => silenceProvider(provider)),
    );
}

async function silenceAllProviders(providers: Map<MusicProviderId, MusicProvider>): Promise<void> {
    await Promise.all([...providers.values()].map((provider) => silenceProvider(provider)));
}

function looksLikeNaturalEnd(options: {
    paused: boolean;
    position: number;
    duration: number;
    maxPosition: number;
    ended?: boolean;
}): boolean {
    if (options.ended) {
        return true;
    }
    if (!options.paused || options.duration < 1000) {
        return false;
    }
    if (isNearEnd(options.position, options.duration) || isNearEnd(options.maxPosition, options.duration)) {
        return true;
    }
    // Spotify often resets to 0 after the track ends, with the last live position several seconds back.
    if (
        options.position < 1500 &&
        (options.maxPosition >= options.duration * 0.8 ||
            isNearEnd(options.maxPosition, options.duration, 12000))
    ) {
        return true;
    }
    return false;
}

function normalizeQueue(queue: QueueState | null | (Omit<QueueState, 'mode'> & { mode?: QueueMode })): QueueState | null {
    if (!queue || !Array.isArray(queue.tracks) || !Array.isArray(queue.order)) {
        return null;
    }
    return {
        playlistId: queue.playlistId ?? null,
        mode: queue.mode ?? (queue.playlistId ? 'playlist' : 'radio'),
        tracks: queue.tracks,
        order: queue.order,
        cursor: Number.isFinite(queue.cursor) ? queue.cursor : 0,
    };
}

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
            artists: parsed.track.artists,
            albumArtUrl: parsed.track.albumArtUrl ?? null,
            songId: parsed.track.songId,
            lyrics: parsed.track.lyrics,
            durationMs: parsed.track.durationMs ?? null,
            providerLinks: parsed.track.providerLinks,
            preferredProvider: parsed.track.preferredProvider ?? null,
            lastWorkingProvider: parsed.track.lastWorkingProvider ?? null,
        };
        return {
            track,
            positionMs: Math.max(0, Number(parsed.positionMs) || 0),
            durationMs: Math.max(0, Number(parsed.durationMs) || 0),
            queue: normalizeQueue(parsed.queue),
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
    user: Parameters<typeof playbackProviderIds>[0],
): Promise<PlayerTrack | null> {
    const connected = playbackProviderIds(user);
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
                            durationMs:
                                candidate.duration_ms && candidate.duration_ms > 0
                                    ? candidate.duration_ms
                                    : track.durationMs,
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
    const { t } = useI18n();
    const { user } = useAuth();
    const connectedIds = playbackProviderIds(user);
    const musicConnected = connectedIds.length > 0;
    const rawActive = activeProviderId(user);
    const providerId =
        rawActive && connectedIds.includes(rawActive) ? rawActive : connectedIds[0] ?? null;
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
    const playbackEpochRef = useRef(0);
    const ignoreEndedUntilRef = useRef(0);
    const liveDurationRef = useRef(false);
    const finishCurrentTrackRef = useRef<() => Promise<void>>(async () => {});
    const lastAppliedStateRef = useRef<{
        uri: string | null;
        position: number;
        paused: boolean;
        duration: number;
    } | null>(null);
    const userPausedRef = useRef(false);
    const maxPositionRef = useRef(0);
    const providerPausedAtRef = useRef<number | null>(null);
    const playbackClockRef = useRef<{ uri: string; originMs: number; originAt: number } | null>(null);
    const queueRef = useRef<QueueState | null>(null);
    const fillingRadioRef = useRef(false);
    const fillingRadioPromiseRef = useRef<Promise<void> | null>(null);
    const radioExhaustedRef = useRef(false);
    const repeatOneRef = useRef(false);
    const shuffleRef = useRef(false);
    const restoredRef = useRef(false);
    const trackRef = useRef<PlayerTrack | null>(null);
    const positionMsRef = useRef(0);
    const durationMsRef = useRef(0);
    const resumeGuardRef = useRef<{ until: number; minPosition: number } | null>(null);
    const onTrackEndedRef = useRef<(() => void) | null>(null);
    const trackEndedListenersRef = useRef(new Set<(track: PlayerTrack) => void>());
    const syncingRemoteRef = useRef(false);
    const activePlayRef = useRef<{
        songId: string;
        playId: string;
        reportedMs: number;
        durationMs: number;
    } | null>(null);
    const playListenAnchorRef = useRef<{ at: number; baseMs: number; playing: boolean } | null>(null);
    const playLockRef = useRef(Promise.resolve());
    const listenerCleanupsRef = useRef(new Map<MusicProviderId, Array<() => void>>());
    const applyStateRef = useRef<(state: ProviderPlaybackState | null) => void>(() => {});

    const [track, setTrack] = useState<PlayerTrack | null>(null);
    const [readyByProvider, setReadyByProvider] = useState<Partial<Record<MusicProviderId, boolean>>>({});
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
            toast.error(message, t('player.title'));
        }
    }, [t]);

    const commitQueue = useCallback((next: QueueState | null) => {
        queueRef.current = next;
        setQueue(next);
    }, []);

    const armPlaybackClock = useCallback((uri: string, position: number) => {
        playbackClockRef.current = {
            uri,
            originMs: Math.max(0, Math.floor(position)),
            originAt: Date.now(),
        };
    }, []);

    const estimatedPositionMs = useCallback((): number => {
        const clock = playbackClockRef.current;
        if (!clock) {
            return positionMsRef.current;
        }
        if (userPausedRef.current || providerPausedAtRef.current != null) {
            return clock.originMs;
        }
        return clock.originMs + (Date.now() - clock.originAt);
    }, []);

    const ready =
        musicConnected &&
        (track ? Boolean(readyByProvider[track.provider]) : Object.values(readyByProvider).some(Boolean));

    useEffect(() => {
        volumeRef.current = volume;
    }, [volume]);

    useEffect(() => {
        if (track && trackRef.current?.uri && track.uri !== trackRef.current.uri) {
            return;
        }
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
        const expectedUri = trackRef.current?.uri ?? null;
        const canFinishTrack =
            Date.now() >= ignoreEndedUntilRef.current &&
            !syncingRemoteRef.current &&
            !advancingRef.current &&
            !userPausedRef.current &&
            Boolean(expectedUri);

        const estimated = estimatedPositionMs();
        maxPositionRef.current = Math.max(maxPositionRef.current, estimated, positionMsRef.current);

        if (!state) {
            if (
                canFinishTrack &&
                looksLikeNaturalEnd({
                    paused: true,
                    position: 0,
                    duration: durationMsRef.current,
                    maxPosition: maxPositionRef.current,
                })
            ) {
                void finishCurrentTrackRef.current();
            }
            return;
        }

        const current = state.track;
        // Ignore stale provider state while switching tracks (avoids cover flicker + false auto-advance).
        // Spotify often relinks to a market-specific URI — treat linked_from / same track id as a match.
        if (expectedUri && current?.uri && !playbackUrisMatch(expectedUri, current)) {
            return;
        }
        if (expectedUri && !current?.uri && Date.now() < ignoreEndedUntilRef.current) {
            return;
        }

        const resolvedDuration = state.duration > 0 ? state.duration : durationMsRef.current;
        maxPositionRef.current = Math.max(maxPositionRef.current, state.position, estimated);

        const ended = looksLikeNaturalEnd({
            paused: state.paused,
            position: state.position,
            duration: resolvedDuration,
            maxPosition: maxPositionRef.current,
            ended: state.ended,
        });

        lastAppliedStateRef.current = {
            uri: current?.uri ?? expectedUri,
            position: state.position,
            paused: state.paused,
            duration: resolvedDuration,
        };

        if (ended && canFinishTrack) {
            void finishCurrentTrackRef.current();
            return;
        }

        if (state.paused) {
            if (providerPausedAtRef.current == null) {
                providerPausedAtRef.current = Date.now();
            }
            const uri = expectedUri ?? current?.uri;
            if (uri) {
                armPlaybackClock(uri, state.position > 0 ? state.position : estimated);
            }
        } else {
            providerPausedAtRef.current = null;
            const uri = expectedUri ?? current?.uri;
            if (uri && !userPausedRef.current) {
                armPlaybackClock(uri, state.position);
            }
        }

        const guard = resumeGuardRef.current;
        const statePosition = state.position;
        if (guard && Date.now() < guard.until && statePosition + 1500 < guard.minPosition) {
            setPlaying(!state.paused);
            if (state.duration > 0) {
                liveDurationRef.current = true;
                setDurationMs(state.duration);
                durationMsRef.current = state.duration;
                if (activePlayRef.current) {
                    activePlayRef.current.durationMs = state.duration;
                }
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

        // Providers (esp. Spotify/TIDAL) often emit duration=0 while loading or mid-poll.
        // Never clobber a known duration with 0 — prefer live > catalog seed.
        if (state.duration > 0) {
            liveDurationRef.current = true;
            setDurationMs(state.duration);
            durationMsRef.current = state.duration;
            if (activePlayRef.current) {
                activePlayRef.current.durationMs = state.duration;
            }
        } else if (durationMsRef.current <= 0) {
            const seeded = trackRef.current?.durationMs;
            if (seeded && seeded > 0) {
                setDurationMs(seeded);
                durationMsRef.current = seeded;
                if (activePlayRef.current) {
                    activePlayRef.current.durationMs = seeded;
                }
            }
        }

        if (current) {
            setTrack((prev) => ({
                provider: prev?.provider || providerFromUri(current.uri) || providerId || 'spotify',
                trackId: prev?.uri === current.uri ? prev.trackId : current.uri.split(':').pop() || '',
                uri: current.uri,
                title: current.name || prev?.title || t('player.fallbackTrack'),
                artist: current.artists.join(', ') || prev?.artist || '',
                artists: prev?.uri === current.uri ? prev?.artists : undefined,
                albumArtUrl: current.albumArtUrl ?? prev?.albumArtUrl ?? null,
                songId: prev?.songId,
                lyrics: prev?.lyrics,
                durationMs: state.duration > 0 ? state.duration : (prev?.durationMs ?? null),
                providerLinks: prev?.providerLinks,
                preferredProvider: prev?.preferredProvider,
                lastWorkingProvider: prev?.lastWorkingProvider,
            }));
        }
    }, [providerId, t, estimatedPositionMs, armPlaybackClock]);

    applyStateRef.current = applyState;

    const enqueuePlayback = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
        const run = playLockRef.current.then(fn, fn);
        playLockRef.current = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }, []);

    const attachProviderListeners = useCallback((provider: MusicProvider) => {
        if (listenerCleanupsRef.current.has(provider.id)) {
            return;
        }
        const offs = [
            provider.onStateChange((state) => {
                if (providerRef.current?.id === provider.id) {
                    applyStateRef.current(state);
                }
            }),
            provider.onReadyChange((isReady) => {
                setReadyByProvider((prev) => ({ ...prev, [provider.id]: isReady }));
                if (isReady && providerRef.current?.id === provider.id) {
                    setError(null);
                }
            }),
            provider.onError((message) => setError(message)),
        ];
        listenerCleanupsRef.current.set(provider.id, offs);
    }, [setError]);

    const detachProviderListeners = useCallback((id: MusicProviderId) => {
        listenerCleanupsRef.current.get(id)?.forEach((fn) => fn());
        listenerCleanupsRef.current.delete(id);
    }, []);

    const claimPlaybackOwner = useCallback(async (provider: MusicProvider) => {
        providerRef.current = provider;
        await silenceOtherProviders(providersRef.current, provider.id);
        try {
            await provider.setVolume(volumeRef.current);
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        if (!musicConnected || connectedIds.length === 0) {
            restoredRef.current = false;
            [...providersRef.current.keys()].forEach((id) => {
                detachProviderListeners(id);
                releaseProvider(id);
            });
            providersRef.current.clear();
            providerRef.current = null;
            setReadyByProvider({});
            setPlaying(false);
            setTrack(null);
            commitQueue(null);
            setPositionMs(0);
            setDurationMs(0);
            return;
        }

        const activeSet = new Set(connectedIds);
        let cancelled = false;

        // Tear down providers that are no longer active+connected.
        for (const id of [...providersRef.current.keys()]) {
            if (!activeSet.has(id)) {
                detachProviderListeners(id);
                releaseProvider(id);
                providersRef.current.delete(id);
                setReadyByProvider((prev) => {
                    if (!(id in prev)) {
                        return prev;
                    }
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
                if (providerRef.current?.id === id) {
                    providerRef.current = null;
                }
            }
        }

        const wired: MusicProvider[] = [];
        for (const id of connectedIds) {
            const provider = getProvider(id);
            providersRef.current.set(id, provider);
            attachProviderListeners(provider);
            wired.push(provider);
        }

        void (async () => {
            await Promise.allSettled(
                wired.map(async (provider) => {
                    try {
                        await provider.connect();
                        if (!cancelled) {
                            try {
                                await provider.setVolume(volumeRef.current);
                            } catch {
                                // ignore
                            }
                            setReadyByProvider((prev) => ({ ...prev, [provider.id]: provider.ready }));
                        }
                    } catch (e) {
                        if (!cancelled) {
                            setReadyByProvider((prev) => ({ ...prev, [provider.id]: false }));
                            const label = providerLabel(provider.id);
                            const message =
                                e instanceof Error ? e.message : `${label}-Player konnte nicht gestartet werden.`;
                            setError(`${label}: ${message}`);
                        }
                    }
                }),
            );

            if (cancelled) {
                return;
            }

            const preferredId =
                (providerId && activeSet.has(providerId) ? providerId : null) ??
                connectedIds[0] ??
                null;
            const preferred =
                (preferredId && providersRef.current.get(preferredId)) ||
                wired.find((provider) => provider.ready) ||
                wired[0] ||
                null;
            if (!providerRef.current || !activeSet.has(providerRef.current.id)) {
                providerRef.current = preferred ?? null;
            }
        })();

        return () => {
            cancelled = true;
            for (const id of connectedIds) {
                detachProviderListeners(id);
            }
            // Keep provider instances across StrictMode remounts; only release
            // when the effect re-runs with an empty connected set or inactive ids.
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [musicConnected, connectedIds.join(','), providerId, attachProviderListeners, detachProviderListeners, setError]);

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

        if (!isPlaybackProviderConnected(userRef.current, needed)) {
            const fallback = await resolveFallbackTrack(playable, userRef.current);
            if (!fallback) {
                throw new Error(t('player.providerInactive', { provider: providerLabel(needed) }));
            }
            playable = fallback;
            needed = playable.provider;
        }

        let provider = providersRef.current.get(needed);
        if (!provider) {
            provider = getProvider(needed);
            providersRef.current.set(needed, provider);
            attachProviderListeners(provider);
            await provider.connect();
        }

        if (!provider.ready) {
            await provider.connect();
        }

        await claimPlaybackOwner(provider);
        setReadyByProvider((prev) => ({ ...prev, [provider.id]: provider.ready }));

        return { provider, track: playable };
    }, [attachProviderListeners, claimPlaybackOwner, t]);

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

            const completedSongId = completed ? active.songId : null;

            try {
                await api.patch(
                    `/songs/${active.songId}/plays/${active.playId}`,
                    {
                        listened_ms: listenedMs,
                        duration_ms: active.durationMs > 0 ? Math.floor(active.durationMs) : undefined,
                        completed,
                    },
                    { skipErrorToast: true },
                );
            } catch {
                // non-blocking
            }

            if (completedSongId && userRef.current) {
                recordCompletedPlay(completedSongId);
            }

            if (shouldClear) {
                activePlayRef.current = null;
                playListenAnchorRef.current = null;
            }
        },
        [currentListenedMs],
    );

    const playEngine = useCallback(async (next: PlayerTrack, startAt: number, epoch: number) => {
        let { provider, track: playable } = await ensureProviderForTrack(next);

        if (playbackEpochRef.current !== epoch) {
            await silenceProvider(provider);
            return;
        }

        const trackPlay = Boolean(playable.songId) && !syncingRemoteRef.current;
        const isFreshStart = startAt < 2500;
        const prev = activePlayRef.current;

        // Flush the previous play before switching tracks so we don't attach the next
        // track's duration to the previous song.
        if (trackPlay && playable.songId) {
            if (prev && (prev.songId !== playable.songId || isFreshStart)) {
                await flushPlayProgress({
                    clear: true,
                    completed: prev.songId === playable.songId,
                });
            }
        } else if (prev) {
            await flushPlayProgress({ clear: true });
        }

        if (playbackEpochRef.current !== epoch) {
            await silenceProvider(provider);
            return;
        }

        trackRef.current = playable;
        setTrack(playable);
        const seededDuration =
            playable.durationMs && playable.durationMs > 0 ? Math.floor(playable.durationMs) : 0;
        setDurationMs(seededDuration);
        durationMsRef.current = seededDuration;

        if (startAt > 0) {
            resumeGuardRef.current = {
                until: Date.now() + 2500,
                minPosition: startAt,
            };
        } else {
            resumeGuardRef.current = null;
        }

        try {
            await provider.play(playable, startAt);
        } catch (err) {
            const fallback = await resolveFallbackTrack(playable, userRef.current);
            if (!fallback) {
                throw err;
            }
            await silenceProvider(provider);
            const switched = await ensureProviderForTrack(fallback);
            provider = switched.provider;
            playable = switched.track;
            if (playbackEpochRef.current !== epoch) {
                await silenceProvider(provider);
                return;
            }
            trackRef.current = playable;
            setTrack(playable);
            setError(null);
            await provider.play(playable, startAt);
        }

        if (playbackEpochRef.current !== epoch) {
            await silenceProvider(provider);
            return;
        }

        if (trackPlay && playable.songId) {
            if (isFreshStart || !activePlayRef.current || activePlayRef.current.songId !== playable.songId) {
                void api
                    .post<{ data: Song; play: SongPlay | null }>(
                        `/songs/${playable.songId}/played`,
                        {
                            provider: playable.provider,
                            provider_track_id: playable.trackId,
                            provider_uri: playable.uri,
                            album_art_url: playable.albumArtUrl,
                            duration_ms:
                                liveDurationRef.current && durationMsRef.current > 0
                                    ? Math.floor(durationMsRef.current)
                                    : undefined,
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
                            durationMs: durationMsRef.current > 0 ? durationMsRef.current : 0,
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
    }, [ensureProviderForTrack, flushPlayProgress, currentListenedMs, setError]);

    const playTrackInternal = useCallback(
        async (next: PlayerTrack, options?: { startPositionMs?: number }) => {
            if (!musicConnected) {
                setError(t('player.connectService'));
                return;
            }

            const normalized = normalizeTrack(next);
            if (!normalized.uri) {
                setError(t('player.noUri'));
                return;
            }

            await enqueuePlayback(async () => {
                const startAt = Math.max(0, Math.floor(options?.startPositionMs ?? 0));

                // Cancel any pending auto-advance from the previous track (e.g. click in last second).
                playbackEpochRef.current += 1;
                const epoch = playbackEpochRef.current;
                advancingRef.current = false;
                ignoreEndedUntilRef.current = Date.now() + 2000;
                liveDurationRef.current = false;
                userPausedRef.current = false;
                providerPausedAtRef.current = null;
                maxPositionRef.current = startAt;
                armPlaybackClock(normalized.uri, startAt);
                lastAppliedStateRef.current = {
                    uri: normalized.uri,
                    position: startAt,
                    paused: false,
                    duration: normalized.durationMs && normalized.durationMs > 0 ? Math.floor(normalized.durationMs) : 0,
                };

                trackRef.current = normalized;
                setTrack(normalized);
                setError(null);
                setPlaying(true);
                positionAnchorRef.current = { position: startAt, at: Date.now(), playing: true };
                setPositionMs(startAt);
                if (startAt === 0) {
                    const seeded =
                        normalized.durationMs && normalized.durationMs > 0
                            ? Math.floor(normalized.durationMs)
                            : 0;
                    setDurationMs(seeded);
                    durationMsRef.current = seeded;
                }

                try {
                    await playEngine(normalized, startAt, epoch);
                    if (playbackEpochRef.current !== epoch) {
                        return;
                    }

                    setPlaying(true);
                    positionAnchorRef.current = { position: startAt, at: Date.now(), playing: true };
                    setPositionMs(startAt);
                } catch (err) {
                    if (playbackEpochRef.current !== epoch) {
                        return;
                    }
                    resumeGuardRef.current = null;
                    let message = t('player.playbackFailed');
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
                    setPlaying(false);
                    positionAnchorRef.current = {
                        position: positionMsRef.current,
                        at: Date.now(),
                        playing: false,
                    };
                }
            });
        },
        [musicConnected, playEngine, setError, t, armPlaybackClock, enqueuePlayback],
    );

    const playAtCursor = useCallback(
        async (nextQueue: QueueState) => {
            const latest = queueRef.current;
            const merged: QueueState =
                latest &&
                latest.mode === 'radio' &&
                nextQueue.mode === 'radio' &&
                latest.order.length > nextQueue.order.length
                    ? { ...latest, cursor: nextQueue.cursor }
                    : nextQueue;
            const trackIndex = merged.order[merged.cursor];
            const nextTrack = merged.tracks[trackIndex];
            if (!nextTrack) {
                return;
            }
            commitQueue(merged);
            await playTrackInternal(nextTrack);
        },
        [playTrackInternal, commitQueue],
    );

    const appendRadioTracks = useCallback((incoming: PlayerTrack[]) => {
        const current = queueRef.current;
        if (!current || current.mode !== 'radio' || incoming.length === 0) {
            return current;
        }

        const existingUris = new Set(current.tracks.map((item) => item.uri));
        const existingIds = new Set(current.tracks.map((item) => item.songId).filter(Boolean));
        const fresh = incoming.filter((item) => {
            if (!item.uri || existingUris.has(item.uri)) {
                return false;
            }
            if (item.songId && existingIds.has(item.songId)) {
                return false;
            }
            return true;
        });

        if (fresh.length === 0) {
            return current;
        }

        const start = current.tracks.length;
        const tracks = [...current.tracks, ...fresh.map(normalizeTrack)];
        let addedOrder = fresh.map((_, index) => start + index);
        if (shuffleRef.current && addedOrder.length > 1) {
            addedOrder = shuffleIndices(addedOrder.length).map((index) => addedOrder[index]);
        }

        const next: QueueState = {
            ...current,
            tracks,
            order: [...current.order, ...addedOrder],
        };
        commitQueue(next);
        return next;
    }, [commitQueue]);

    const fillRadioQueue = useCallback(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
            const initial = queueRef.current;
            if (!initial || initial.mode !== 'radio' || radioExhaustedRef.current) {
                return;
            }
            if (initial.order.length - initial.cursor - 1 >= 10) {
                return;
            }
            if (fillingRadioPromiseRef.current) {
                await fillingRadioPromiseRef.current;
                continue;
            }

            fillingRadioRef.current = true;
            const run = (async () => {
                try {
                    for (let round = 0; round < 3; round++) {
                        const current = queueRef.current;
                        if (!current || current.mode !== 'radio') {
                            return;
                        }
                        const upcoming = current.order.length - current.cursor - 1;
                        if (upcoming >= 10) {
                            return;
                        }

                        const exclude = current.tracks
                            .map((item) => item.songId)
                            .filter((id): id is string => Boolean(id));
                        const seed =
                            current.tracks[current.order[current.cursor]]?.songId ??
                            current.tracks[0]?.songId ??
                            undefined;
                        const { data } = await api.get<{ data: Song[] }>('/radio/queue', {
                            params: {
                                seed_song_id: seed,
                                exclude,
                                limit: 10 - upcoming,
                            },
                            skipErrorToast: true,
                        });
                        const playable = (data.data ?? [])
                            .map((song) => songToPlayerTrack(song, userRef.current))
                            .filter((item): item is PlayerTrack => Boolean(item?.uri));
                        const next = appendRadioTracks(playable);
                        if (!next || next.tracks.length === current.tracks.length) {
                            radioExhaustedRef.current = true;
                            return;
                        }
                    }
                } catch {
                    radioExhaustedRef.current = true;
                } finally {
                    fillingRadioRef.current = false;
                    fillingRadioPromiseRef.current = null;
                }
            })();
            fillingRadioPromiseRef.current = run;
            await run;
            return;
        }
    }, [appendRadioTracks]);

    const playTrack = useCallback(
        async (next: PlayerTrack, options?: { radio?: boolean }) => {
            const useRadio = options?.radio !== false;
            if (!useRadio) {
                radioExhaustedRef.current = false;
                commitQueue(null);
                await playTrackInternal(next);
                return;
            }

            const seed = normalizeTrack(next);
            const radioQueue: QueueState = {
                playlistId: null,
                mode: 'radio',
                tracks: [seed],
                order: [0],
                cursor: 0,
            };
            radioExhaustedRef.current = false;
            commitQueue(radioQueue);
            await playTrackInternal(seed);
            void fillRadioQueue();
        },
        [playTrackInternal, fillRadioQueue, commitQueue],
    );

    useEffect(() => {
        if (!queue || queue.mode !== 'radio') {
            return;
        }
        if (queue.order.length - queue.cursor - 1 >= 10) {
            return;
        }
        void fillRadioQueue();
    }, [queue, fillRadioQueue]);

    const playPlaylist = useCallback(
        async (
            tracks: PlayerTrack[],
            options?: { playlistId?: string; startIndex?: number; shuffle?: boolean },
        ) => {
            const playable = tracks.filter((t) => Boolean(t.uri)).map(normalizeTrack);
            if (playable.length === 0) {
                setError(t('player.noPlayablePlaylist'));
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
                mode: 'playlist',
                tracks: playable,
                order,
                cursor,
            };

            await playAtCursor(nextQueue);
        },
        [playAtCursor, setError, t],
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

    const playNext = useCallback(async (options?: { ignoreLock?: boolean }) => {
        if (controlsLocked && !options?.ignoreLock) {
            return;
        }
        const currentQueue = queueRef.current;
        if (!currentQueue || currentQueue.tracks.length === 0) {
            return;
        }

        if (currentQueue.cursor < currentQueue.order.length - 1) {
            await playAtCursor({ ...currentQueue, cursor: currentQueue.cursor + 1 });
            if (currentQueue.mode === 'radio') {
                void fillRadioQueue();
            }
            return;
        }

        if (currentQueue.mode === 'radio') {
            await fillRadioQueue();
            const updated = queueRef.current;
            if (updated && updated.mode === 'radio' && updated.cursor < updated.order.length - 1) {
                await playAtCursor({ ...updated, cursor: updated.cursor + 1 });
                void fillRadioQueue();
                return;
            }
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
            return;
        }

        if (shuffleRef.current) {
            const latest = queueRef.current ?? currentQueue;
            const order = shuffleIndices(latest.tracks.length);
            await playAtCursor({ ...latest, order, cursor: 0 });
            return;
        }

        const latest = queueRef.current ?? currentQueue;
        await playAtCursor({ ...latest, cursor: 0 });
    }, [playAtCursor, controlsLocked, fillRadioQueue]);

    const playQueueCursor = useCallback(
        async (cursor: number) => {
            if (controlsLocked) {
                return;
            }
            const current = queueRef.current;
            if (!current || cursor < 0 || cursor >= current.order.length) {
                return;
            }
            await playAtCursor({ ...current, cursor });
            if (current.mode === 'radio') {
                void fillRadioQueue();
            }
        },
        [playAtCursor, controlsLocked, fillRadioQueue],
    );

    const removeUpcoming = useCallback((orderIndex: number) => {
        const current = queueRef.current;
        if (!current || current.mode !== 'radio') {
            return;
        }
        if (orderIndex <= current.cursor || orderIndex >= current.order.length) {
            return;
        }
        const next: QueueState = {
            ...current,
            order: current.order.filter((_, index) => index !== orderIndex),
        };
        commitQueue(next);
        radioExhaustedRef.current = false;
        void fillRadioQueue();
    }, [fillRadioQueue, commitQueue]);

    const syncPlaylistQueue = useCallback(
        (playlistId: string, tracks: PlayerTrack[]) => {
            const current = queueRef.current;
            if (!current || current.playlistId !== playlistId) {
                return;
            }

            const playable = tracks.filter((t) => Boolean(t.uri)).map(normalizeTrack);
            if (playable.length === 0) {
                commitQueue(null);
                return;
            }

            const rebuilt = rebuildOrderKeepingCurrent(playable, trackRef.current, shuffleRef.current);
            const nextQueue: QueueState = {
                playlistId,
                mode: 'playlist',
                tracks: playable,
                order: rebuilt.order,
                cursor: rebuilt.cursor,
            };
            commitQueue(nextQueue);
        },
        [rebuildOrderKeepingCurrent, commitQueue],
    );

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
                    const { data } = await api.get<{ data: Song }>(`/songs/${current.songId}`, {
                        skipErrorToast: true,
                    });
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
                setError(t('player.noProviderLink', { provider: providerLabel(provider) }));
                return;
            }

            if (!isPlaybackProviderConnected(userRef.current, provider)) {
                setError(t('player.providerInactive', { provider: providerLabel(provider) }));
                return;
            }

            if (current.songId) {
                rememberSongPlaybackProvider(current.songId, provider);
            }

            await playTrackInternal(next, { startPositionMs: positionMsRef.current });
        },
        [controlsLocked, playTrackInternal, setError, t],
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
                artists: resolved.artists ?? prev.artists,
                artist: resolved.artist || prev.artist,
                durationMs: resolved.durationMs ?? prev.durationMs,
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

            await enqueuePlayback(async () => {
                await claimPlaybackOwner(provider);

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
                userPausedRef.current = false;
                providerPausedAtRef.current = null;
                armPlaybackClock(track.uri, resumeAt > 0 ? resumeAt : statePosition);
                setPlaying(true);
                positionAnchorRef.current = {
                    position: resumeAt > 0 ? resumeAt : positionAnchorRef.current.position || statePosition,
                    at: Date.now(),
                    playing: true,
                };
            });
            return;
        }

        if (playing) {
            await enqueuePlayback(async () => {
                await provider.pause();
                const pausedAt = positionMsRef.current || positionMs;
                userPausedRef.current = true;
                providerPausedAtRef.current = null;
                if (track) {
                    armPlaybackClock(track.uri, pausedAt);
                }
                setPlaying(false);
                positionAnchorRef.current = {
                    position: pausedAt,
                    at: Date.now(),
                    playing: false,
                };
                setPositionMs(pausedAt);
            });
        }
    }, [playing, track, playTrackInternal, positionMs, controlsLocked, armPlaybackClock, enqueuePlayback, claimPlaybackOwner]);

    const seek = useCallback(async (nextPositionMs: number) => {
        if (controlsLocked) {
            return;
        }
        const clamped = Math.max(0, Math.min(nextPositionMs, durationMs || nextPositionMs));
        await providerRef.current?.seek(clamped);
        const uri = trackRef.current?.uri;
        if (uri && !userPausedRef.current) {
            providerPausedAtRef.current = null;
            armPlaybackClock(uri, clamped);
        } else if (uri) {
            armPlaybackClock(uri, clamped);
        }
        maxPositionRef.current = clamped;
        positionAnchorRef.current = {
            position: clamped,
            at: Date.now(),
            playing: positionAnchorRef.current.playing,
        };
        setPositionMs(clamped);
    }, [durationMs, controlsLocked, armPlaybackClock]);

    const finishCurrentTrack = useCallback(async () => {
        if (advancingRef.current || syncingRemoteRef.current) {
            return;
        }
        if (userPausedRef.current) {
            return;
        }
        if (Date.now() < ignoreEndedUntilRef.current) {
            return;
        }
        advancingRef.current = true;

        const endingUri = trackRef.current?.uri ?? null;
        const epochAtStart = playbackEpochRef.current;
        const stillSameTrack = () =>
            playbackEpochRef.current === epochAtStart &&
            (!endingUri || trackRef.current?.uri === endingUri);

        try {
            void flushPlayProgress({ clear: true, completed: true });

            const endedTrack = trackRef.current;
            if (endedTrack) {
                for (const listener of [...trackEndedListenersRef.current]) {
                    try {
                        listener(endedTrack);
                    } catch {
                        // ignore
                    }
                }
            }

            if (onTrackEndedRef.current) {
                onTrackEndedRef.current();
                return;
            }

            if (repeatOneRef.current) {
                maxPositionRef.current = 0;
                ignoreEndedUntilRef.current = Date.now() + 2000;
                await seek(0);
                await providerRef.current?.resume();
                userPausedRef.current = false;
                providerPausedAtRef.current = null;
                if (trackRef.current) {
                    armPlaybackClock(trackRef.current.uri, 0);
                }
                setPlaying(true);
                positionAnchorRef.current = { position: 0, at: Date.now(), playing: true };
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
                                duration_ms:
                                    durationMsRef.current > 0 ? Math.floor(durationMsRef.current) : undefined,
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
                                durationMs: durationMsRef.current > 0 ? durationMsRef.current : 0,
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
                return;
            }

            if (!stillSameTrack()) {
                return;
            }

            if (queueRef.current) {
                await playNext({ ignoreLock: true });
                return;
            }

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
        } finally {
            window.setTimeout(() => {
                if (playbackEpochRef.current === epochAtStart) {
                    advancingRef.current = false;
                }
            }, 800);
        }
    }, [flushPlayProgress, playNext, seek, armPlaybackClock]);

    finishCurrentTrackRef.current = finishCurrentTrack;

    const syncFromRemote = useCallback(
        async (payload: {
            provider?: string | null;
            uri: string | null;
            title?: string | null;
            artist?: string | null;
            albumArtUrl?: string | null;
            songId?: string | null;
            positionMs: number;
            isPlaying: boolean;
        }) => {
            const provider = providerRef.current;

            if (!payload.uri) {
                await silenceAllProviders(providersRef.current);
                setPlaying(false);
                setPositionMs(0);
                positionAnchorRef.current = { position: 0, at: Date.now(), playing: false };
                return;
            }

            const nextTrack: PlayerTrack = {
                provider: (payload.provider as PlayerTrack['provider']) || track?.provider || 'spotify',
                trackId: payload.uri.split(':').pop() || '',
                uri: payload.uri,
                title: payload.title || track?.title || t('player.fallbackTrack'),
                artist: payload.artist || track?.artist || '',
                artists: track?.songId && payload.songId === track.songId ? track.artists : undefined,
                albumArtUrl: payload.albumArtUrl ?? track?.albumArtUrl ?? null,
                songId: payload.songId ?? track?.songId,
                durationMs:
                    track?.songId && payload.songId === track.songId ? track.durationMs : undefined,
            };

            const targetPos = Math.max(0, Math.floor(payload.positionMs));
            const uriChanged = track?.uri !== payload.uri;
            const drift = Math.abs(positionMsRef.current - targetPos);

            syncingRemoteRef.current = true;
            try {
                if (uriChanged || (payload.isPlaying && !playing)) {
                    commitQueue(null);
                    await playTrackInternal(nextTrack, { startPositionMs: targetPos });
                    if (!payload.isPlaying) {
                        await providerRef.current?.pause();
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
        [playTrackInternal, playing, track, t, commitQueue],
    );

    const setOnTrackEnded = useCallback((handler: (() => void) | null) => {
        onTrackEndedRef.current = handler;
    }, []);

    const subscribeTrackEnded = useCallback((handler: (ended: PlayerTrack) => void) => {
        trackEndedListenersRef.current.add(handler);
        return () => {
            trackEndedListenersRef.current.delete(handler);
        };
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

            const current = queueRef.current;
            if (current && current.tracks.length > 0) {
                const rebuilt = rebuildOrderKeepingCurrent(current.tracks, trackRef.current, next);
                commitQueue({ ...current, ...rebuilt });
            }

            return next;
        });
    }, [rebuildOrderKeepingCurrent, commitQueue]);

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
        trackRef.current = session.track;
        commitQueue(session.queue);
        setPositionMs(session.positionMs);
        setDurationMs(session.durationMs);
        setPlaying(false);
        positionAnchorRef.current = {
            position: session.positionMs,
            at: Date.now(),
            playing: false,
        };
        if (session.queue?.mode === 'radio') {
            radioExhaustedRef.current = false;
            void fillRadioQueue();
        }
    }, [ready, musicConnected, fillRadioQueue, commitQueue]);

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
                        duration_ms: active.durationMs > 0 ? Math.floor(active.durationMs) : undefined,
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
        const timer = window.setInterval(() => {
            if (userPausedRef.current || advancingRef.current || syncingRemoteRef.current) {
                return;
            }
            if (Date.now() < ignoreEndedUntilRef.current) {
                return;
            }
            if (!trackRef.current) {
                return;
            }

            const duration = durationMsRef.current;
            if (duration < 1000) {
                return;
            }

            const estimated = estimatedPositionMs();
            maxPositionRef.current = Math.max(maxPositionRef.current, estimated, positionMsRef.current);

            if (
                liveDurationRef.current &&
                providerPausedAtRef.current == null &&
                estimated >= duration - 250
            ) {
                void finishCurrentTrackRef.current();
                return;
            }

            const pausedAt = providerPausedAtRef.current;
            if (pausedAt && Date.now() - pausedAt >= 900) {
                if (
                    looksLikeNaturalEnd({
                        paused: true,
                        position: lastAppliedStateRef.current?.position ?? 0,
                        duration,
                        maxPosition: maxPositionRef.current,
                    })
                ) {
                    void finishCurrentTrackRef.current();
                }
            }
        }, 250);

        return () => window.clearInterval(timer);
    }, [estimatedPositionMs]);

    const canPrev = Boolean(queue && queue.tracks.length > 0) && !controlsLocked;
    const canNext = Boolean(queue && queue.tracks.length > 0) && !controlsLocked;

    const clearPlayback = useCallback(async () => {
        await enqueuePlayback(async () => {
            playbackEpochRef.current += 1;
            await flushPlayProgress({ clear: true });
            await silenceAllProviders(providersRef.current);
            setPlaying(false);
            setTrack(null);
            commitQueue(null);
            setPositionMs(0);
            setDurationMs(0);
            setError(null);
            positionAnchorRef.current = { position: 0, at: Date.now(), playing: false };
            activePlayRef.current = null;
            playListenAnchorRef.current = null;
            lastAppliedStateRef.current = null;
            userPausedRef.current = false;
            providerPausedAtRef.current = null;
            playbackClockRef.current = null;
            maxPositionRef.current = 0;
            try {
                localStorage.removeItem(SESSION_STORAGE_KEY);
            } catch {
                // ignore
            }
        });
    }, [flushPlayProgress, commitQueue, enqueuePlayback]);

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
            playQueueCursor,
            removeUpcoming,
            syncPlaylistQueue,
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
            subscribeTrackEnded,
            clearPlayback,
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
            playQueueCursor,
            removeUpcoming,
            syncPlaylistQueue,
            switchProvider,
            attachSongProviders,
            toggle,
            setVolume,
            seek,
            toggleShuffle,
            toggleRepeatOne,
            syncFromRemote,
            setOnTrackEnded,
            subscribeTrackEnded,
            clearPlayback,
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
