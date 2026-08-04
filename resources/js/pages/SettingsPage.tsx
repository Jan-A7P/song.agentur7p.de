import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { providerConnectUrl } from '@/lib/music';
import type { MusicProviderId } from '@/music/types';

type ProviderStatus = {
    provider: MusicProviderId;
    label: string;
    configured: boolean;
    connected: boolean;
};

export function SettingsPage() {
    const { refreshUser } = useAuth();
    const [providers, setProviders] = useState<ProviderStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data: list } = await api.get<{ providers: { id: MusicProviderId; label: string; configured: boolean }[] }>(
                '/music/providers',
            );
            const statuses = await Promise.all(
                list.providers.map(async (p) => {
                    const { data } = await api.get<{
                        provider: MusicProviderId;
                        label: string;
                        configured: boolean;
                        connected: boolean;
                    }>(`/music/${p.id}/status`);
                    return {
                        provider: data.provider,
                        label: data.label,
                        configured: data.configured,
                        connected: data.connected,
                    };
                }),
            );
            setProviders(statuses);
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

    const onDisconnect = async (provider: MusicProviderId) => {
        setDisconnecting(provider);
        setError(null);
        try {
            await api.post(`/music/${provider}/disconnect`);
            await refreshUser();
            await load();
            setFlash(`${provider === 'spotify' ? 'Spotify' : provider} getrennt.`);
        } catch {
            setError('Trennen fehlgeschlagen.');
        } finally {
            setDisconnecting(null);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Einstellungen</h1>
                <p className="mt-1 text-sm text-muted">Verbinde einen Musikdienst, um Songs abzuspielen.</p>
            </div>

            {flash && <Alert variant="success">{flash}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}

            <section className="space-y-3">
                <h2 className="text-lg font-medium">Musikdienste</h2>

                {loading ? (
                    <p className="text-sm text-muted">Laden…</p>
                ) : providers.length === 0 ? (
                    <p className="text-sm text-muted">Keine Anbieter verfügbar.</p>
                ) : (
                    providers.map((p) => (
                        <div
                            key={p.provider}
                            className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="font-medium">{p.label}</p>
                                    <Badge className={p.connected ? 'border-accent/20 bg-accent/10 text-accent' : undefined}>
                                        {p.connected ? 'Verbunden' : 'Nicht verbunden'}
                                    </Badge>
                                </div>
                                <p className="mt-1 text-sm text-muted">
                                    {!p.configured
                                        ? `${p.label} ist serverseitig nicht konfiguriert.`
                                        : p.connected
                                          ? 'Songs mit verknüpftem Track können abgespielt werden.'
                                          : 'Verbinden, um Wiedergabe und Import zu nutzen.'}
                                </p>
                            </div>
                            {p.connected ? (
                                <Button
                                    variant="outline"
                                    disabled={disconnecting === p.provider}
                                    onClick={() => void onDisconnect(p.provider)}
                                >
                                    {disconnecting === p.provider ? 'Trennen…' : 'Trennen'}
                                </Button>
                            ) : (
                                <Button asChild disabled={!p.configured}>
                                    <a href={providerConnectUrl(p.provider, '/settings')}>Verbinden</a>
                                </Button>
                            )}
                        </div>
                    ))
                )}
            </section>
        </div>
    );
}
