import { useEffect, useMemo, useState } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, GripVertical, ListPlus, Loader2, Pause, Play, Search, Shuffle, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import type { Paginated, Playlist, Song } from '@/types';
import { useAuth } from '@/context/auth-context';
import { usePlayer, type PlayerTrack } from '@/context/player-context';
import { hasMusicConnected } from '@/lib/music';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

function SortableSongRow({
    song,
    isOwner,
    isPlayingHere,
    onPlay,
    onRemove,
}: {
    song: Song;
    isOwner: boolean;
    isPlayingHere: boolean;
    onPlay: () => void;
    onRemove: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: song.id,
        disabled: !isOwner,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <li
            ref={setNodeRef}
            style={style}
            className={cn(
                'flex items-center gap-2 rounded-xl border border-transparent bg-surface px-2 py-2 sm:gap-3 sm:px-3',
                isDragging && 'z-10 border-line bg-paper shadow-lg',
            )}
        >
            {isOwner && (
                <button
                    type="button"
                    className="cursor-grab touch-none rounded p-1 text-muted hover:bg-paper-2 hover:text-ink active:cursor-grabbing"
                    aria-label="Verschieben"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-4 w-4" />
                </button>
            )}

            {song.album_art_url ? (
                <img src={song.album_art_url} alt="" className="h-11 w-11 rounded object-cover" />
            ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded bg-paper-2 text-xs text-muted">—</div>
            )}

            <Link to={`/songs/${song.id}`} className="min-w-0 flex-1">
                <p className="truncate font-medium hover:text-accent">{song.title}</p>
                <p className="truncate text-sm text-muted">{song.artist}</p>
            </Link>

            {song.provider_uri && (
                <Button type="button" variant="accent" size="icon" onClick={onPlay} aria-label={isPlayingHere ? 'Pause' : 'Play'}>
                    {isPlayingHere ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
            )}

            {isOwner && (
                <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Entfernen">
                    <Trash2 className="h-4 w-4" />
                </Button>
            )}
        </li>
    );
}

function toPlayerTracks(songs: Song[]): PlayerTrack[] {
    return songs
        .filter((song) => Boolean(song.provider_uri && song.provider))
        .map((song) => ({
            provider: song.provider as PlayerTrack['provider'],
            trackId: song.provider_track_id || song.provider_uri!.split(':').pop() || '',
            uri: song.provider_uri as string,
            title: song.title,
            artist: song.artist,
            albumArtUrl: song.album_art_url,
            songId: song.id,
            lyrics: song.lyrics,
        }));
}

export function PlaylistShowPage() {
    const { id } = useParams();
    const location = useLocation();
    const { user } = useAuth();
    const { track, playing, playTrack, playPlaylist, toggle, shuffle } = usePlayer();
    const navigate = useNavigate();
    const [playlist, setPlaylist] = useState<Playlist | null>(null);
    const [songs, setSongs] = useState<Song[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(() => {
        const imported = (location.state as { importedTracks?: number } | null)?.importedTracks;
        return typeof imported === 'number' ? `${imported} Songs importiert.` : null;
    });
    const [savingOrder, setSavingOrder] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [songQuery, setSongQuery] = useState('');
    const [songResults, setSongResults] = useState<Song[]>([]);
    const [searching, setSearching] = useState(false);
    const [addingId, setAddingId] = useState<number | null>(null);
    const [addedIds, setAddedIds] = useState<Set<number>>(() => new Set());

    const isOwner = Boolean(user && playlist && user.id === playlist.user_id);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const loadPlaylist = async () => {
        const { data } = await api.get<{ data: Playlist }>(`/playlists/${id}`);
        setPlaylist(data.data);
        setSongs(data.data.songs ?? []);
    };

    useEffect(() => {
        (async () => {
            try {
                await loadPlaylist();
            } catch {
                setError('Playlist nicht gefunden.');
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        if (!showAdd) {
            return;
        }

        setSongQuery('');
        setAddedIds(new Set());
    }, [showAdd]);

    useEffect(() => {
        if (!showAdd) {
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setSearching(true);
            try {
                const { data } = await api.get<Paginated<Song>>('/songs', {
                    params: songQuery ? { q: songQuery } : undefined,
                    signal: controller.signal,
                });
                const existing = new Set(songs.map((s) => s.id));
                setSongResults(data.data.filter((s) => !existing.has(s.id) && !addedIds.has(s.id)));
            } catch {
                if (!controller.signal.aborted) {
                    setSongResults([]);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setSearching(false);
                }
            }
        }, 200);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [showAdd, songQuery, songs, addedIds]);

    const songIds = useMemo(() => songs.map((song) => song.id), [songs]);

    const persistOrder = async (nextSongs: Song[]) => {
        setSavingOrder(true);
        setError(null);
        try {
            const { data } = await api.put<{ data: Playlist }>(`/playlists/${id}/reorder`, {
                song_ids: nextSongs.map((song) => song.id),
            });
            setPlaylist(data.data);
            setSongs(data.data.songs ?? nextSongs);
        } catch {
            setError('Reihenfolge konnte nicht gespeichert werden.');
            await loadPlaylist();
        } finally {
            setSavingOrder(false);
        }
    };

    const onDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) {
            return;
        }

        const oldIndex = songs.findIndex((song) => song.id === active.id);
        const newIndex = songs.findIndex((song) => song.id === over.id);
        if (oldIndex < 0 || newIndex < 0) {
            return;
        }

        const next = arrayMove(songs, oldIndex, newIndex);
        setSongs(next);
        void persistOrder(next);
    };

    const addSong = async (song: Song) => {
        if (addingId !== null || addedIds.has(song.id)) {
            return;
        }

        setError(null);
        setAddingId(song.id);
        setSongResults((prev) => prev.filter((item) => item.id !== song.id));
        setSongs((prev) => [...prev, song]);
        setAddedIds((prev) => new Set(prev).add(song.id));

        try {
            const { data } = await api.post<{ data: Playlist }>(`/playlists/${id}/songs`, { song_id: song.id });
            setPlaylist(data.data);
            setSongs(data.data.songs ?? []);
        } catch {
            setError('Song konnte nicht hinzugefügt werden.');
            setAddedIds((prev) => {
                const next = new Set(prev);
                next.delete(song.id);
                return next;
            });
            await loadPlaylist();
        } finally {
            setAddingId(null);
        }
    };

    const removeSong = async (songId: number) => {
        setError(null);
        const previous = songs;
        setSongs((prev) => prev.filter((song) => song.id !== songId));
        try {
            const { data } = await api.delete<{ data: Playlist }>(`/playlists/${id}/songs/${songId}`);
            setPlaylist(data.data);
            setSongs(data.data.songs ?? []);
        } catch {
            setError('Song konnte nicht entfernt werden.');
            setSongs(previous);
        }
    };

    const onDelete = async () => {
        if (!playlist || !confirm('Playlist wirklich löschen?')) {
            return;
        }
        try {
            await api.delete(`/playlists/${playlist.id}`);
            navigate('/playlists');
        } catch {
            setError('Löschen fehlgeschlagen.');
        }
    };

    const ensureAuthForPlay = () => {
        if (!user) {
            navigate('/login');
            return false;
        }
        if (!hasMusicConnected(user)) {
            navigate('/settings');
            return false;
        }
        return true;
    };

    const onPlaySong = async (song: Song, index: number) => {
        if (!song.provider_uri || !ensureAuthForPlay()) {
            return;
        }

        const playable = toPlayerTracks(songs);
        if (playable.length > 1) {
            const startIndex = playable.findIndex((item) => item.songId === song.id);
            await playPlaylist(playable, {
                playlistId: playlist?.id,
                startIndex: startIndex >= 0 ? startIndex : 0,
            });
            return;
        }

        const uri = song.provider_uri;
        if (track?.songId === song.id || track?.uri === uri) {
            await toggle();
            return;
        }

        await playTrack({
            provider: (song.provider as PlayerTrack['provider']) || 'spotify',
            trackId: song.provider_track_id || uri.split(':').pop() || '',
            uri,
            title: song.title,
            artist: song.artist,
            albumArtUrl: song.album_art_url,
            songId: song.id,
            lyrics: song.lyrics,
        });
    };

    const onPlayAll = async (withShuffle = false) => {
        if (!ensureAuthForPlay()) {
            return;
        }
        const playable = toPlayerTracks(songs);
        if (playable.length === 0) {
            setError('Keine abspielbaren Tracks in der Playlist.');
            return;
        }
        await playPlaylist(playable, {
            playlistId: playlist?.id,
            shuffle: withShuffle,
            ...(withShuffle ? {} : { startIndex: 0 }),
        });
    };

    if (error && !playlist) {
        return <Alert variant="error">{error}</Alert>;
    }

    if (!playlist) {
        return <p className="text-muted">Laden…</p>;
    }

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-sm text-muted">
                        <Link to="/playlists" className="hover:text-accent">
                            ← Playlists
                        </Link>
                    </p>
                    <h1 className="font-display text-4xl font-semibold tracking-tight">{playlist.name}</h1>
                    {playlist.description && <p className="mt-2 max-w-2xl text-muted">{playlist.description}</p>}
                    <p className="mt-2 text-sm text-muted">
                        {songs.length} Songs
                        {playlist.user ? ` · ${playlist.user.name}` : ''}
                        {savingOrder ? ' · speichern…' : ''}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {songs.some((song) => song.provider_uri) && (
                        <>
                            <Button type="button" variant="accent" onClick={() => void onPlayAll(false)}>
                                <Play className="h-4 w-4" />
                                Abspielen
                            </Button>
                            <Button type="button" variant="outline" onClick={() => void onPlayAll(true)}>
                                <Shuffle className="h-4 w-4" />
                                Zufällig
                            </Button>
                        </>
                    )}

                    {isOwner && (
                        <Dialog open={showAdd} onOpenChange={setShowAdd}>
                            <DialogTrigger asChild>
                                <Button type="button" variant="outline">
                                    <ListPlus className="h-4 w-4" />
                                    Song hinzufügen
                                </Button>
                            </DialogTrigger>

                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Song hinzufügen</DialogTitle>
                                    <DialogDescription>
                                        Suche und füge Songs zu{' '}
                                        <span className="font-medium text-ink">{playlist.name}</span> hinzu.
                                    </DialogDescription>
                                </DialogHeader>

                                <DialogBody className="space-y-3">
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                        <Input
                                            className="pl-9"
                                            autoFocus
                                            placeholder="Titel oder Artist…"
                                            value={songQuery}
                                            onChange={(e) => setSongQuery(e.target.value)}
                                        />
                                    </div>

                                    {searching ? (
                                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Suche…
                                        </div>
                                    ) : songResults.length === 0 ? (
                                        <p className="py-8 text-center text-sm text-muted">
                                            Keine passenden Songs.
                                        </p>
                                    ) : (
                                        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                                            {songResults.map((song) => {
                                                const busy = addingId === song.id;
                                                return (
                                                    <li key={song.id}>
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() => void addSong(song)}
                                                            className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-paper-2 disabled:opacity-60"
                                                        >
                                                            {song.album_art_url ? (
                                                                <img
                                                                    src={song.album_art_url}
                                                                    alt=""
                                                                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                                                                />
                                                            ) : (
                                                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper-2">
                                                                    {busy ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin text-muted" />
                                                                    ) : (
                                                                        <ListPlus className="h-4 w-4 text-muted" />
                                                                    )}
                                                                </span>
                                                            )}
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-sm font-medium">
                                                                    {song.title}
                                                                </span>
                                                                <span className="block truncate text-xs text-muted">
                                                                    {song.artist}
                                                                </span>
                                                            </span>
                                                            <span className="text-xs font-medium text-accent">
                                                                {busy ? '…' : 'Hinzufügen'}
                                                            </span>
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}

                                    {addedIds.size > 0 && (
                                        <p className="flex items-center gap-1.5 text-sm text-success">
                                            <Check className="h-3.5 w-3.5" />
                                            {addedIds.size} Song{addedIds.size === 1 ? '' : 's'} hinzugefügt
                                        </p>
                                    )}
                                </DialogBody>

                                <DialogFooter className="flex justify-end">
                                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
                                        Fertig
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}

                    {isOwner && (
                        <Button type="button" variant="destructive" onClick={() => void onDelete()}>
                            Löschen
                        </Button>
                    )}
                </div>
            </div>

            {flash && <Alert variant="success">{flash}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}
            {shuffle && (
                <p className="text-xs text-muted">Zufallsmodus aktiv — jeder Song kommt einmal pro Rotation.</p>
            )}

            {songs.length === 0 ? (
                <p className="text-muted">Noch keine Songs in dieser Playlist.</p>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={songIds} strategy={verticalListSortingStrategy}>
                        <ul className="space-y-2">
                            {songs.map((song, index) => (
                                <SortableSongRow
                                    key={song.id}
                                    song={song}
                                    isOwner={isOwner}
                                    isPlayingHere={
                                        (track?.songId === song.id || track?.uri === song.provider_uri) && playing
                                    }
                                    onPlay={() => void onPlaySong(song, index)}
                                    onRemove={() => void removeSong(song.id)}
                                />
                            ))}
                        </ul>
                    </SortableContext>
                </DndContext>
            )}

            {isOwner && songs.length > 1 && (
                <p className="text-xs text-muted">Ziehe Songs am Griff, um die Reihenfolge zu ändern.</p>
            )}
        </div>
    );
}
