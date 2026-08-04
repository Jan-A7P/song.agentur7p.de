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
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { hasMusicConnected } from '@/lib/music';

declare global {
    interface Window {
        onSpotifyWebPlaybackSDKReady: () => void;
        Spotify: {
            Player: new (options: {
                name: string;
                getOAuthToken: (cb: (token: string) => void) => void;
                volume?: number;
            }) => SpotifyPlayerInstance;
        };
    }
}

type SpotifyPlayerInstance = {
    connect: () => Promise<boolean>;
    disconnect: () => void;
    addListener: (event: string, cb: (payload: any) => void) => boolean;
    removeListener: (event: string, cb?: (payload: any) => void) => boolean;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    togglePlay: () => Promise<void>;
    setVolume: (volume: number) => Promise<void>;
    getVolume: () => Promise<number>;
    seek: (positionMs: number) => Promise<void>;
    getCurrentState: () => Promise<SpotifyPlaybackState | null>;
};

type SpotifyPlaybackState = {
    paused: boolean;
    position: number;
    duration: number;
    track_window: {
        current_track: {
            name: string;
            uri: string;
            artists: { name: string }[];
            album: { images: { url: string }[] };
        } | null;
    };
};

export type PlayerTrack = {
    uri: string;
    title: string;
    artist: string;
    albumArtUrl: string | null;
    songId?: number;
    lyrics?: string | null;
};

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
    toggle: () => Promise<void>;
    setVolume: (volume: number) => Promise<void>;
    seek: (positionMs: number) => Promise<void>;
    toggleShuffle: () => void;
    toggleRepeatOne: () => void;
    setControlsLocked: (locked: boolean) => void;
    syncFromRemote: (payload: {
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
        const parsed = JSON.parse(raw) as StoredSession;
        if (!parsed?.track?.uri) {
            return null;
        }
        return {
            track: parsed.track,
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

function loadSdk(): Promise<void> {
    if (window.Spotify) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const existing = document.getElementById('spotify-player-sdk');
        if (existing) {
            window.onSpotifyWebPlaybackSDKReady = () => resolve();
            return;
        }

        window.onSpotifyWebPlaybackSDKReady = () => resolve();
        const script = document.createElement('script');
        script.id = 'spotify-player-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        script.onerror = () => reject(new Error('Spotify SDK konnte nicht geladen werden.'));
        document.body.appendChild(script);
    });
}

export function PlayerProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const spotifyConnected = hasMusicConnected(user);
    const playerRef = useRef<SpotifyPlayerInstance | null>(null);
    const deviceIdRef = useRef<string | null>(null);
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

    const [track, setTrack] = useState<PlayerTrack | null>(null);
    const [spotifyReady, setSpotifyReady] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [positionMs, setPositionMs] = useState(0);
    const [durationMs, setDurationMs] = useState(0);
    const [volume, setVolumeState] = useState(() => readStoredVolume(VOLUME_STORAGE_KEY, 0.7));
    const [error, setError] = useState<string | null>(null);
    const [queue, setQueue] = useState<QueueState | null>(null);
    const [shuffle, setShuffle] = useState(() => readStoredFlag(SHUFFLE_STORAGE_KEY, false));
    const [repeatOne, setRepeatOne] = useState(() => readStoredFlag(REPEAT_STORAGE_KEY, false));
    const [controlsLocked, setControlsLocked] = useState(false);
    const volumeRef = useRef(volume);

    const ready = spotifyConnected && spotifyReady;

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

    const getToken = useCallback(async () => {
        const { data } = await api.get<{ access_token: string }>('/spotify/token');
        return data.access_token;
    }, []);

    const applyState = useCallback((state: SpotifyPlaybackState | null) => {
        if (!state) {
            return;
        }

        const guard = resumeGuardRef.current;
        const statePosition = state.position;
        if (guard && Date.now() < guard.until && statePosition + 1500 < guard.minPosition) {
            // Ignore transient 0:00 updates right after resume-from-position
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

        const current = state.track_window.current_track;
        if (current) {
            setTrack((prev) => ({
                uri: current.uri,
                title: current.name,
                artist: current.artists.map((a) => a.name).join(', '),
                albumArtUrl: current.album.images[1]?.url ?? current.album.images[0]?.url ?? prev?.albumArtUrl ?? null,
                songId: prev?.uri === current.uri ? prev?.songId : prev?.songId,
                lyrics: prev?.uri === current.uri ? prev?.lyrics : prev?.lyrics,
            }));
        }
    }, []);

    useEffect(() => {
        if (!spotifyConnected) {
            restoredRef.current = false;
            playerRef.current?.disconnect();
            playerRef.current = null;
            deviceIdRef.current = null;
            setSpotifyReady(false);
            setPlaying(false);
            setTrack(null);
            setQueue(null);
            setPositionMs(0);
            setDurationMs(0);
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                await loadSdk();
                if (cancelled || playerRef.current) {
                    return;
                }

                const player = new window.Spotify.Player({
                    name: 'Songtexte Player',
                    getOAuthToken: (cb) => {
                        void getToken()
                            .then((token) => cb(token))
                            .catch(() => setError('Spotify-Token konnte nicht geladen werden.'));
                    },
                    volume: volumeRef.current,
                });

                player.addListener('ready', ({ device_id }: { device_id: string }) => {
                    deviceIdRef.current = device_id;
                    setSpotifyReady(true);
                    setError(null);
                    void player.setVolume(volumeRef.current);
                });

                player.addListener('not_ready', () => {
                    setSpotifyReady(false);
                });

                player.addListener('player_state_changed', (state: SpotifyPlaybackState | null) => {
                    applyState(state);
                });

                player.addListener('initialization_error', ({ message }: { message: string }) => {
                    setError(message);
                });

                player.addListener('authentication_error', ({ message }: { message: string }) => {
                    setError(message || 'Spotify-Auth fehlgeschlagen. Premium erforderlich.');
                });

                player.addListener('account_error', ({ message }: { message: string }) => {
                    setError(message || 'Spotify Premium erforderlich.');
                });

                const connected = await player.connect();
                if (!cancelled && connected) {
                    playerRef.current = player;
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : 'Player-Fehler');
                }
            }
        })();

        return () => {
            cancelled = true;
            playerRef.current?.disconnect();
            playerRef.current = null;
            deviceIdRef.current = null;
            setSpotifyReady(false);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spotifyConnected, getToken, applyState]);

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

    const playSpotifyEngine = useCallback(
        async (next: PlayerTrack, startAt: number) => {
            if (!next.uri.startsWith('spotify:')) {
                throw new Error('Ungültige Spotify-URI.');
            }
            if (!deviceIdRef.current) {
                throw new Error('Spotify Player ist noch nicht bereit.');
            }

            if (startAt > 0) {
                resumeGuardRef.current = {
                    until: Date.now() + 2500,
                    minPosition: startAt,
                };
            } else {
                resumeGuardRef.current = null;
            }

            await api.post('/spotify/play', {
                uri: next.uri,
                device_id: deviceIdRef.current,
                position_ms: startAt > 0 ? startAt : undefined,
            });

            if (startAt > 0 && playerRef.current) {
                await playerRef.current.seek(startAt);
            }
        },
        [],
    );

    const playTrackInternal = useCallback(
        async (next: PlayerTrack, options?: { startPositionMs?: number }) => {
            if (!spotifyConnected) {
                setError('Bitte Spotify in den Einstellungen verbinden.');
                return;
            }

            if (!next.uri.startsWith('spotify:')) {
                setError('Nur Spotify-Tracks können abgespielt werden.');
                return;
            }

            const startAt = Math.max(0, Math.floor(options?.startPositionMs ?? 0));

            setTrack(next);
            setError(null);

            try {
                await playSpotifyEngine(next, startAt);

                setPlaying(true);
                positionAnchorRef.current = { position: startAt, at: Date.now(), playing: true };
                setPositionMs(startAt);
                if (startAt === 0) {
                    setDurationMs(0);
                }
            } catch (err) {
                resumeGuardRef.current = null;
                let message = 'Wiedergabe fehlgeschlagen. Ist Spotify Premium aktiv?';
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
        [spotifyConnected, playSpotifyEngine],
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
            const playable = tracks.filter((t) => Boolean(t.uri));
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

            // When shuffling a full playlist (no specific start song), fully randomize —
            // do not pin track 0 as the first item.
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
            await playerRef.current?.seek(0);
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

        // End of rotation
        if (shuffleRef.current) {
            const order = shuffleIndices(currentQueue.tracks.length);
            await playAtCursor({ ...currentQueue, order, cursor: 0 });
            return;
        }

        await playAtCursor({ ...currentQueue, cursor: 0 });
    }, [playAtCursor, controlsLocked]);

    const toggle = useCallback(async () => {
        if (controlsLocked) {
            return;
        }

        const player = playerRef.current;
        if (!player) {
            return;
        }

        if (!playing && track && deviceIdRef.current) {
            const resumeAt = Math.max(
                0,
                Math.floor(positionMsRef.current || positionAnchorRef.current.position || positionMs || 0),
            );
            const state = await player.getCurrentState();
            const currentUri = state?.track_window.current_track?.uri;
            const statePosition = state?.position ?? 0;

            // After reload Spotify has no active track / wrong position → restart at saved offset.
            if (!state || currentUri !== track.uri || (resumeAt > 1500 && statePosition + 2000 < resumeAt)) {
                await playTrackInternal(track, { startPositionMs: resumeAt });
                return;
            }

            if (resumeAt > 1500 && Math.abs(statePosition - resumeAt) > 1500) {
                resumeGuardRef.current = {
                    until: Date.now() + 2500,
                    minPosition: resumeAt,
                };
                await player.seek(resumeAt);
                positionAnchorRef.current = { position: resumeAt, at: Date.now(), playing: true };
                setPositionMs(resumeAt);
            }

            await player.resume();
            setPlaying(true);
            positionAnchorRef.current = {
                position: resumeAt > 0 ? resumeAt : positionAnchorRef.current.position || statePosition,
                at: Date.now(),
                playing: true,
            };
            return;
        }

        if (playing) {
            await player.pause();
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
        await playerRef.current?.seek(clamped);
        positionAnchorRef.current = {
            position: clamped,
            at: Date.now(),
            playing: positionAnchorRef.current.playing,
        };
        setPositionMs(clamped);
    }, [durationMs, controlsLocked]);

    const syncFromRemote = useCallback(
        async (payload: {
            uri: string | null;
            title?: string | null;
            artist?: string | null;
            albumArtUrl?: string | null;
            songId?: number | null;
            positionMs: number;
            isPlaying: boolean;
        }) => {
            if (!payload.uri) {
                if (playerRef.current && playing) {
                    await playerRef.current.pause();
                }
                setPlaying(false);
                setPositionMs(0);
                positionAnchorRef.current = { position: 0, at: Date.now(), playing: false };
                return;
            }

            const nextTrack: PlayerTrack = {
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
                // Always (re)start via API when URI changes or remote wants play while local is paused.
                // Relying on resume() alone fails if Spotify never received the initial play command.
                if (uriChanged || (payload.isPlaying && !playing)) {
                    setQueue(null);
                    await playTrackInternal(nextTrack, { startPositionMs: targetPos });
                    if (!payload.isPlaying) {
                        await playerRef.current?.pause();
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
                    await playerRef.current?.seek(targetPos);
                    setPositionMs(targetPos);
                    positionAnchorRef.current = {
                        position: targetPos,
                        at: Date.now(),
                        playing: payload.isPlaying,
                    };
                }

                if (!payload.isPlaying && playing) {
                    await playerRef.current?.pause();
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
        await playerRef.current?.setVolume(clamped);
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

    // Restore last session once the player is ready
    useEffect(() => {
        if (!ready || !spotifyConnected || restoredRef.current) {
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
    }, [ready, spotifyConnected]);

    // Persist current session continuously
    useEffect(() => {
        if (!spotifyConnected || !track) {
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
    }, [spotifyConnected, track, queue]);

    // Auto-advance / repeat when track ends
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
            if (onTrackEndedRef.current) {
                onTrackEndedRef.current();
                window.setTimeout(() => {
                    advancingRef.current = false;
                }, 800);
                return;
            }

            if (repeatOneRef.current) {
                await seek(0);
                const player = playerRef.current;
                if (player) {
                    await player.resume();
                }
                setPlaying(true);
                positionAnchorRef.current = { position: 0, at: Date.now(), playing: true };
                advancingRef.current = false;
                return;
            }

            if (queueRef.current) {
                await playNext();
            } else {
                setPlaying(false);
                setPositionMs(0);
                positionAnchorRef.current = { position: 0, at: Date.now(), playing: false };
                const player = playerRef.current;
                if (player) {
                    try {
                        await player.pause();
                        await player.seek(0);
                    } catch {
                        // ignore seek/pause errors at end of track
                    }
                }
            }
            window.setTimeout(() => {
                advancingRef.current = false;
            }, 800);
        })();
    }, [positionMs, durationMs, playing, seek, playNext]);

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
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centiseconds = Math.floor((ms % 1000) / 10);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}
