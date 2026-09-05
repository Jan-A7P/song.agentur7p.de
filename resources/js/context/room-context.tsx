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
import api from '@/lib/api';
import { getEcho } from '@/lib/echo';
import { useAuth } from '@/context/auth-context';
import { usePlayer } from '@/context/player-context';
import type { ListeningRoom, RoomMessage, RoomPlaybackState, RoomQueueItem, RoomReaction } from '@/types';
import { t } from '@/i18n';

type PresenceUser = {
    id: string;
    name: string;
    role?: string;
};

type RoomContextValue = {
    room: ListeningRoom | null;
    messages: RoomMessage[];
    reactions: RoomReaction[];
    listeners: PresenceUser[];
    loading: boolean;
    error: string | null;
    join: (code: string) => Promise<ListeningRoom>;
    create: (name: string) => Promise<ListeningRoom>;
    leave: () => Promise<void>;
    close: () => Promise<void>;
    refresh: () => Promise<void>;
    sendPlayback: (action: string, payload?: Record<string, unknown>) => Promise<void>;
    addQueueSong: (payload: Record<string, unknown>) => Promise<void>;
    removeQueueItem: (itemId: string) => Promise<void>;
    voteQueueItem: (itemId: string) => Promise<void>;
    sendMessage: (body: string) => Promise<void>;
    sendReaction: (emoji: string) => Promise<void>;
    setMemberRole: (userId: string, role: 'moderator' | 'member') => Promise<void>;
};

const RoomContext = createContext<RoomContextValue | undefined>(undefined);

