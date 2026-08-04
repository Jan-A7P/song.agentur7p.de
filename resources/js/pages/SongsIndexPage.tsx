import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import api from '@/lib/api';
import type { Paginated, Song } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FavoriteButton } from '@/components/FavoriteButton';
import { useAuth } from '@/context/auth-context';
import { usePlayer } from '@/context/player-context';
import { hasMusicConnected, providerLabel } from '@/lib/music';
import { Alert } from '@/components/ui/alert';
import { songIsPlayable, songProviderLinks, songToPlayerTrack } from '@/lib/playable';
import { cn } from '@/lib/utils';

type ListFilter = 'all' | 'favorites';

function formatListenTime(ms: number): string {
    if (!ms || ms < 1000) {
        return '0 Min.';
    }
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) {
        return `${minutes} Min.`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

export function SongsIndexPage() {
    const { user, refreshUser } = useAuth();
    const { track, playing, playTrack, toggle } = usePlayer();
    const [songs, setSongs] = useState<Song[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<ListFilter>('all');
    const [oauthFlash, setOauthFlash] = useState<string | null>(() => {
        return new URLSearchParams(window.location.search).get('spotify');
    });

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

    const loadSongs = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError(null);
            try {
                const { data } = await api.get<Paginated<Song>>('/songs', {
                    signal,
                    params: {
                        favorites: filter === 'favorites' ? 1 : undefined,
                    },
                });
                setSongs(data.data);
            } catch {
                if (!signal?.aborted) {
                    setError('Songs konnten nicht geladen werden.');
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
        const controller = new AbortController();
        void loadSongs(controller.signal);
        return () => controller.abort();
    }, [loadSongs]);

    useEffect(() => {
        if (filter === 'favorites' && !user) {
            setFilter('all');
        }
    }, [filter, user]);

    const onPlaySong = async (song: Song, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const playable = songToPlayerTrack(song, user);
        if (!playable) {
            return;
        }

        if (!user) {
            window.location.href = '/login';
            return;
        }

        if (!hasMusicConnected(user)) {
            window.location.href = '/settings';
            return;
        }

        const isCurrent = track?.songId === song.id || track?.uri === playable.uri;

        if (isCurrent) {
            await toggle();
            return;
        }

        await playTrack(playable);
    };

    const onFavoriteChange = (songId: number, favorited: boolean) => {
        setSongs((prev) => {
            if (filter === 'favorites' && !favorited) {
                return prev.filter((s) => s.id !== songId);
            }
            return prev.map((s) => (s.id === songId ? { ...s, is_favorited: favorited } : s));
        });
    };

    return (
        <div className="space-y-8">
            <section className="space-y-2">
                <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Songs</h1>
                <p className="max-w-xl text-muted">
                    Lyrics lesen und Tracks direkt abspielen. Suche mit{' '}
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
                        Alle
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter('favorites')}
                        className={cn(
                            'rounded-full px-3.5 py-1.5 text-sm transition',
                            filter === 'favorites' ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
                        )}
                    >
                        Favoriten
                    </button>
                </div>
            )}

            {oauthFlash === 'connected' && <Alert variant="success">Musikdienst erfolgreich verbunden.</Alert>}
            {oauthFlash === 'error' && <Alert variant="error">Verbindung abgebrochen.</Alert>}

            {error && <Alert variant="error">{error}</Alert>}

            {loading ? (
                <p className="text-muted">Laden…</p>
            ) : songs.length === 0 ? (
                <p className="text-muted">
                    {filter === 'favorites'
                        ? 'Noch keine Favoriten. Tippe auf das Herz bei einem Song.'
                        : 'Noch keine Songs. Sei der Erste und füge einen hinzu.'}
                </p>
            ) : (
                <ul className="divide-y divide-line border-y border-line">
                    {songs.map((song) => {
                        const playable = songIsPlayable(song);
                        const links = songProviderLinks(song);
                        const preferred = song.preferred_provider ?? song.provider;
                        const isCurrent = Boolean(
                            track?.songId === song.id || links.some((l) => l.provider_uri === track?.uri),
                        );
                        const isPlayingHere = isCurrent && playing;
                        const playCount = song.play_count ?? 0;

                        return (
                            <li key={song.id}>
                                <div className="group -mx-3 flex items-center gap-3 rounded-lg px-3 py-4 transition hover:bg-surface sm:gap-4">
                                    <Link to={`/songs/${song.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                                        {song.album_art_url ? (
                                            <img
                                                src={song.album_art_url}
                                                alt=""
                                                className="h-14 w-14 rounded object-cover"
                                            />
                                        ) : (
                                            <div className="flex h-14 w-14 items-center justify-center rounded bg-paper-2 text-xs text-muted">
                                                —
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate font-medium group-hover:text-accent">{song.title}</p>
                                            <p className="truncate text-sm text-muted">{song.artist}</p>
                                            {playCount > 0 && (
                                                <p className="mt-0.5 truncate text-xs text-muted/80">
                                                    {playCount}× gespielt
                                                    {(song.total_listen_ms ?? 0) > 0
                                                        ? ` · ${formatListenTime(song.total_listen_ms ?? 0)}`
                                                        : ''}
                                                </p>
                                            )}
                                        </div>
                                    </Link>
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
                                            <Button
                                                type="button"
                                                variant="accent"
                                                size="icon"
                                                aria-label={isPlayingHere ? 'Pause' : 'Abspielen'}
                                                onClick={(e) => void onPlaySong(song, e)}
                                            >
                                                {isPlayingHere ? (
                                                    <Pause className="h-4 w-4" />
                                                ) : (
                                                    <Play className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
