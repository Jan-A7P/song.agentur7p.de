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
import { hasMusicConnected, providerLabel } from '@/lib/music';
import { songIsPlayable, songProviderLinks, songToPlayerTrack } from '@/lib/playable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { AppTooltip } from '@/components/ui/tooltip';
import { FavoriteButton } from '@/components/FavoriteButton';
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
import { subscribeFavoriteChange } from '@/lib/favorite-sync';
import { PlaylistShowSkeleton } from '@/components/skeletons';
import { ArtistLinks } from '@/components/ArtistLinks';
import { cn } from '@/lib/utils';
import { useI18n } from '@/context/locale-context';

function SortableSongRow({
    song,
    isOwner,
    isCurrent,
    isPlayingHere,
    onPlay,
    onRemove,
    onFavoriteChange,
}: {
    song: Song;
    isOwner: boolean;
    isCurrent: boolean;
    isPlayingHere: boolean;
    onPlay: () => void;
    onRemove: () => void;
    onFavoriteChange: (favorited: boolean) => void;
}) {
    const { t } = useI18n();
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
                'flex items-center gap-2 rounded-xl border px-2 py-2 sm:gap-3 sm:px-3',
                isDragging && 'z-10 border-line bg-paper shadow-lg',
                !isDragging && isCurrent && 'border-accent/30 bg-accent/10',
                !isDragging && !isCurrent && 'border-transparent bg-surface',
            )}
        >
            {isOwner && (
                <AppTooltip label={t('playlists.move')}>
                    <button
                        type="button"
                        className="cursor-grab touch-none rounded p-1 text-muted hover:bg-paper-2 hover:text-ink active:cursor-grabbing"
                        aria-label={t('playlists.move')}
                        {...attributes}
                        {...listeners}
                    >
                        <GripVertical className="h-4 w-4" />
                    </button>
                </AppTooltip>
            )}

            {song.album_art_url ? (
                <img src={song.album_art_url} alt="" className="h-11 w-11 rounded object-cover" />
            ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded bg-paper-2 text-xs text-muted">
                    {t('common.dash')}
                </div>
            )}

            <div className="min-w-0 flex-1">
                <Link
                    to={`/songs/${song.id}`}
                    className={cn('block truncate font-medium hover:text-accent', isCurrent && 'text-accent')}
                >
                    {song.title}
                </Link>
                <p className="truncate text-sm text-muted">
                    <ArtistLinks artists={song.artists} artist={song.artist} />
                </p>
            </div>

            <div className="hidden flex-wrap justify-end gap-1 sm:flex">
                {songProviderLinks(song).map((link) => (
                    <Badge
                        key={link.provider}
                        className={cn(
                            link.provider === (song.preferred_provider ?? song.provider) &&
                                'border-accent/20 bg-accent/10 text-accent',
                        )}
                    >
                        {providerLabel(link.provider)}
                    </Badge>
                ))}
            </div>

            <FavoriteButton
                songId={song.id}
                favorited={Boolean(song.is_favorited)}
                onChange={onFavoriteChange}
            />

            {songIsPlayable(song) && (
                <AppTooltip label={isPlayingHere ? t('common.pause') : t('common.play')}>
                    <Button
                        type="button"
                        variant="accent"
                        size="icon"
                        onClick={onPlay}
                        aria-label={isPlayingHere ? t('common.pause') : t('common.play')}
                    >
                        {isPlayingHere ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                </AppTooltip>
            )}

            {isOwner && (
                <AppTooltip label={t('playlists.remove')}>
                    <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={t('playlists.remove')}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </AppTooltip>
            )}
        </li>
    );
}

function toPlayerTracks(songs: Song[], user: Parameters<typeof songToPlayerTrack>[1]): PlayerTrack[] {
    return songs
        .map((song) => songToPlayerTrack(song, user))
        .filter((track): track is PlayerTrack => track !== null);
}

