import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import api from '@/lib/api';
import type { Artist, Paginated, Song } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/tooltip';
import { FavoriteButton } from '@/components/FavoriteButton';
import { ArtistLinks } from '@/components/ArtistLinks';
import { useAuth } from '@/context/auth-context';
import { usePlayer } from '@/context/player-context';
import { hasMusicConnected, providerLabel } from '@/lib/music';
import { Alert } from '@/components/ui/alert';
import { songIsPlayable, songProviderLinks, songToPlayerTrack } from '@/lib/playable';
import { SongListSkeleton } from '@/components/skeletons';
import { cn } from '@/lib/utils';
import { useI18n } from '@/context/locale-context';

type ArtistShowResponse = {
    data: Artist & { songs_count: number };
    songs: Paginated<Song>;
};

export function ArtistShowPage() {
    const { slug } = useParams<{ slug: string }>();
    const { user } = useAuth();
    const { track, playing, playTrack, toggle } = usePlayer();
    const { t } = useI18n();
    const [artist, setArtist] = useState<(Artist & { songs_count: number }) | null>(null);
    const [songs, setSongs] = useState<Song[]>([]);
    const [page, setPage] = useState(1);
    const [lastPage, setLastPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadPage = useCallback(
        async (pageToLoad: number, signal?: AbortSignal) => {
            if (!slug) {
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const { data } = await api.get<ArtistShowResponse>(`/artists/${slug}`, {
                    signal,
                    params: { page: pageToLoad },
                });
                setArtist(data.data);
                setSongs(data.songs.data);
                setPage(data.songs.current_page);
                setLastPage(data.songs.last_page);
            } catch {
                if (!signal?.aborted) {
                    setError(t('songs.artistLoadFailed'));
                    setArtist(null);
                    setSongs([]);
                }
            } finally {
                if (!signal?.aborted) {
                    setLoading(false);
                }
            }
        },
        [slug],
    );

    useEffect(() => {
        const controller = new AbortController();
        void loadPage(1, controller.signal);
        return () => controller.abort();
    }, [loadPage]);

    const onFavoriteChange = (songId: string, favorited: boolean) => {
        setSongs((prev) => prev.map((s) => (s.id === songId ? { ...s, is_favorited: favorited } : s)));
    };

    const onPlay = async (song: Song) => {
        const playable = songToPlayerTrack(song, user);
        if (!playable) {
            return;
        }

        const isCurrent = track?.songId === song.id || songProviderLinks(song).some((l) => l.provider_uri === track?.uri);
        if (isCurrent) {
            await toggle();
            return;
        }

        await playTrack(playable);
    };

    if (loading && !artist) {
        return (
            <div className="space-y-8">
                <div className="space-y-3">
                    <div className="h-3 w-24 animate-pulse rounded bg-ink/10" />
                    <div className="h-9 w-64 max-w-full animate-pulse rounded bg-ink/10" />
                    <div className="h-4 w-40 animate-pulse rounded bg-ink/10" />
                </div>
                <SongListSkeleton />
            </div>
        );
    }

    if (error || !artist) {
        return (
            <div className="space-y-4">
                <Link to="/" className="text-sm text-muted hover:text-accent">
                    {t('songs.backOverview')}
                </Link>
                <Alert variant="error">{error ?? t('songs.artistNotFound')}</Alert>
            </div>
        );
    }

    const hasPrev = page > 1;
    const hasNext = page < lastPage;
    const connected = hasMusicConnected(user);

    return (
        <div className="space-y-8">
            <section className="space-y-2">
                <p className="text-sm text-muted">
                    <Link to="/" className="hover:text-accent">
                        {t('songs.backOverview')}
                    </Link>
                </p>
                <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">{artist.name}</h1>
                <p className="text-muted">
                    {t('common.songCount', { count: artist.songs_count })}
                </p>
            </section>

            {!connected && songs.some(songIsPlayable) && (
                <Alert>{t('songs.connectToPlay')}</Alert>
            )}

            {loading ? (
                <SongListSkeleton />
            ) : songs.length === 0 ? (
                <p className="text-muted">{t('songs.noArtistSongs')}</p>
            ) : (
                <>
                    <ul className="divide-y divide-line border-y border-line">
                        {songs.map((song) => {
                            const playable = songIsPlayable(song);
                            const links = songProviderLinks(song);
                            const preferred = song.preferred_provider ?? song.provider;
                            const isCurrent = Boolean(
                                track?.songId === song.id || links.some((l) => l.provider_uri === track?.uri),
                            );
                            const isPlayingHere = isCurrent && playing;

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
                                                <div className="hidden flex-wrap justify-end gap-1 sm:flex">
                                                    {links.map((link) => (
                                                        <Badge
                                                            key={link.provider}
                                                            className={cn(
                                                                link.provider === preferred &&
                                                                    'border-accent/20 bg-accent/10 text-accent',
                                                            )}
                                                        >
                                                            {providerLabel(link.provider)}
                                                        </Badge>
                                                    ))}
                                                </div>
                                                <AppTooltip label={isPlayingHere ? t('common.pause') : t('common.play')}>
                                                    <Button
                                                        type="button"
                                                        variant="accent"
                                                        size="icon"
                                                        aria-label={isPlayingHere ? t('common.pause') : t('common.play')}
                                                        onClick={() => void onPlay(song)}
                                                    >
                                                        {isPlayingHere ? (
                                                            <Pause className="h-4 w-4" />
                                                        ) : (
                                                            <Play className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </AppTooltip>
                                            </>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    {lastPage > 1 && (
                        <div className="flex items-center justify-between gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!hasPrev || loading}
                                onClick={() => void loadPage(page - 1)}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                {t('common.previous')}
                            </Button>
                            <p className="text-sm text-muted">
                                {t('common.pageOf', { page, lastPage })}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={!hasNext || loading}
                                onClick={() => void loadPage(page + 1)}
                            >
                                {t('common.next')}
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
