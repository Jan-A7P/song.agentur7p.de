import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function SettingsPage() {
    const { refreshUser } = useAuth();
    const [connected, setConnected] = useState(false);
    const [configured, setConfigured] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState(false);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await api.get<{ configured: boolean; connected: boolean }>('/spotify/status');
            setConnected(data.connected);
            setConfigured(data.configured);
        } catch {
            setError('Status konnte nicht geladen werden.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        const params = new URLSearchParams(window.location.search);
        const spotify = params.get('spotify');
        if (spotify === 'connected') {
            setFlash('Spotify erfolgreich verbunden.');
            void refreshUser();
        } else if (spotify) {
            setFlash('Verbindung fehlgeschlagen oder abgebrochen.');
            setError('Verbindung fehlgeschlagen oder abgebrochen.');
        }
        if (spotify) {
            window.history.replaceState({}, '', '/settings');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onDisconnect = async () => {
        setDisconnecting(true);
        setError(null);
        try {
            await api.post('/spotify/disconnect');
            await refreshUser();
            await load();
            setFlash('Spotify getrennt.');
        } catch {
            setError('Trennen fehlgeschlagen.');
        } finally {
            setDisconnecting(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Einstellungen</h1>
                <p className="mt-1 text-sm text-muted">Verbinde deinen Spotify-Account, um Songs abzuspielen.</p>
            </div>

            {flash && <Alert variant="success">{flash}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}

            <section className="space-y-3">
                <h2 className="text-lg font-medium">Spotify-Verbindung</h2>

                {loading ? (
                    <p className="text-sm text-muted">Laden…</p>
                ) : (
                    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">Spotify</p>
                                {connected ? (
                                    <Badge className="border-accent/20 bg-accent/10 text-accent">Verbunden</Badge>
                                ) : (
                                    <Badge>Nicht verbunden</Badge>
                                )}
                            </div>
                            <p className="text-xs text-muted">
                                {connected
                                    ? 'Songs mit verknüpftem Spotify-Track können abgespielt werden.'
                                    : configured
                                      ? 'Verbinde deinen Account, um Songs abzuspielen.'
                                      : 'Nicht konfiguriert (fehlende Env-Keys).'}
                            </p>
                        </div>

                        {connected ? (
                            <Button type="button" variant="outline" size="sm" disabled={disconnecting} onClick={() => void onDisconnect()}>
                                Trennen
                            </Button>
                        ) : (
                            <Button asChild variant="accent" size="sm" disabled={!configured}>
                                <a href="/spotify/redirect?redirect=/settings">Verbinden</a>
                            </Button>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
