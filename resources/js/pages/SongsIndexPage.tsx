import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import api from '@/lib/api';
import type { Paginated, Song } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/auth-context';
import { usePlayer } from '@/context/player-context';
import { hasMusicConnected } from '@/lib/music';
import { Alert } from '@/components/ui/alert';
import { songIsPlayable, songToPlayerTrack } from '@/lib/playable';

export function SongsIndexPage() {
    const { user, refreshUser } = useAuth();
    const { track, playing, playTrack, toggle } = usePlayer();
    const [songs, setSongs] = useState<Song[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
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

    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            setLoading(true);
            setError(null);
            try {
                const { data } = await api.get<Paginated<Song>>('/songs', {
                    signal: controller.signal,
                });
                setSongs(data.data);
            } catch {
                if (!controller.signal.aborted) {
                    setError('Songs konnten nicht geladen werden.');
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            controller.abort();
        };
    }, []);

    const onPlaySong = async (song: Song, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const playable = songToPlayerTrack(song);
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

    return (
        <div className="space-y-8">
            <section className="space-y-2">
                <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Songs</h1>
                <p className="max-w-xl text-muted">
                    Lyrics lesen und Tracks direkt abspielen. Suche mit{' '}
                    <kbd className="rounded border border-line bg-paper-2 px-1.5 py-0.5 text-xs">Ctrl+K</kbd>.
                </p>
            </section>

            {oauthFlash === 'connected' && <Alert variant="success">Musikdienst erfolgreich verbunden.</Alert>}
            {oauthFlash === 'error' && <Alert variant="error">Verbindung abgebrochen.</Alert>}

            {error && <Alert variant="error">{error}</Alert>}

            {loading ? (
                <p className="text-muted">Laden…</p>
            ) : songs.length === 0 ? (
                <p className="text-muted">Noch keine Songs. Sei der Erste und füge einen hinzu.</p>
            ) : (
                <ul className="divide-y divide-line border-y border-line">
                    {songs.map((song) => {
                        const playable = songIsPlayable(song);
                        const uri = song.provider_uri;
                        const isCurrent = Boolean(uri && (track?.songId === song.id || track?.uri === uri));
                        const isPlayingHere = isCurrent && playing;

                        return (
                            <li key={song.id}>
                                <div className="group -mx-3 flex items-center gap-4 rounded-lg px-3 py-4 transition hover:bg-surface">
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
                                        </div>
                                    </Link>
                                    {playable && (
                                        <>
                                            <Badge className="hidden sm:inline-flex capitalize">
                                                {song.provider ?? 'Musik'}
                                            </Badge>
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
