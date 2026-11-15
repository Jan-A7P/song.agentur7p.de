import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import type { Song, SongStats } from '@/types';
import { useAuth } from '@/context/auth-context';
import { usePlayer } from '@/context/player-context';
import { hasPlaybackConnected } from '@/lib/music';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SyncedLyrics } from '@/components/SyncedLyrics';
import { AddToPlaylist } from '@/components/AddToPlaylist';
import { FavoriteButton } from '@/components/FavoriteButton';
import { SongPlayStats } from '@/components/SongPlayStats';
import { SongPlayButton, SongProviderBadges } from '@/components/SongPlayButton';
import { songIsPlayable, songMatchesTrack, songToPlayerTrack } from '@/lib/playable';
import { subscribeFavoriteChange } from '@/lib/favorite-sync';
import { invalidateSongListCache } from '@/lib/song-list-cache';
import { ArtistLinks } from '@/components/ArtistLinks';
import { SongShowSkeleton } from '@/components/skeletons';
import { AppTooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/context/locale-context';

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
    const { track, playing, clearPlayback } = usePlayer();
    const navigate = useNavigate();
    const { t } = useI18n();
    const [song, setSong] = useState<Song | null>(null);
    const [stats, setStats] = useState<SongStats>(emptyStats);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    const loadSong = useCallback(async () => {
        try {
            const { data } = await api.get<{ data: Song; stats: SongStats }>(`/songs/${id}`, {
                skipErrorToast: true,
            });
            setSong(data.data);
            setStats(data.stats ?? emptyStats());
            setError(null);
        } catch {
            setSong(null);
            setError(t('songs.notFound'));
        }
    }, [id]);

    useEffect(() => {
        return subscribeFavoriteChange((songId, favorited) => {
            setSong((prev) => (prev && prev.id === songId ? { ...prev, is_favorited: favorited } : prev));
        });
    }, []);

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
        if (!song || !window.confirm(t('songs.confirmDelete'))) return;
        setDeleting(true);
        try {
            const deletedId = song.id;
            await api.delete(`/songs/${deletedId}`);
            invalidateSongListCache();
            if (track?.songId === deletedId) {
                await clearPlayback();
            }
            navigate('/');
        } catch {
            setError(t('songs.deleteFailed'));
            setDeleting(false);
        }
    };

    if (error && !song) {
        return (
            <div className="space-y-4">
                <Alert variant="error">{error}</Alert>
                <Button asChild variant="outline">
                    <Link to="/">{t('songs.toList')}</Link>
                </Button>
            </div>
        );
    }

    if (!song) {
        return <SongShowSkeleton />;
    }

    const playableTrack = songToPlayerTrack(song, user);
    const playable = songIsPlayable(song);
    const isCurrent = songMatchesTrack(song, track);
    const uri = isCurrent && track?.uri ? track.uri : (playableTrack?.uri ?? null);

    return (
        <article className="space-y-8">
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 gap-4">
                    {song.album_art_url && (
                        <img
                            src={song.album_art_url}
                            alt=""
                            className="h-24 w-24 shrink-0 rounded-lg object-cover shadow-sm"
                        />
                    )}
                    <div className="min-w-0">
                        <p className="text-sm text-muted">
                            <Link to="/" className="hover:text-accent">
                                {t('songs.backOverview')}
                            </Link>
                        </p>
                        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                            {song.title}
                        </h1>
                        <p className="mt-1 truncate text-lg text-muted">
                            <ArtistLinks artists={song.artists} artist={song.artist} />
                        </p>
                        <SongProviderBadges song={song} className="mt-2 justify-start" showPreferredHint />
                    </div>
                </div>

                <div className="flex shrink-0 flex-nowrap items-center gap-2">
                    <SongPlayButton song={song} />
                    {user && (
                        <FavoriteButton
                            songId={song.id}
                            favorited={Boolean(song.is_favorited)}
                            onChange={(favorited) =>
                                setSong((prev) => (prev ? { ...prev, is_favorited: favorited } : prev))
                            }
                        />
                    )}
                    {user && (
                        <AddToPlaylist
                            songId={song.id}
                            songTitle={song.title}
                            songArtist={song.artist}
                        />
                    )}
                    {user && (
                        <DropdownMenu>
                            <AppTooltip label={t('songs.moreActions')}>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        aria-label={t('songs.moreActions')}
                                    >
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                            </AppTooltip>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                    <Link to={`/songs/${song.id}/edit`}>
                                        <Pencil className="h-4 w-4" />
                                        {t('songs.edit')}
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    destructive
                                    disabled={deleting}
                                    onSelect={() => {
                                        void onDelete();
                                    }}
                                >
                                    <Trash2 className="h-4 w-4" />
                                    {t('common.delete')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </div>

            {!playable && <Alert>{t('songs.noTrackLinked')}</Alert>}
            {playable && !user && (
                <Alert>
                    {t('songs.playPlease')}{' '}
                    <Link className="underline underline-offset-2" to="/login">{t('songs.signIn')}</Link>{' '}
                    {t('songs.andConnect')}
                </Alert>
            )}
            {playable && user && !hasPlaybackConnected(user) && (
                <Alert>
                    {t('songs.noService')}{' '}
                    <Link className="font-medium underline underline-offset-2" to="/settings">
                        {t('songs.toSettings')}
                    </Link>
                </Alert>
            )}

            {error && <Alert variant="error">{error}</Alert>}

            <SyncedLyrics lyrics={song.lyrics} songId={song.id} trackUri={uri} />

            <SongPlayStats stats={stats} />
        </article>
    );
}
