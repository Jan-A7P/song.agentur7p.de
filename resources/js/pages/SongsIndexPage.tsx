import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import type { Paginated, Song } from '@/types';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/tooltip';
import { FavoriteButton } from '@/components/FavoriteButton';
import { SongPlayButton, SongProviderBadges } from '@/components/SongPlayButton';
import { useAuth } from '@/context/auth-context';
import { usePlayer } from '@/context/player-context';
import { Alert } from '@/components/ui/alert';
import { songIsPlayable, songMatchesTrack } from '@/lib/playable';
import { getSongListCache, setSongListCache, subscribeSongListInvalidation, type SongListFilter } from '@/lib/song-list-cache';
import { subscribeFavoriteChange } from '@/lib/favorite-sync';
import { SongListSkeleton } from '@/components/skeletons';
import { ArtistLinks } from '@/components/ArtistLinks';
import { useI18n } from '@/context/locale-context';
import { cn } from '@/lib/utils';

type ListFilter = SongListFilter;

export function SongsIndexPage() {
    const { user, refreshUser } = useAuth();
    const { track } = usePlayer();
    const { t } = useI18n();
    const initial = getSongListCache('all');
    const [songs, setSongs] = useState<Song[]>(() => initial?.songs ?? []);
    const [page, setPage] = useState(() => initial?.page ?? 1);
    const [lastPage, setLastPage] = useState(() => initial?.lastPage ?? 1);
    const [loading, setLoading] = useState(() => !(initial && initial.songs.length > 0));
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<ListFilter>('all');
    const [oauthFlash, setOauthFlash] = useState<string | null>(() => {
        return new URLSearchParams(window.location.search).get('spotify');
    });

    const hasPrev = page > 1;
    const hasNext = page < lastPage;

    useEffect(() => {
        if (!oauthFlash) {
            return;
        }

        window.history.replaceState({}, '', '/');

        if (oauthFlash === 'connected') {
            void refreshUser();
        }

        const timer = window.setTimeout(() => setOauthFlash(null), 4000);
        return () => window.clearTimeout(timer);
    }, [oauthFlash, refreshUser]);

    const loadPage = useCallback(
        async (pageToLoad: number, signal?: AbortSignal) => {
            setLoading(true);
            setError(null);

            try {
                const favorites = filter === 'favorites' ? 1 : undefined;
                const { data } = await api.get<Paginated<Song>>('/songs', {
                    signal,
                    params: { page: pageToLoad, favorites },
                });

                setSongs(data.data);
                setPage(data.current_page);
                setLastPage(data.last_page);
            } catch {
                if (!signal?.aborted) {
                    setError(t('songs.loadFailed'));
                }
            } finally {
                if (!signal?.aborted) {
                    setLoading(false);
                }
            }
        },
        [filter],
    );

    useEffect(() => {
        const cached = getSongListCache(filter);
        if (cached && cached.songs.length > 0) {
            setSongs(cached.songs);
            setPage(cached.page);
            setLastPage(cached.lastPage);
            setLoading(false);
            setError(null);
            return;
        }

        const controller = new AbortController();
        setSongs([]);
        setPage(1);
        setLastPage(1);
        void loadPage(1, controller.signal);
        return () => controller.abort();
    }, [loadPage]);

    useEffect(() => {
        return subscribeSongListInvalidation(() => {
            clearLocalAndReload();
        });

        function clearLocalAndReload() {
            setSongs([]);
            setPage(1);
            setLastPage(1);
            void loadPage(1);
        }
    }, [loadPage]);

    useEffect(() => {
        if (loading) {
            return;
        }
        setSongListCache(filter, { songs, page, lastPage });
    }, [songs, page, lastPage, filter, loading]);

    useEffect(() => {
        if (filter === 'favorites' && !user) {
            setFilter('all');
        }
    }, [filter, user]);

    const goToPage = (nextPage: number) => {
        if (nextPage < 1 || nextPage > lastPage || nextPage === page || loading) {
            return;
        }
        window.scrollTo(0, 0);
        void loadPage(nextPage);
    };

    const onFavoriteChange = (songId: string, favorited: boolean) => {
        setSongs((prev) => {
            if (filter === 'favorites' && !favorited) {
                return prev.filter((s) => s.id !== songId);
            }
            return prev.map((s) => (s.id === songId ? { ...s, is_favorited: favorited } : s));
        });
    };

    useEffect(() => {
        return subscribeFavoriteChange(onFavoriteChange);
    }, [filter]);

    return (
        <div className="space-y-8">
            <section className="space-y-2">
                <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{t('songs.title')}</h1>
                <p className="max-w-xl text-muted">
                    {t('songs.subtitleBeforeShortcut')}{' '}
                    <kbd className="rounded border border-line bg-paper-2 px-1.5 py-0.5 text-xs">Ctrl+K</kbd>.
                </p>
            </section>

            {user && (
                <div className="flex gap-1 rounded-full border border-line bg-surface p-1 w-fit">
                    <button
                        type="button"
                        onClick={() => setFilter('all')}
                        className={cn(
                            'rounded-full px-3.5 py-1.5 text-sm transition',
                            filter === 'all' ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
                        )}
                    >
                        {t('common.all')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter('favorites')}
                        className={cn(
                            'rounded-full px-3.5 py-1.5 text-sm transition',
                            filter === 'favorites' ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
                        )}
                    >
                        {t('songs.favorites')}
                    </button>
                </div>
            )}

            {oauthFlash === 'connected' && <Alert variant="success">{t('songs.connected')}</Alert>}
            {oauthFlash === 'error' && <Alert variant="error">{t('songs.connectionAborted')}</Alert>}

            {error && <Alert variant="error">{error}</Alert>}

            {loading ? (
                <SongListSkeleton />
            ) : songs.length === 0 ? (
                <p className="text-muted">
                    {filter === 'favorites'
                        ? t('songs.noFavorites')
                        : t('songs.noSongs')}
                </p>
            ) : (
                <>
                    <ul className="divide-y divide-line border-y border-line">
                        {songs.map((song) => {
                            const playable = songIsPlayable(song);
                            const isCurrent = songMatchesTrack(song, track);

                            return (
                                <li key={song.id}>
                                    <div
                                        className={cn(
                                            'group -mx-3 flex items-center gap-3 rounded-lg px-3 py-4 transition sm:gap-4',
                                            isCurrent
                                                ? 'bg-accent/10 ring-1 ring-accent/25 hover:bg-accent/15'
                                                : 'hover:bg-surface',
                                        )}
                                    >
                                        <Link to={`/songs/${song.id}`} className="shrink-0">
                                            {song.album_art_url ? (
                                                <img
                                                    src={song.album_art_url}
                                                    alt=""
                                                    className="h-14 w-14 rounded object-cover"
                                                />
                                            ) : (
                                                <div className="flex h-14 w-14 items-center justify-center rounded bg-paper-2 text-xs text-muted">
                                                    {t('common.dash')}
                                                </div>
                                            )}
                                        </Link>
                                        <div className="min-w-0 flex-1">
                                            <Link
                                                to={`/songs/${song.id}`}
                                                className={cn(
                                                    'block truncate font-medium hover:text-accent',
                                                    isCurrent && 'text-accent',
                                                )}
                                            >
                                                {song.title}
                                            </Link>
                                            <p className="truncate text-sm text-muted">
                                                <ArtistLinks artists={song.artists} artist={song.artist} />
                                            </p>
                                        </div>
                                        <FavoriteButton
                                            songId={song.id}
                                            favorited={Boolean(song.is_favorited)}
                                            onChange={(favorited) => onFavoriteChange(song.id, favorited)}
                                        />
                                        {playable && (
                                            <>
                                                <SongProviderBadges song={song} className="hidden sm:flex" />
                                                <SongPlayButton song={song} />
                                            </>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    {lastPage > 1 && (
                        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                            <AppTooltip label={t('common.previousPage')}>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    disabled={!hasPrev || loading}
                                    aria-label={t('common.previousPage')}
                                    onClick={() => goToPage(page - 1)}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                            </AppTooltip>
                            <p className="min-w-[7rem] text-center text-sm text-muted">
                                {t('common.pageOf', { page, lastPage })}
                            </p>
                            <AppTooltip label={t('common.nextPage')}>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    disabled={!hasNext || loading}
                                    aria-label={t('common.nextPage')}
                                    onClick={() => goToPage(page + 1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </AppTooltip>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
