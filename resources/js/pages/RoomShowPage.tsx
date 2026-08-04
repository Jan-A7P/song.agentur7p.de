import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    Check,
    Copy,
    Crown,
    LogOut,
    Pause,
    Play,
    SkipForward,
    ThumbsUp,
    Trash2,
    Users,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { usePlayer, formatTime } from '@/context/player-context';
import { useRoom } from '@/context/room-context';
import api from '@/lib/api';
import type { Paginated, Song } from '@/types';
import { songIsPlayable } from '@/lib/playable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const REACTION_EMOJIS = ['🔥', '👏', '❤️', '😂', '🎵', '🙌'];

export function RoomShowPage() {
    const { code = '' } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { positionMs, playing, ready } = usePlayer();
    const {
        room,
        messages,
        reactions,
        listeners,
        error,
        join,
        leave,
        close,
        sendPlayback,
        addQueueSong,
        removeQueueItem,
        voteQueueItem,
        sendMessage,
        sendReaction,
        setMemberRole,
    } = useRoom();

    const [bootError, setBootError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [chatBody, setChatBody] = useState('');
    const [songQuery, setSongQuery] = useState('');
    const [songResults, setSongResults] = useState<Song[]>([]);

    useEffect(() => {
        if (!code) {
            return;
        }
        if (room?.code === code.toUpperCase()) {
            return;
        }
        void (async () => {
            try {
                await join(code);
            } catch {
                setBootError('Raum nicht gefunden oder Beitritt fehlgeschlagen.');
            }
        })();
    }, [code, join, room?.code]);

    useEffect(() => {
        if (!songQuery.trim()) {
            setSongResults([]);
            return;
        }
        const timer = window.setTimeout(async () => {
            try {
                const { data } = await api.get<Paginated<Song>>('/songs', { params: { q: songQuery } });
                setSongResults(data.data.filter((s) => songIsPlayable(s)).slice(0, 8));
            } catch {
                setSongResults([]);
            }
        }, 250);
        return () => window.clearTimeout(timer);
    }, [songQuery]);

    if (bootError && !room) {
        return (
            <div className="space-y-4">
                <Alert variant="error">{bootError}</Alert>
                <Button asChild variant="outline">
                    <Link to="/rooms">Zurück</Link>
                </Button>
            </div>
        );
    }

    if (!room) {
        return <p className="text-muted">Raum wird geladen…</p>;
    }

    const canControl = room.can_control;
    const isHost = room.my_role === 'host';

    const copyLink = async () => {
        await navigator.clipboard.writeText(room.join_url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const onToggle = async () => {
        if (!canControl) {
            return;
        }
        await sendPlayback(playing ? 'pause' : 'play', { position_ms: positionMs });
    };

    const onChat = async (event: FormEvent) => {
        event.preventDefault();
        if (!chatBody.trim()) {
            return;
        }
        await sendMessage(chatBody.trim());
        setChatBody('');
    };

    const onLeave = async () => {
        await leave();
        navigate('/rooms');
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-sm text-muted">
                        <Link to="/rooms" className="hover:text-accent">
                            ← Hörräume
                        </Link>
                    </p>
                    <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{room.name}</h1>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                        <span className="font-mono tracking-widest text-ink">{room.code}</span>
                        <Badge>{room.my_role}</Badge>
                        {!ready && <span>Player initialisiert…</span>}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        Link
                    </Button>
                    {isHost && (
                        <Button type="button" variant="destructive" size="sm" onClick={() => void close().then(() => navigate('/rooms'))}>
                            Schließen
                        </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={() => void onLeave()}>
                        <LogOut className="h-4 w-4" />
                        Verlassen
                    </Button>
                </div>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <section className="space-y-4">
                    <div className="rounded-2xl border border-line bg-surface p-5">
                        <div className="flex items-center gap-4">
                            {room.state.album_art_url ? (
                                <img src={room.state.album_art_url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                            ) : (
                                <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-paper-2 text-muted">♪</div>
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-display text-xl font-semibold">
                                    {room.state.track_title || 'Kein Track'}
                                </p>
                                <p className="truncate text-muted">{room.state.track_artist || '—'}</p>
                                <p className="mt-1 text-xs tabular-nums text-muted">{formatTime(positionMs)}</p>
                            </div>
                            {canControl && (
                                <div className="flex gap-2">
                                    <Button type="button" variant="accent" size="icon" onClick={() => void onToggle()}>
                                        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                    </Button>
                                    <Button type="button" variant="outline" size="icon" onClick={() => void sendPlayback('next')}>
                                        <SkipForward className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>
                        {!canControl && (
                            <p className="mt-3 text-xs text-muted">Nur Host/Moderator steuern die Wiedergabe — du hörst synchron mit.</p>
                        )}
                    </div>

                    <div className="rounded-2xl border border-line bg-surface p-4">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h2 className="font-medium">Warteschlange</h2>
                            <span className="text-xs text-muted">{room.queue.filter((q) => q.status === 'queued').length} Songs</span>
                        </div>

                        <div className="mb-3 space-y-2">
                            <Input
                                value={songQuery}
                                onChange={(e) => setSongQuery(e.target.value)}
                                placeholder="Song zur Queue hinzufügen…"
                            />
                            {songResults.length > 0 && (
                                <ul className="max-h-40 overflow-auto rounded-lg border border-line">
                                    {songResults.map((song) => (
                                        <li key={song.id}>
                                            <button
                                                type="button"
                                                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-paper-2"
                                                onClick={() => {
                                                    void addQueueSong({ song_id: song.id });
                                                    setSongQuery('');
                                                    setSongResults([]);
                                                }}
                                            >
                                                <span className="min-w-0 flex-1 truncate text-sm">
                                                    {song.title} · {song.artist}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <ul className="space-y-2">
                            {room.queue
                                .filter((item) => item.status === 'queued' || item.status === 'playing')
                                .map((item) => {
                                    const voted = user ? item.voted_user_ids.includes(user.id) : false;
                                    return (
                                        <li
                                            key={item.id}
                                            className={cn(
                                                'flex items-center gap-2 rounded-xl px-2 py-2',
                                                item.status === 'playing' ? 'bg-accent/10' : 'bg-paper/40',
                                            )}
                                        >
                                            {item.album_art_url ? (
                                                <img src={item.album_art_url} alt="" className="h-10 w-10 rounded object-cover" />
                                            ) : (
                                                <div className="h-10 w-10 rounded bg-paper-2" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">{item.title}</p>
                                                <p className="truncate text-xs text-muted">{item.artist}</p>
                                            </div>
                                            {item.status === 'queued' && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={voted ? 'accent' : 'outline'}
                                                    className="h-8"
                                                    onClick={() => void voteQueueItem(item.id)}
                                                >
                                                    <ThumbsUp className="h-3.5 w-3.5" />
                                                    {item.votes_count}
                                                </Button>
                                            )}
                                            {(canControl || item.added_by?.id === user?.id) && item.status === 'queued' && (
                                                <Button
                                                    type="button"
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-8 w-8"
                                                    onClick={() => void removeQueueItem(item.id)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </li>
                                    );
                                })}
                            {room.queue.filter((q) => q.status === 'queued' || q.status === 'playing').length === 0 && (
                                <p className="text-sm text-muted">Queue ist leer — Songs hinzufügen.</p>
                            )}
                        </ul>
                    </div>
                </section>

                <section className="space-y-4">
                    <div className="rounded-2xl border border-line bg-surface p-4">
                        <h2 className="mb-3 flex items-center gap-2 font-medium">
                            <Users className="h-4 w-4" />
                            Zuhören ({listeners.length || room.members.length})
                        </h2>
                        <ul className="space-y-2">
                            {(listeners.length > 0
                                ? listeners.map((l) => ({
                                      id: l.id,
                                      name: l.name,
                                      role: room.members.find((m) => m.user?.id === l.id)?.role ?? l.role ?? 'member',
                                  }))
                                : room.members.map((m) => ({
                                      id: m.user?.id ?? m.id,
                                      name: m.user?.name ?? 'User',
                                      role: m.role,
                                  }))
                            ).map((person) => (
                                <li key={person.id} className="flex items-center justify-between gap-2 text-sm">
                                    <span className="flex items-center gap-2 truncate">
                                        {person.role === 'host' && <Crown className="h-3.5 w-3.5 text-accent" />}
                                        {person.name}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Badge className="capitalize">{person.role}</Badge>
                                        {isHost && person.role !== 'host' && person.id !== user?.id && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="h-7 px-2 text-xs"
                                                onClick={() =>
                                                    void setMemberRole(
                                                        person.id,
                                                        person.role === 'moderator' ? 'member' : 'moderator',
                                                    )
                                                }
                                            >
                                                {person.role === 'moderator' ? 'Mod −' : 'Mod +'}
                                            </Button>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="rounded-2xl border border-line bg-surface p-4">
                        <div className="mb-3 flex flex-wrap gap-2">
                            {REACTION_EMOJIS.map((emoji) => (
                                <button
                                    key={emoji}
                                    type="button"
                                    className="rounded-lg bg-paper-2 px-2 py-1 text-lg transition hover:bg-accent/20"
                                    onClick={() => void sendReaction(emoji)}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                        <div className="mb-3 flex min-h-[2rem] flex-wrap gap-2">
                            {reactions.map((reaction) => (
                                <span
                                    key={reaction.emoji}
                                    className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-sm tabular-nums"
                                    title={reaction.recent_users.join(', ')}
                                >
                                    <span className="text-base leading-none">{reaction.emoji}</span>
                                    {reaction.count > 1 ? (
                                        <span className="font-semibold text-ink">×{reaction.count}</span>
                                    ) : (
                                        <span className="text-muted">{reaction.user.name}</span>
                                    )}
                                </span>
                            ))}
                        </div>

                        <div className="mb-3 max-h-56 space-y-2 overflow-y-auto">
                            {messages.map((message) => (
                                <div key={message.id} className="text-sm">
                                    <span className="font-medium">{message.user.name}: </span>
                                    <span className="text-ink/90">{message.body}</span>
                                </div>
                            ))}
                            {messages.length === 0 && <p className="text-sm text-muted">Noch keine Nachrichten.</p>}
                        </div>

                        <form onSubmit={onChat} className="flex gap-2">
                            <Input
                                value={chatBody}
                                onChange={(e) => setChatBody(e.target.value)}
                                placeholder="Nachricht…"
                                maxLength={500}
                            />
                            <Button type="submit" disabled={!chatBody.trim()}>
                                Senden
                            </Button>
                        </form>
                    </div>
                </section>
            </div>
        </div>
    );
}
