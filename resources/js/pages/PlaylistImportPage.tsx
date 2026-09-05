import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, ListMusic, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import {
    activeProviderId,
    hasMusicConnected,
    isProviderConnected,
    providerConnectUrl,
} from '@/lib/music';
import type { MusicProviderId } from '@/music/types';
import type { Playlist } from '@/types';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { invalidateSongListCache } from '@/lib/song-list-cache';
import { AppTooltip } from '@/components/ui/tooltip';
import { ImportPlaylistListSkeleton } from '@/components/skeletons';
import { useI18n } from '@/context/locale-context';

type RemotePlaylist = {
    id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    tracks_total: number;
    owner: string;
    can_import: boolean;
};

const PROVIDER_LABEL: Record<MusicProviderId, string> = {
    spotify: 'Spotify',
    tidal: 'TIDAL',
};

export function PlaylistImportPage() {
    const { user, refreshUser } = useAuth();
    const { t } = useI18n();
    const navigate = useNavigate();
    const availableProviders = useMemo(() => {
        const ids: MusicProviderId[] = ['spotify', 'tidal'];
        return ids.filter((id) => isProviderConnected(user, id));
    }, [user]);

    const [provider, setProvider] = useState<MusicProviderId>(() => activeProviderId(user) ?? 'spotify');
    const [playlists, setPlaylists] = useState<RemotePlaylist[]>([]);
    const [loading, setLoading] = useState(true);
    const [importingId, setImportingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [needsReconnect, setNeedsReconnect] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);
    const connected = isProviderConnected(user, provider);
    const label = PROVIDER_LABEL[provider];

    useEffect(() => {
        if (availableProviders.length === 0) {
            return;
        }
        if (!availableProviders.includes(provider)) {
            setProvider(availableProviders[0]);
        }
    }, [availableProviders, provider]);

    const loadPlaylists = async (nextProvider: MusicProviderId = provider) => {
        setLoading(true);
        setError(null);
        setNeedsReconnect(false);
        try {
            const { data } = await api.get<{ playlists: RemotePlaylist[]; needs_reconnect?: boolean; message?: string }>(
                `/music/${nextProvider}/playlists`,
            );
            setPlaylists(data.playlists);
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { message?: string; needs_reconnect?: boolean } } };
            setPlaylists([]);
            setNeedsReconnect(Boolean(axiosErr.response?.data?.needs_reconnect) || !isProviderConnected(user, nextProvider));
            setError(
                axiosErr.response?.data?.message ?? t('playlists.loadReconnect'),
            );
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const spotify = params.get('spotify');
        const tidal = params.get('tidal');
        if (spotify === 'connected' || tidal === 'connected') {
            const connectedProvider: MusicProviderId = tidal === 'connected' ? 'tidal' : 'spotify';
            setProvider(connectedProvider);
            setFlash(t('playlists.connectedLoading', { label: PROVIDER_LABEL[connectedProvider] }));
            void refreshUser();
            window.history.replaceState({}, '', '/playlists/import');
        } else if (spotify || tidal) {
            setError(t('playlists.connectionFailed'));
            window.history.replaceState({}, '', '/playlists/import');
        }

        if (connected) {
            void loadPlaylists(provider);
        } else {
            setLoading(false);
            setNeedsReconnect(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connected, provider]);

    const importPlaylist = async (playlistId: string) => {
        setImportingId(playlistId);
        setError(null);
        try {
            const { data } = await api.post<{ data: Playlist; imported_tracks: number; lyrics_found?: number }>(
                `/music/${provider}/playlists/import`,
                { playlist_id: playlistId },
            );
            invalidateSongListCache();
            navigate(`/playlists/${data.data.id}`, {
                state: {
                    importedTracks: data.imported_tracks,
                    lyricsFound: data.lyrics_found ?? 0,
                },
            });
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { message?: string; needs_reconnect?: boolean } } };
            if (axiosErr.response?.data?.needs_reconnect) {
                setNeedsReconnect(true);
            }
            setError(axiosErr.response?.data?.message ?? t('playlists.importFailed'));
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
                            {t('playlists.back')}
                        </Link>
                    </p>
                    <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                        {t('playlists.importTitle')}
                    </h1>
                    <p className="mt-2 max-w-2xl text-muted">
                        {t('playlists.importSubtitle')}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {connected && (
                        <Button type="button" variant="outline" onClick={() => void loadPlaylists()} disabled={loading}>
                            <RefreshCw className="h-4 w-4" />
                            {t('common.refresh')}
                        </Button>
                    )}
                    <Button asChild variant="accent">
                        <a href={providerConnectUrl(provider, '/playlists/import', { force: true })}>
                            {connected
                                ? t('playlists.reconnect', { label })
                                : t('playlists.connectLabel', { label })}
                        </a>
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {(['spotify', 'tidal'] as MusicProviderId[]).map((id) => (
                    <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={provider === id ? 'accent' : 'outline'}
                        onClick={() => setProvider(id)}
                    >
                        {isProviderConnected(user, id)
                            ? PROVIDER_LABEL[id]
                            : t('playlists.notConnected', { label: PROVIDER_LABEL[id] })}
                    </Button>
                ))}
            </div>

            {flash && <Alert variant="success">{flash}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}

            {needsReconnect && (
                <Alert>
                    {t('playlists.needConnect', { label })}
                </Alert>
            )}

            {!hasMusicConnected(user) || !connected ? (
                <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                    <ListMusic className="mx-auto mb-3 h-8 w-8 text-muted" />
                    <p className="text-muted">{t('playlists.connectFirst', { label })}</p>
                </div>
            ) : loading ? (
                <ImportPlaylistListSkeleton />
            ) : playlists.length === 0 ? (
                <p className="text-muted">{t('playlists.noneFound')}</p>
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
                                        {t('common.trackCount', { count: playlist.tracks_total })}
                                        {playlist.owner ? t('playlists.ownerSuffix', { name: playlist.owner }) : ''}
                                        {!canImport ? t('playlists.metadataOnly') : ''}
                                    </p>
                                </div>
                                <Badge className="hidden sm:inline-flex">{label}</Badge>
                                <AppTooltip
                                    label={canImport ? t('playlists.importTitle') : t('playlists.importNotPossible')}
                                >
                                    <Button
                                        type="button"
                                        variant="accent"
                                        size="sm"
                                        disabled={busy || !canImport}
                                        onClick={() => void importPlaylist(playlist.id)}
                                    >
                                        <Download className="h-4 w-4" />
                                        {busy ? t('common.importing') : t('common.import')}
                                    </Button>
                                </AppTooltip>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
