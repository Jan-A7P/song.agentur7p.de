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

export function SongsIndexPage() {
    const { user, refreshUser } = useAuth();
    const { track, playing, playTrack, toggle } = usePlayer();
    const [songs, setSongs] = useState<Song[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [spotifyFlash, setSpotifyFlash] = useState<string | null>(() => {
        return new URLSearchParams(window.location.search).get('spotify');
    });

    useEffect(() => {
        if (!spotifyFlash) {
            return;
        }

        window.history.replaceState({}, '', '/');

        if (spotifyFlash === 'connected') {
            void refreshUser();
        }

        const timer = window.setTimeout(() => setSpotifyFlash(null), 4000);
        return () => window.clearTimeout(timer);
    }, [spotifyFlash, refreshUser]);

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

        if (!song.spotify_uri) {
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

        const uri = song.spotify_uri;
        const isCurrent = track?.songId === song.id || track?.uri === uri;

        if (isCurrent) {
            await toggle();
            return;
        }

        await playTrack({
            uri,
            title: song.title,
            artist: song.artist,
            albumArtUrl: song.album_art_url,
            songId: song.id,
            lyrics: song.lyrics,
        });
    };

    return (
        <div className="space-y-8">
            <section className="space-y-2">
                <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">Songs</h1>
                <p className="max-w-xl text-muted">
                    Lyrics lesen und Spotify-Tracks direkt abspielen. Suche mit{' '}
                    <kbd className="rounded border border-line bg-paper-2 px-1.5 py-0.5 text-xs">Ctrl+K</kbd>.
                </p>
            </section>

            {spotifyFlash === 'connected' && <Alert variant="success">Spotify erfolgreich verbunden.</Alert>}
            {spotifyFlash === 'error' && <Alert variant="error">Spotify-Verbindung abgebrochen.</Alert>}

            {error && <Alert variant="error">{error}</Alert>}

            {loading ? (
                <p className="text-muted">Laden…</p>
            ) : songs.length === 0 ? (
                <p className="text-muted">Noch keine Songs. Sei der Erste und füge einen hinzu.</p>
            ) : (
                <ul className="divide-y divide-line border-y border-line">
                    {songs.map((song) => {
                        const uri = song.spotify_uri;
                        const isCurrent = Boolean(uri && (track?.songId === song.id || track?.uri === uri));
                        const isPlayingHere = isCurrent && playing;
                        const playable = Boolean(uri);

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
                                            <Badge className="hidden sm:inline-flex">Spotify</Badge>
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
