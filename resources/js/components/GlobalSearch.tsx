import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { ListMusic, Loader2, Music2, Plus, Radio, Search, Settings, UserRound, X } from 'lucide-react';
import api from '@/lib/api';
import type { Artist, Paginated, Song } from '@/types';
import { useAuth } from '@/context/auth-context';
import { useI18n } from '@/context/locale-context';
import { cn } from '@/lib/utils';

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function GlobalSearch({ open, onOpenChange }: Props) {
    const navigate = useNavigate();
    const { t } = useI18n();
    const { user } = useAuth();
    const [query, setQuery] = useState('');
    const [songs, setSongs] = useState<Song[]>([]);
    const [artists, setArtists] = useState<Artist[]>([]);
    const [loading, setLoading] = useState(false);

    const close = useCallback(() => {
        onOpenChange(false);
        setQuery('');
        setSongs([]);
        setArtists([]);
    }, [onOpenChange]);

    const go = useCallback(
        (path: string) => {
            close();
            navigate(path);
        },
        [close, navigate],
    );

    useEffect(() => {
        if (!open) {
            return;
        }

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        };

        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, close]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const q = query.trim();
        if (q.length < 1) {
            setSongs([]);
            setArtists([]);
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            try {
                const [songsRes, artistsRes] = await Promise.all([
                    api.get<Paginated<Song>>('/songs', {
                        params: { q },
                        signal: controller.signal,
                    }),
                    api.get<Paginated<Artist>>('/artists', {
                        params: { q },
                        signal: controller.signal,
                    }),
                ]);
                setSongs(songsRes.data.data.slice(0, 8));
                setArtists(artistsRes.data.data.slice(0, 6));
            } catch {
                if (!controller.signal.aborted) {
                    setSongs([]);
                    setArtists([]);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        }, 450);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [query, open]);

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh] sm:pt-[15vh]">
            <button
                type="button"
                className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
                aria-label={t('search.close')}
                onClick={close}
            />

            <Command
                label={t('search.global')}
                shouldFilter={false}
                className="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl"
            >
                <div className="flex items-center gap-3 border-b border-line px-4">
                    <Search className="h-4 w-4 shrink-0 text-muted" />
                    <Command.Input
                        value={query}
                        onValueChange={setQuery}
                        placeholder={t('search.placeholder')}
                        className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted"
                        autoFocus
                    />
                    {loading ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" />
                    ) : (
                        <button
                            type="button"
                            onClick={close}
                            className="rounded-md p-1.5 text-muted transition hover:bg-paper-2 hover:text-ink"
                            aria-label={t('common.close')}
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
                    <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
                        {query.trim() ? t('search.noResults') : t('search.typeToSearch')}
                    </Command.Empty>

                    {artists.length > 0 && (
                        <Command.Group
                            heading={t('search.artists')}
                            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted"
                        >
                            {artists.map((artist) => (
                                <Command.Item
                                    key={artist.id}
                                    value={`artist-${artist.id}-${artist.name}`}
                                    onSelect={() => go(`/artists/${artist.slug}`)}
                                    className={cn(
                                        'flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm outline-none',
                                        'data-[selected=true]:bg-paper-2',
                                    )}
                                >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-2">
                                        <UserRound className="h-4 w-4 text-muted" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium">{artist.name}</p>
                                        {typeof artist.songs_count === 'number' && (
                                            <p className="truncate text-xs text-muted">
                                                {t('common.songCount', { count: artist.songs_count })}
                                            </p>
                                        )}
                                    </div>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}

                    {artists.length > 0 && songs.length > 0 && (
                        <div className="mx-2 my-1 border-t border-line" role="separator" />
                    )}

                    {songs.length > 0 && (
                        <Command.Group
                            heading={t('search.tracks')}
                            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted"
                        >
                            {songs.map((song) => (
                                <Command.Item
                                    key={song.id}
                                    value={`song-${song.id}-${song.title}-${song.artist}`}
                                    onSelect={() => go(`/songs/${song.id}`)}
                                    className={cn(
                                        'flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm outline-none',
                                        'data-[selected=true]:bg-paper-2',
                                    )}
                                >
                                    {song.album_art_url ? (
                                        <img
                                            src={song.album_art_url}
                                            alt=""
                                            className="h-10 w-10 shrink-0 rounded-md object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-paper-2">
                                            <Music2 className="h-4 w-4 text-muted" />
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium">{song.title}</p>
                                        <p className="truncate text-xs text-muted">{song.artist}</p>
                                    </div>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}

                    {(artists.length > 0 || songs.length > 0) && (
                        <div className="mx-2 my-1 border-t border-line" role="separator" />
                    )}

                    <Command.Group
                        heading={t('search.navigation')}
                        className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted"
                    >
                        <Command.Item
                            value="nav-songs"
                            onSelect={() => go('/')}
                            className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-sm outline-none data-[selected=true]:bg-paper-2"
                        >
                            <Music2 className="h-4 w-4 text-muted" />
                            {t('search.allSongs')}
                        </Command.Item>
                        <Command.Item
                            value="nav-playlists"
                            onSelect={() => go('/playlists')}
                            className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-sm outline-none data-[selected=true]:bg-paper-2"
                        >
                            <ListMusic className="h-4 w-4 text-muted" />
                            {t('nav.playlists')}
                        </Command.Item>
                        {user && (
                            <Command.Item
                                value="nav-rooms"
                                onSelect={() => go('/rooms')}
                                className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-sm outline-none data-[selected=true]:bg-paper-2"
                            >
                                <Radio className="h-4 w-4 text-muted" />
                                {t('nav.rooms')}
                            </Command.Item>
                        )}
                        {user && (
                            <Command.Item
                                value="nav-create"
                                onSelect={() => go('/songs/create')}
                                className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-sm outline-none data-[selected=true]:bg-paper-2"
                            >
                                <Plus className="h-4 w-4 text-muted" />
                                {t('nav.addSong')}
                            </Command.Item>
                        )}
                        {user && (
                            <Command.Item
                                value="nav-profile"
                                onSelect={() => go('/profile')}
                                className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-sm outline-none data-[selected=true]:bg-paper-2"
                            >
                                <UserRound className="h-4 w-4 text-muted" />
                                {t('nav.profile')}
                            </Command.Item>
                        )}
                        {user && (
                            <Command.Item
                                value="nav-settings"
                                onSelect={() => go('/settings')}
                                className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-sm outline-none data-[selected=true]:bg-paper-2"
                            >
                                <Settings className="h-4 w-4 text-muted" />
                                {t('nav.settings')}
                            </Command.Item>
                        )}
                    </Command.Group>
                </Command.List>

                <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-muted">
                    <span>{t('search.hint')}</span>
                    <kbd className="rounded border border-line bg-paper-2 px-1.5 py-0.5 font-sans">esc</kbd>
                </div>
            </Command>
        </div>
    );
}