export function RoomProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const {
        positionMs,
        playing,
        ready,
        syncFromRemote,
        setControlsLocked,
        setOnTrackEnded,
    } = usePlayer();

    const [room, setRoom] = useState<ListeningRoom | null>(null);
    const [messages, setMessages] = useState<RoomMessage[]>([]);
    const [reactions, setReactions] = useState<RoomReaction[]>([]);
    const [listeners, setListeners] = useState<PresenceUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const roomRef = useRef<ListeningRoom | null>(null);
    const channelCodeRef = useRef<string | null>(null);
    const reactionTimersRef = useRef<Map<string, number>>(new Map());
    const userRef = useRef(user);

    useEffect(() => {
        roomRef.current = room;
    }, [room]);

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    const clearReactionTimers = useCallback(() => {
        reactionTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        reactionTimersRef.current.clear();
    }, []);

    const scheduleReactionExpiry = useCallback((emoji: string) => {
        const existing = reactionTimersRef.current.get(emoji);
        if (existing) {
            window.clearTimeout(existing);
        }
        const timer = window.setTimeout(() => {
            reactionTimersRef.current.delete(emoji);
            setReactions((prev) => prev.filter((r) => r.emoji !== emoji));
        }, 10000);
        reactionTimersRef.current.set(emoji, timer);
    }, []);

    const pushReaction = useCallback(
        (incoming: { id: string; emoji: string; created_at?: string; user: { id: string; name: string } }) => {
            setReactions((prev) => {
                const index = prev.findIndex((r) => r.emoji === incoming.emoji);
                if (index === -1) {
                    return [
                        ...prev,
                        {
                            id: incoming.id,
                            emoji: incoming.emoji,
                            count: 1,
                            created_at: incoming.created_at ?? new Date().toISOString(),
                            user: incoming.user,
                            recent_users: [incoming.user.name],
                        },
                    ];
                }

                return prev.map((reaction, i) => {
                    if (i !== index) {
                        return reaction;
                    }
                    const recent = [
                        incoming.user.name,
                        ...reaction.recent_users.filter((name) => name !== incoming.user.name),
                    ].slice(0, 5);
                    return {
                        ...reaction,
                        id: incoming.id,
                        count: reaction.count + 1,
                        user: incoming.user,
                        recent_users: recent,
                        created_at: incoming.created_at ?? reaction.created_at,
                    };
                });
            });
            scheduleReactionExpiry(incoming.emoji);
        },
        [scheduleReactionExpiry],
    );

    const applyState = useCallback(
        async (state: RoomPlaybackState) => {
            await syncFromRemote({
                provider: state.provider,
                uri: state.track_uri,
                title: state.track_title,
                artist: state.track_artist,
                albumArtUrl: state.album_art_url,
                songId: state.current_song_id,
                positionMs: state.position_ms,
                isPlaying: state.is_playing,
            });
        },
        [syncFromRemote],
    );

    const detachChannel = useCallback(() => {
        const code = channelCodeRef.current;
        if (!code) {
            return;
        }
        try {
            getEcho().leave(`listening-room.${code}`);
        } catch {
            // ignore
        }
        channelCodeRef.current = null;
        setListeners([]);
        clearReactionTimers();
        setReactions([]);
    }, [clearReactionTimers]);

    const attachChannel = useCallback(
        (code: string) => {
            detachChannel();
            channelCodeRef.current = code;
            const channel = getEcho().join(`listening-room.${code}`);

            channel
                .here((users: PresenceUser[]) => setListeners(users))
                .joining((userJoin: PresenceUser) =>
                    setListeners((prev) => (prev.some((u) => u.id === userJoin.id) ? prev : [...prev, userJoin])),
                )
                .leaving((userLeave: PresenceUser) =>
                    setListeners((prev) => prev.filter((u) => u.id !== userLeave.id)),
                )
                .listen('.room.state', (payload: { state: RoomPlaybackState }) => {
                    setRoom((prev) => (prev ? { ...prev, state: payload.state } : prev));
                    void applyState(payload.state);
                })
                .listen('.queue.updated', (payload: { queue: RoomQueueItem[] }) => {
                    setRoom((prev) => (prev ? { ...prev, queue: payload.queue } : prev));
                })
                .listen('.message.created', (payload: { message: RoomMessage }) => {
                    setMessages((prev) => [...prev.filter((m) => m.id !== payload.message.id), payload.message]);
                })
                .listen('.reaction.created', (payload: { reaction: RoomReaction }) => {
                    // Sender already stacked optimistically — only refresh TTL.
                    if (payload.reaction.user.id === userRef.current?.id) {
                        scheduleReactionExpiry(payload.reaction.emoji);
                        return;
                    }
                    pushReaction(payload.reaction);
                });
        },
        [applyState, detachChannel, pushReaction, scheduleReactionExpiry],
    );

    const hydrate = useCallback(
        async (data: ListeningRoom) => {
            setRoom(data);
            setControlsLocked(!data.can_control);
            await applyState(data.state);
            attachChannel(data.code);

            try {
                const { data: msgData } = await api.get<{ data: RoomMessage[] }>(`/rooms/${data.code}/messages`);
                setMessages(msgData.data);
            } catch {
                setMessages([]);
            }
        },
        [applyState, attachChannel, setControlsLocked],
    );

    const create = useCallback(
        async (name: string) => {
            setLoading(true);
            setError(null);
            try {
                const { data } = await api.post<{ data: ListeningRoom }>('/rooms', { name });
                await hydrate(data.data);
                return data.data;
            } catch (err: unknown) {
                const axiosErr = err as { response?: { data?: { message?: string } } };
                setError(axiosErr.response?.data?.message ?? t('rooms.createFailed'));
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [hydrate],
    );

    const join = useCallback(
        async (code: string) => {
            setLoading(true);
            setError(null);
            try {
                const { data } = await api.post<{ data: ListeningRoom }>(`/rooms/${code}/join`);
                await hydrate(data.data);
                return data.data;
            } catch (err: unknown) {
                const axiosErr = err as { response?: { data?: { message?: string } } };
                setError(axiosErr.response?.data?.message ?? t('rooms.joinFailed'));
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [hydrate],
    );

    const refresh = useCallback(async () => {
        const current = roomRef.current;
        if (!current) {
            return;
        }
        const { data } = await api.get<{ data: ListeningRoom }>(`/rooms/${current.code}`);
        setRoom(data.data);
        setControlsLocked(!data.data.can_control);
        await applyState(data.data.state);
    }, [applyState, setControlsLocked]);

    const leave = useCallback(async () => {
        const current = roomRef.current;
        if (!current) {
            return;
        }
        await api.post(`/rooms/${current.code}/leave`);
        detachChannel();
        setRoom(null);
        setMessages([]);
        setReactions([]);
        setControlsLocked(false);
        setOnTrackEnded(null);
    }, [detachChannel, setControlsLocked, setOnTrackEnded]);

    const close = useCallback(async () => {
        const current = roomRef.current;
        if (!current) {
            return;
        }
        await api.post(`/rooms/${current.code}/close`);
        await leave();
    }, [leave]);

    const sendPlayback = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
        const current = roomRef.current;
        if (!current?.can_control) {
            return;
        }
        try {
            const { data } = await api.post<{ data: ListeningRoom }>(`/rooms/${current.code}/playback`, {
                action,
                ...payload,
            });
            setRoom(data.data);
            setControlsLocked(!data.data.can_control);

            // Heartbeat only syncs position on the server — applying it locally can
            // restart playback after pause if a request was already in flight.
            const isPositionHeartbeat = action === 'heartbeat' && !payload.ended;
            if (!isPositionHeartbeat) {
                await applyState(data.data.state);
            }
        } catch (err: unknown) {
            const axiosErr = err as { response?: { status?: number; data?: { message?: string } } };
            if (axiosErr.response?.status === 403) {
                setRoom((prev) => (prev ? { ...prev, can_control: false } : prev));
                setControlsLocked(true);
            }
            setError(axiosErr.response?.data?.message ?? t('rooms.syncFailed'));
        }
    }, [applyState, setControlsLocked]);

    const addQueueSong = useCallback(
        async (payload: Record<string, unknown>) => {
            const current = roomRef.current;
            if (!current) {
                return;
            }
            const { data } = await api.post<{ data: ListeningRoom }>(`/rooms/${current.code}/queue`, payload);
            setRoom(data.data);
            setControlsLocked(!data.data.can_control);
            await applyState(data.data.state);
        },
        [applyState, setControlsLocked],
    );

    const removeQueueItem = useCallback(
        async (itemId: string) => {
            const current = roomRef.current;
            if (!current) {
                return;
            }
            const { data } = await api.delete<{ data: ListeningRoom }>(`/rooms/${current.code}/queue/${itemId}`);
            setRoom(data.data);
            await applyState(data.data.state);
        },
        [applyState],
    );

    const voteQueueItem = useCallback(async (itemId: string) => {
        const current = roomRef.current;
        if (!current) {
            return;
        }
        const { data } = await api.post<{ queue: RoomQueueItem[] }>(`/rooms/${current.code}/queue/${itemId}/vote`);
        setRoom((prev) => (prev ? { ...prev, queue: data.queue } : prev));
    }, []);

    const sendMessage = useCallback(async (body: string) => {
        const current = roomRef.current;
        if (!current) {
            return;
        }
        await api.post(`/rooms/${current.code}/messages`, { body });
    }, []);

    const sendReaction = useCallback(
        async (emoji: string) => {
            const current = roomRef.current;
            if (!current || !user) {
                return;
            }
            // Optimistic stack so the sender sees the count immediately
            pushReaction({
                id: crypto.randomUUID(),
                emoji,
                user: { id: user.id, name: user.name },
            });
            try {
                await api.post(`/rooms/${current.code}/reactions`, { emoji });
            } catch {
                // keep optimistic UI; realtime peers still get the echo event if it succeeded
            }
        },
        [pushReaction, user],
    );

    const setMemberRole = useCallback(
        async (userId: string, role: 'moderator' | 'member') => {
            const current = roomRef.current;
            if (!current) {
                return;
            }
            await api.post(`/rooms/${current.code}/members/${userId}/role`, { role });
            await refresh();
        },
        [refresh],
    );

    // Host heartbeat + track ended
    const positionMsRef = useRef(positionMs);
    useEffect(() => {
        positionMsRef.current = positionMs;
    }, [positionMs]);

    useEffect(() => {
        if (!room?.can_control) {
            setOnTrackEnded(null);
            return;
        }

        setOnTrackEnded(() => {
            void sendPlayback('heartbeat', { position_ms: positionMsRef.current, ended: true });
        });

        if (!room.state.is_playing || !room.state.track_uri || !ready) {
            return () => {
                setOnTrackEnded(null);
            };
        }

        const timer = window.setInterval(() => {
            if (!roomRef.current?.state.is_playing || !roomRef.current.state.track_uri) {
                return;
            }
            void sendPlayback('heartbeat', { position_ms: positionMsRef.current, ended: false });
        }, 5000);

        return () => {
            window.clearInterval(timer);
            setOnTrackEnded(null);
        };
    }, [room?.can_control, room?.state.is_playing, room?.state.track_uri, ready, sendPlayback, setOnTrackEnded]);

    // Retry room sync once the music provider player is ready
    useEffect(() => {
        if (!ready || !room?.state.track_uri) {
            return;
        }
        void applyState(room.state);
        // Only when the player becomes ready — room.state updates are handled elsewhere.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);

    useEffect(() => {
        if (!user) {
            detachChannel();
            setRoom(null);
            setControlsLocked(false);
            setOnTrackEnded(null);
        }
    }, [user, detachChannel, setControlsLocked, setOnTrackEnded]);

    const value = useMemo(
        () => ({
            room,
            messages,
            reactions,
            listeners,
            loading,
            error,
            join,
            create,
            leave,
            close,
            refresh,
            sendPlayback,
            addQueueSong,
            removeQueueItem,
            voteQueueItem,
            sendMessage,
            sendReaction,
            setMemberRole,
        }),
        [
            room,
            messages,
            reactions,
            listeners,
            loading,
            error,
            join,
            create,
            leave,
            close,
            refresh,
            sendPlayback,
            addQueueSong,
            removeQueueItem,
            voteQueueItem,
            sendMessage,
            sendReaction,
            setMemberRole,
        ],
    );

    return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
    const ctx = useContext(RoomContext);
    if (!ctx) {
        throw new Error('useRoom must be used within RoomProvider');
    }
    return ctx;
}