export function PlaylistShowPage() {
    const { id } = useParams();
    const location = useLocation();
    const { user } = useAuth();
    const { track, playing, playTrack, playPlaylist, toggle, shuffle, syncPlaylistQueue } = usePlayer();
    const navigate = useNavigate();
    const { t } = useI18n();
    const [playlist, setPlaylist] = useState<Playlist | null>(null);
    const [songs, setSongs] = useState<Song[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(() => {
        const state = location.state as { importedTracks?: number; lyricsFound?: number } | null;
        const imported = state?.importedTracks;
        if (typeof imported !== 'number') {
            return null;
        }
        const lyricsFound = typeof state?.lyricsFound === 'number' ? state.lyricsFound : 0;
        if (lyricsFound > 0) {
            return t('playlists.importedLyrics', { count: lyricsFound, songs: imported, lyrics: lyricsFound });
        }
        return t('playlists.imported', { count: imported });
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
                setError(t('playlists.notFound'));
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        return subscribeFavoriteChange((songId, favorited) => {
            setSongs((prev) =>
                prev.map((song) => (song.id === songId ? { ...song, is_favorited: favorited } : song)),
            );
        });
    }, []);

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
            const ordered = data.data.songs ?? nextSongs;
            setSongs(ordered);
            if (id) {
                syncPlaylistQueue(id, toPlayerTracks(ordered, user));
            }
        } catch {
            setError(t('playlists.orderFailed'));
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
            const ordered = data.data.songs ?? [];
            setSongs(ordered);
            if (id) {
                syncPlaylistQueue(id, toPlayerTracks(ordered, user));
            }
        } catch {
            setError(t('playlists.addFailed'));
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

    const removeSong = async (songId: string) => {
        setError(null);
        const previous = songs;
        setSongs((prev) => prev.filter((song) => song.id !== songId));
        try {
            const { data } = await api.delete<{ data: Playlist }>(`/playlists/${id}/songs/${songId}`);
            setPlaylist(data.data);
            const ordered = data.data.songs ?? [];
            setSongs(ordered);
            if (id) {
                syncPlaylistQueue(id, toPlayerTracks(ordered, user));
            }
        } catch {
            setError(t('playlists.removeFailed'));
            setSongs(previous);
        }
    };

    const onDelete = async () => {
        if (!playlist || !window.confirm(t('playlists.confirmDelete'))) {
            return;
        }
        try {
            await api.delete(`/playlists/${playlist.id}`);
            navigate('/playlists');
        } catch {
            setError(t('playlists.deleteFailed'));
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

    const onPlaySong = async (song: Song) => {
        if (!songIsPlayable(song) || !ensureAuthForPlay()) {
            return;
        }

        const playable = toPlayerTracks(songs, user);
        if (playable.length > 1) {
            const startIndex = playable.findIndex((item) => item.songId === song.id);
            await playPlaylist(playable, {
                playlistId: playlist?.id,
                startIndex: startIndex >= 0 ? startIndex : 0,
            });
            return;
        }

        const single = songToPlayerTrack(song, user);
        if (!single) {
            return;
        }

        if (track?.songId === song.id || track?.uri === single.uri) {
            await toggle();
            return;
        }

        await playTrack(single);
    };

    const onPlayAll = async (withShuffle = false) => {
        if (!ensureAuthForPlay()) {
            return;
        }
        const playable = toPlayerTracks(songs, user);
        if (playable.length === 0) {
            setError(t('playlists.noPlayable'));
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
        return <PlaylistShowSkeleton />;
    }

    return (
        <div className="space-y-8">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted">
                        <Link to="/playlists" className="hover:text-accent">
                            {t('playlists.back')}
                        </Link>
                    </p>
                    <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{playlist.name}</h1>
                    {playlist.description && <p className="mt-2 max-w-2xl text-muted">{playlist.description}</p>}
                    <p className="mt-2 text-sm text-muted">
                        {t('common.songCount', { count: songs.length })}
                        {playlist.user ? t('playlists.ownerSuffix', { name: playlist.user.name }) : ''}
                        {savingOrder ? t('playlists.savingOrder') : ''}
                    </p>
                </div>

                <div className="flex shrink-0 flex-nowrap items-center gap-2">
                    {songs.some((song) => songIsPlayable(song)) && (
                        <>
                            <AppTooltip label={t('common.play')}>
                                <Button
                                    type="button"
                                    variant="accent"
                                    size="icon"
                                    onClick={() => void onPlayAll(false)}
                                    aria-label={t('common.play')}
                                >
                                    <Play className="h-4 w-4" />
                                </Button>
                            </AppTooltip>
                            <AppTooltip label={t('player.shuffleAria')}>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => void onPlayAll(true)}
                                    aria-label={t('player.shuffleAria')}
                                >
                                    <Shuffle className="h-4 w-4" />
                                </Button>
                            </AppTooltip>
                        </>
                    )}

                    {isOwner && (
                        <Dialog open={showAdd} onOpenChange={setShowAdd}>
                            <AppTooltip label={t('playlists.addSong')}>
                                <DialogTrigger asChild>
                                    <Button type="button" variant="outline" size="icon" aria-label={t('playlists.addSong')}>
                                        <ListPlus className="h-4 w-4" />
                                    </Button>
                                </DialogTrigger>
                            </AppTooltip>

                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>{t('playlists.addSong')}</DialogTitle>
                                    <DialogDescription>
                                        {t('playlists.addSongTo', { name: playlist.name })}
                                    </DialogDescription>
                                </DialogHeader>

                                <DialogBody className="space-y-3">
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                                        <Input
                                            className="pl-9"
                                            autoFocus
                                            placeholder={t('playlists.searchPlaceholder')}
                                            value={songQuery}
                                            onChange={(e) => setSongQuery(e.target.value)}
                                        />
                                    </div>

                                    {searching ? (
                                        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            {t('common.searching')}
                                        </div>
                                    ) : songResults.length === 0 ? (
                                        <p className="py-8 text-center text-sm text-muted">
                                            {t('playlists.noMatching')}
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
                                                                {busy ? t('common.adding') : t('common.add')}
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
                                            {t('playlists.addedCount', { count: addedIds.size })}
                                        </p>
                                    )}
                                </DialogBody>

                                <DialogFooter className="flex justify-end">
                                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
                                        {t('common.done')}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}

                    {isOwner && (
                        <AppTooltip label={t('playlists.deletePlaylist')}>
                            <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                onClick={() => void onDelete()}
                                aria-label={t('playlists.deletePlaylist')}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </AppTooltip>
                    )}
                </div>
            </div>

            {flash && <Alert variant="success">{flash}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}
            {shuffle && (
                <p className="text-xs text-muted">{t('playlists.shuffleHint')}</p>
            )}

            {songs.length === 0 ? (
                <p className="text-muted">{t('playlists.emptyPlaylist')}</p>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={songIds} strategy={verticalListSortingStrategy}>
                        <ul className="space-y-2">
                            {songs.map((song) => {
                                const isCurrent = Boolean(
                                    track?.songId === song.id ||
                                        songProviderLinks(song).some((l) => l.provider_uri === track?.uri),
                                );
                                return (
                                <SortableSongRow
                                    key={song.id}
                                    song={song}
                                    isOwner={isOwner}
                                    isCurrent={isCurrent}
                                    isPlayingHere={isCurrent && playing}
                                    onPlay={() => void onPlaySong(song)}
                                    onRemove={() => void removeSong(song.id)}
                                    onFavoriteChange={(favorited) =>
                                        setSongs((prev) =>
                                            prev.map((item) =>
                                                item.id === song.id ? { ...item, is_favorited: favorited } : item,
                                            ),
                                        )
                                    }
                                />
                                );
                            })}
                        </ul>
                    </SortableContext>
                </DndContext>
            )}

            {isOwner && songs.length > 1 && (
                <p className="text-xs text-muted">{t('playlists.dragHint')}</p>
            )}
        </div>
    );
}
