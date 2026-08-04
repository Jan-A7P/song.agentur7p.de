import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import api from '@/lib/api';
import type { Song, SongStats } from '@/types';
import { useAuth } from '@/context/auth-context';
import { usePlayer } from '@/context/player-context';
import { hasMusicConnected, providerLabel } from '@/lib/music';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { SyncedLyrics } from '@/components/SyncedLyrics';
import { AddToPlaylist } from '@/components/AddToPlaylist';
import { FavoriteButton } from '@/components/FavoriteButton';
import { SongPlayStats } from '@/components/SongPlayStats';
import { songIsPlayable, songProviderLinks, songToPlayerTrack } from '@/lib/playable';
import { cn } from '@/lib/utils';

const emptyStats = (): SongStats => ({
    play_count: 0,
    total_listen_ms: 0,
    completed_count: 0,
    duration_ms: null,
    last_played_at: null,
    my: null,
    recent_plays: [],
    daily: [],
});

export function SongShowPage() {
    const { id } = useParams();
    const { user } = useAuth();
    const { track, playing, playTrack, toggle } = usePlayer();
    const navigate = useNavigate();
    const [song, setSong] = useState<Song | null>(null);
    const [stats, setStats] = useState<SongStats>(emptyStats);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    const loadSong = useCallback(async () => {
        try {
            const { data } = await api.get<{ data: Song; stats: SongStats }>(`/songs/${id}`);
            setSong(data.data);
            setStats(data.stats ?? emptyStats());
            setError(null);
        } catch {
            setError('Song nicht gefunden.');
        }
    }, [id]);

    useEffect(() => {
        void loadSong();
    }, [loadSong]);

    // Refresh tracking when this song stops being the active playing track.
    useEffect(() => {
        if (!song || track?.songId !== song.id) {
            return;
        }
        if (playing) {
            return;
        }

        const timer = window.setTimeout(() => {
            void loadSong();
        }, 800);

        return () => window.clearTimeout(timer);
    }, [playing, track?.songId, song?.id, loadSong]);

    const onDelete = async () => {
        if (!song || !confirm('Song wirklich löschen?')) return;
        setDeleting(true);
        try {
            await api.delete(`/songs/${song.id}`);
            navigate('/');
        } catch {
            setError('Löschen fehlgeschlagen.');
            setDeleting(false);
        }
    };

    if (error && !song) {
        return <Alert variant="error">{error}</Alert>;
    }

    if (!song) {
        return <p className="text-muted">Laden…</p>;
    }

    const isOwner = user?.id === song.user_id;
    const playableTrack = songToPlayerTrack(song, user);
    const playable = songIsPlayable(song);
    const links = songProviderLinks(song);
    const preferred = song.preferred_provider ?? song.provider;
    const uri = playableTrack?.uri ?? null;
    const isCurrent = Boolean(uri && track?.uri === uri) || track?.songId === song.id;
    const isPlayingHere = isCurrent && playing;

    const onPlay = async () => {
        if (!playable || !playableTrack) {
            return;
        }

        if (!user) {
            navigate('/login');
            return;
        }

        if (!hasMusicConnected(user)) {
            navigate('/settings');
            return;
        }

        if (isCurrent) {
            await toggle();
            return;
        }

        await playTrack(playableTrack);
    };

    return (
        <article className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex gap-4">
                    {song.album_art_url && (
                        <img src={song.album_art_url} alt="" className="h-24 w-24 rounded-lg object-cover shadow-sm" />
                    )}
                    <div>
                        <p className="text-sm text-muted">
                            <Link to="/" className="hover:text-accent">
                                ← Übersicht
                            </Link>
                        </p>
                        <h1 className="font-display text-4xl font-semibold tracking-tight">{song.title}</h1>
                        <p className="mt-1 text-lg text-muted">{song.artist}</p>
                        {links.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {links.map((link) => (
                                    <Badge
                                        key={link.provider}
                                        className={cn(
                                            link.provider === preferred &&
                                                'border-accent/20 bg-accent/10 text-accent',
                                        )}
                                    >
                                        {providerLabel(link.provider)}
                                        {link.provider === preferred ? ' · bevorzugt' : ''}
                                    </Badge>
                                ))}
                            </div>
                        )}
                        {song.user && <p className="mt-2 text-xs text-muted">von {song.user.name}</p>}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {playable && (
                        <Button type="button" variant="accent" onClick={() => void onPlay()}>
                            {isPlayingHere ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            {isPlayingHere ? 'Pause' : isCurrent ? 'Weiter' : 'Abspielen'}
                        </Button>
                    )}
                    {user && (
                        <FavoriteButton
                            songId={song.id}
                            favorited={Boolean(song.is_favorited)}
                            variant="button"
                            onChange={(favorited) => setSong((prev) => (prev ? { ...prev, is_favorited: favorited } : prev))}
                        />
                    )}
                    {user && (
                        <AddToPlaylist
                            songId={song.id}
                            songTitle={song.title}
                            songArtist={song.artist}
                        />
                    )}
                    {isOwner && (
                        <>
                            <Button asChild variant="outline" size="sm">
                                <Link to={`/songs/${song.id}/edit`}>Bearbeiten</Link>
                            </Button>
                            <Button variant="destructive" size="sm" disabled={deleting} onClick={onDelete}>
                                Löschen
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {!playable && <Alert>Kein Track verknüpft.</Alert>}
            {playable && !user && (
                <Alert>
                    Zum Abspielen bitte <Link className="underline underline-offset-2" to="/login">einloggen</Link> und einen Musikdienst verbinden.
                </Alert>
            )}
            {playable && user && !hasMusicConnected(user) && (
                <Alert>
                    Noch kein Musikdienst verbunden.{' '}
                    <Link className="font-medium underline underline-offset-2" to="/settings">
                        Zu den Einstellungen
                    </Link>
                </Alert>
            )}

            {error && <Alert variant="error">{error}</Alert>}

            <SyncedLyrics lyrics={song.lyrics} songId={song.id} trackUri={uri} />

            <SongPlayStats stats={stats} />
        </article>
    );
}
