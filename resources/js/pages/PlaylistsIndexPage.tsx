import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ListMusic, Plus } from 'lucide-react';
import api from '@/lib/api';
import type { Paginated, Playlist } from '@/types';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export function PlaylistsIndexPage() {
    const { user } = useAuth();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mineOnly, setMineOnly] = useState(false);

    useEffect(() => {
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const { data } = await api.get<Paginated<Playlist>>('/playlists', {
                    params: mineOnly && user ? { mine: 1 } : undefined,
                });
                setPlaylists(data.data);
            } catch {
                setError('Playlists konnten nicht geladen werden.');
            } finally {
                setLoading(false);
            }
        })();
    }, [mineOnly, user]);

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                    <h1 className="font-display text-4xl font-semibold tracking-tight">Playlists</h1>
                    <p className="max-w-xl text-muted">Sammlungen von Songs – sortierbar per Drag & Drop.</p>
                </div>
                {user && (
                    <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline">
                            <Link to="/playlists/import">
                                <Download className="h-4 w-4" />
                                Spotify importieren
                            </Link>
                        </Button>
                        <Button asChild variant="accent">
                            <Link to="/playlists/create">
                                <Plus className="h-4 w-4" />
                                Neue Playlist
                            </Link>
                        </Button>
                    </div>
                )}
            </div>

            {user && (
                <div className="flex gap-2">
                    <Button type="button" size="sm" variant={mineOnly ? 'outline' : 'default'} onClick={() => setMineOnly(false)}>
                        Alle
                    </Button>
                    <Button type="button" size="sm" variant={mineOnly ? 'default' : 'outline'} onClick={() => setMineOnly(true)}>
                        Meine
                    </Button>
                </div>
            )}

            {error && <Alert variant="error">{error}</Alert>}

            {loading ? (
                <p className="text-muted">Laden…</p>
            ) : playlists.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                    <ListMusic className="mx-auto mb-3 h-8 w-8 text-muted" />
                    <p className="text-muted">Noch keine Playlists vorhanden.</p>
                    {user && (
                        <Button asChild variant="accent" className="mt-4">
                            <Link to="/playlists/create">Erste Playlist erstellen</Link>
                        </Button>
                    )}
                </div>
            ) : (
                <ul className="divide-y divide-line border-y border-line">
                    {playlists.map((playlist) => (
                        <li key={playlist.id}>
                            <Link
                                to={`/playlists/${playlist.id}`}
                                className="group -mx-3 flex items-center gap-4 rounded-lg px-3 py-4 transition hover:bg-surface"
                            >
                                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-paper-2 text-muted">
                                    <ListMusic className="h-5 w-5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">{playlist.name}</p>
                                    <p className="truncate text-sm text-muted">
                                        {playlist.songs_count ?? 0} Songs
                                        {playlist.user ? ` · ${playlist.user.name}` : ''}
                                    </p>
                                </div>
                                {user?.id === playlist.user_id && <Badge>Meine</Badge>}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
