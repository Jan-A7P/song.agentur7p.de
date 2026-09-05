import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Music2, Search, UserRound } from 'lucide-react';
import api from '@/lib/api';
import type { Artist, Paginated, Song } from '@/types';
import { useI18n } from '@/context/locale-context';
import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/tooltip';

type Props = {
    onOpenCommand: () => void;
};

type ResultItem =
    | { type: 'artist'; artist: Artist }
    | { type: 'song'; song: Song };

export function HeaderSearch({ onOpenCommand }: Props) {
    const navigate = useNavigate();
    const { t } = useI18n();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [artists, setArtists] = useState<Artist[]>([]);
    const [songs, setSongs] = useState<Song[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [searchedQuery, setSearchedQuery] = useState('');

    const results = useMemo<ResultItem[]>(
        () => [
            ...artists.map((artist) => ({ type: 'artist' as const, artist })),
            ...songs.map((song) => ({ type: 'song' as const, song })),
        ],
        [artists, songs],
    );

    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener('mousedown', onClick);
        return () => window.removeEventListener('mousedown', onClick);
    }, []);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 1) {
            setArtists([]);
            setSongs([]);
            setLoading(false);
            setActiveIndex(0);
            setSearchedQuery('');
            setOpen(false);
            return;
        }

        const controller = new AbortController();
        setLoading(false);

        const timer = window.setTimeout(async () => {
            setLoading(true);
            setOpen(true);
            try {
                const [songsRes, artistsRes] = await Promise.all([
                    api.get<Paginated<Song>>('/songs', {
                        params: { q },
                        signal: controller.signal,
                        skipErrorToast: true,
                    }),
                    api.get<Paginated<Artist>>('/artists', {
                        params: { q },
                        signal: controller.signal,
                        skipErrorToast: true,
                    }),
                ]);

                setArtists(artistsRes.data.data.slice(0, 4));
                setSongs(songsRes.data.data.slice(0, 6));
                setSearchedQuery(q);
                setActiveIndex(0);
            } catch {
                if (!controller.signal.aborted) {
                    setArtists([]);
                    setSongs([]);
                    setSearchedQuery(q);
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
    }, [query]);

    const goToResult = (item: ResultItem) => {
        setOpen(false);
        setQuery('');
        setArtists([]);
        setSongs([]);
        setSearchedQuery('');
        if (item.type === 'artist') {
            navigate(`/artists/${item.artist.slug}`);
            return;
        }
        navigate(`/songs/${item.song.id}`);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setOpen(false);
            (e.target as HTMLInputElement).blur();
            return;
        }

        if (!open || results.length === 0) {
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => (i + 1) % results.length);
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => (i - 1 + results.length) % results.length);
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const item = results[activeIndex];
            if (item) {
                goToResult(item);
            }
        }
    };

    const showResults = open && query.trim().length > 0 && (loading || searchedQuery === query.trim());
    const artistOffset = 0;
    const songOffset = artists.length;

    return (
        <div ref={rootRef} className="relative min-w-0 w-full xl:justify-self-center">
            <div className="flex h-9 w-full max-w-md items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm transition focus-within:border-ink/25 sm:px-4 xl:mx-auto">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                        if (searchedQuery && searchedQuery === query.trim()) {
                            setOpen(true);
                        }
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={t('search.headerPlaceholder')}
                    className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
                    aria-label={t('search.headerAria')}
                    aria-expanded={showResults}
                    aria-controls="header-search-results"
                    autoComplete="off"
                />
                {loading ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
                ) : (
                    <AppTooltip label={t('search.command')}>
                        <button
                            type="button"
                            onClick={onOpenCommand}
                            className="ml-auto hidden shrink-0 rounded border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] font-medium text-muted transition hover:border-ink/20 hover:text-ink sm:inline"
                            aria-label={t('search.command')}
                        >
                            Ctrl+K
                        </button>
                    </AppTooltip>
                )}
            </div>

            {showResults && (
                <div
                    id="header-search-results"
                    role="listbox"
                    className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(60vh,22rem)] overflow-y-auto rounded-xl border border-line bg-paper/95 py-1 shadow-lg backdrop-blur-xl sm:left-1/2 sm:right-auto sm:w-full sm:max-w-md sm:-translate-x-1/2"
                >
                    {loading && results.length === 0 ? (
                        <p className="px-3 py-6 text-center text-sm text-muted">{t('common.searching')}</p>
                    ) : results.length === 0 ? (
                        <p className="px-3 py-6 text-center text-sm text-muted">{t('search.noResults')}</p>
                    ) : (
                        <>
                            {artists.length > 0 && (
                                <div role="group" aria-label={t('search.artists')}>
                                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                                        {t('search.artists')}
                                    </p>
                                    {artists.map((artist, index) => {
                                        const resultIndex = artistOffset + index;
                                        const item: ResultItem = { type: 'artist', artist };
                                        return (
                                            <button
                                                key={`artist-${artist.id}`}
                                                type="button"
                                                role="option"
                                                aria-selected={resultIndex === activeIndex}
                                                onMouseEnter={() => setActiveIndex(resultIndex)}
                                                onClick={() => goToResult(item)}
                                                className={cn(
                                                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition',
                                                    resultIndex === activeIndex
                                                        ? 'bg-paper-2'
                                                        : 'hover:bg-paper-2/70',
                                                )}
                                            >
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-2">
                                                    <UserRound className="h-4 w-4 text-muted" />
                                                </div>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-medium">
                                                        {artist.name}
                                                    </span>
                                                    {typeof artist.songs_count === 'number' && (
                                                        <span className="block truncate text-xs text-muted">
                                                            {t('common.songCount', { count: artist.songs_count })}
                                                        </span>
                                                    )}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {artists.length > 0 && songs.length > 0 && (
                                <div className="my-1 border-t border-line" role="separator" />
                            )}

                            {songs.length > 0 && (
                                <div role="group" aria-label={t('search.tracks')}>
                                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
                                        {t('search.tracks')}
                                    </p>
                                    {songs.map((song, index) => {
                                        const resultIndex = songOffset + index;
                                        const item: ResultItem = { type: 'song', song };
                                        return (
                                            <button
                                                key={`song-${song.id}`}
                                                type="button"
                                                role="option"
                                                aria-selected={resultIndex === activeIndex}
                                                onMouseEnter={() => setActiveIndex(resultIndex)}
                                                onClick={() => goToResult(item)}
                                                className={cn(
                                                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition',
                                                    resultIndex === activeIndex
                                                        ? 'bg-paper-2'
                                                        : 'hover:bg-paper-2/70',
                                                )}
                                            >
                                                {song.album_art_url ? (
                                                    <img
                                                        src={song.album_art_url}
                                                        alt=""
                                                        className="h-9 w-9 shrink-0 rounded-md object-cover"
                                                    />
                                                ) : (
                                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-paper-2">
                                                        <Music2 className="h-4 w-4 text-muted" />
                                                    </div>
                                                )}
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-medium">
                                                        {song.title}
                                                    </span>
                                                    <span className="block truncate text-xs text-muted">
                                                        {song.artist}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}

                    <div className="border-t border-line px-3 py-2">
                        <Link
                            to="/"
                            className="text-xs text-muted hover:text-accent"
                            onClick={() => {
                                setOpen(false);
                                setQuery('');
                                setSearchedQuery('');
                            }}
                        >
                            {t('search.showAllSongs')}
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
