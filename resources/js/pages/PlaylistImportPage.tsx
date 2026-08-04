import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, ListMusic, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import type { Playlist } from '@/types';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

type SpotifyPlaylist = {
    id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    tracks_total: number;
    owner: string;
    can_import: boolean;
};

export function PlaylistImportPage() {
    const { user, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
    const [loading, setLoading] = useState(true);
    const [importingId, setImportingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    const loadPlaylists = async () => {
        setLoading(true);
        setError(null);
        setNeedsReconnect(false);
        try {
            const { data } = await api.get<{ playlists: SpotifyPlaylist[]; needs_reconnect?: boolean; message?: string }>(
                '/spotify/playlists',
            );
            setPlaylists(data.playlists);
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { message?: string; needs_reconnect?: boolean } } };
            setPlaylists([]);
            setNeedsReconnect(Boolean(axiosErr.response?.data?.needs_reconnect) || !user?.spotify_connected);
            setError(
                axiosErr.response?.data?.message ??
                    'Spotify-Playlists konnten nicht geladen werden. Bitte Spotify erneut verbinden.',
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const spotify = params.get('spotify');
        if (spotify === 'connected') {
            setFlash('Spotify verbunden. Playlists werden geladen…');
            void refreshUser();
            window.history.replaceState({}, '', '/playlists/import');
        } else if (spotify === 'error' || spotify === 'token_failed') {
            setError('Spotify-Verbindung fehlgeschlagen.');
            window.history.replaceState({}, '', '/playlists/import');
        }

        if (user?.spotify_connected) {
            void loadPlaylists();
        } else {
            setLoading(false);
            setNeedsReconnect(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.spotify_connected]);

    const importPlaylist = async (spotifyPlaylistId: string) => {
        setImportingId(spotifyPlaylistId);
        setError(null);
        try {
            const { data } = await api.post<{ data: Playlist; imported_tracks: number }>(
                '/spotify/playlists/import',
                { spotify_playlist_id: spotifyPlaylistId },
            );
            navigate(`/playlists/${data.data.id}`, {
                state: { importedTracks: data.imported_tracks },
            });
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { message?: string; needs_reconnect?: boolean } } };
            if (axiosErr.response?.data?.needs_reconnect) {
                setNeedsReconnect(true);
            }
            setError(axiosErr.response?.data?.message ?? 'Import fehlgeschlagen.');
        } finally {
            setImportingId(null);
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-sm text-muted">
                        <Link to="/playlists" className="hover:text-accent">
                            ← Playlists
                        </Link>
                    </p>
                    <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                        Spotify-Playlist importieren
                    </h1>
                    <p className="mt-2 max-w-2xl text-muted">
                        Tracks werden als neue Songs ohne Songtext angelegt. Importierbar sind eigene und kollaborative
                        Playlists (Spotify Dev-Mode-Einschränkung).
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {user?.spotify_connected && (
                        <Button type="button" variant="outline" onClick={() => void loadPlaylists()} disabled={loading}>
                            <RefreshCw className="h-4 w-4" />
                            Aktualisieren
                        </Button>
                    )}
                    <Button asChild variant="accent">
                        <a href="/spotify/redirect?force=1&redirect=/playlists/import">
                            Spotify {user?.spotify_connected ? 'neu verbinden' : 'verbinden'}
                        </a>
                    </Button>
                </div>
            </div>

            {flash && <Alert variant="success">{flash}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}

            {needsReconnect && (
                <Alert>
                    Für den Import musst du Spotify mit Playlist-Berechtigung verbinden (auch wenn schon verbunden: einmal
                    neu verbinden).
                </Alert>
            )}

            {!user?.spotify_connected ? (
                <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                    <ListMusic className="mx-auto mb-3 h-8 w-8 text-muted" />
                    <p className="text-muted">Zuerst Spotify verbinden, um Playlists zu laden.</p>
                </div>
            ) : loading ? (
                <p className="text-muted">Playlists werden geladen…</p>
            ) : playlists.length === 0 ? (
                <p className="text-muted">Keine Spotify-Playlists gefunden.</p>
            ) : (
                <ul className="divide-y divide-line border-y border-line">
                    {playlists.map((playlist) => {
                        const canImport = playlist.can_import !== false;
                        const busy = importingId === playlist.id;

                        return (
                            <li key={playlist.id} className="flex items-center gap-4 py-4">
                                {playlist.image_url ? (
                                    <img src={playlist.image_url} alt="" className="h-14 w-14 rounded object-cover" />
                                ) : (
                                    <span className="flex h-14 w-14 items-center justify-center rounded bg-paper-2 text-muted">
                                        <ListMusic className="h-5 w-5" />
                                    </span>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">{playlist.name}</p>
                                    <p className="truncate text-sm text-muted">
                                        {playlist.tracks_total} Tracks
                                        {playlist.owner ? ` · ${playlist.owner}` : ''}
                                        {!canImport ? ' · nur Metadaten (fremd)' : ''}
                                    </p>
                                </div>
                                <Badge className="hidden sm:inline-flex">Spotify</Badge>
                                <Button
                                    type="button"
                                    variant="accent"
                                    size="sm"
                                    disabled={busy || !canImport}
                                    title={
                                        canImport
                                            ? 'Playlist importieren'
                                            : 'Nur eigene/kollaborative Playlists können importiert werden'
                                    }
                                    onClick={() => void importPlaylist(playlist.id)}
                                >
                                    <Download className="h-4 w-4" />
                                    {busy ? 'Import…' : 'Importieren'}
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
