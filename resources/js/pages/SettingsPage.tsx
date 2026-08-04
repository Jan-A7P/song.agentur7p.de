import { useEffect, useState } from 'react';
import axios from 'axios';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { providerConnectUrl, providerLabel } from '@/lib/music';
import type { MusicProviderId } from '@/music/types';
import type { MusicConnectionStatus, User } from '@/types';

type ProviderStatus = {
    provider: MusicProviderId;
    label: string;
    configured: boolean;
    connected: boolean;
    enabled: boolean;
};

function axiosMessage(err: unknown, fallback: string): string {
    if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
        const firstError = data?.errors ? Object.values(data.errors)[0]?.[0] : undefined;
        return firstError || data?.message || fallback;
    }
    if (err instanceof Error && err.message) {
        return err.message;
    }
    return fallback;
}

export function SettingsPage() {
    const { refreshUser, setUser } = useAuth();
    const [providers, setProviders] = useState<ProviderStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

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
                        enabled: boolean;
                    }>(`/music/${p.id}/status`);
                    return {
                        provider: data.provider,
                        label: data.label,
                        configured: data.configured,
                        connected: Boolean(data.connected),
                        enabled: Boolean(data.enabled),
                    };
                }),
            );
            setProviders(statuses);
        } catch (err) {
            setError(axiosMessage(err, 'Status konnte nicht geladen werden.'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        const params = new URLSearchParams(window.location.search);
        const spotify = params.get('spotify');
        const tidal = params.get('tidal');
        if (spotify === 'connected' || tidal === 'connected') {
            setFlash(`${tidal === 'connected' ? 'TIDAL' : 'Spotify'} erfolgreich verbunden.`);
            void refreshUser();
        } else if (spotify || tidal) {
            setFlash('Verbindung fehlgeschlagen oder abgebrochen.');
            setError('Verbindung fehlgeschlagen oder abgebrochen.');
        }
        if (spotify || tidal) {
            window.history.replaceState({}, '', '/settings');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyConnectionPayload = (
        musicConnections: MusicConnectionStatus[],
        activeProvider: MusicProviderId | null | undefined,
    ) => {
        setUser((prev: User | null) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                music_connections: musicConnections,
                active_provider: activeProvider ?? null,
                spotify_connected: musicConnections.some(
                    (c) => c.provider === 'spotify' && c.connected && c.enabled !== false,
                ),
            };
        });
    };

    const onToggleEnabled = async (provider: MusicProviderId, enabled: boolean) => {
        setBusy(`${provider}:enabled`);
        setError(null);
        try {
            const { data } = await api.post<{
                provider: MusicProviderId;
                connected: boolean;
                enabled: boolean;
                active_provider: MusicProviderId | null;
                music_connections: MusicConnectionStatus[];
            }>(`/music/${provider}/enabled`, { enabled });

            if (data.music_connections) {
                applyConnectionPayload(data.music_connections, data.active_provider);
            } else {
                await refreshUser();
            }

            setProviders((prev) =>
                prev.map((p) =>
                    p.provider === provider
                        ? { ...p, connected: true, enabled: Boolean(data.enabled) }
                        : p,
                ),
            );

            setFlash(
                data.enabled
                    ? `${providerLabel(provider)} aktiviert.`
                    : `${providerLabel(provider)} deaktiviert. Die Verbindung bleibt erhalten.`,
            );

            void load();
        } catch (err) {
            setError(
                axiosMessage(
                    err,
                    enabled ? 'Aktivieren fehlgeschlagen.' : 'Deaktivieren fehlgeschlagen.',
                ),
            );
        } finally {
            setBusy(null);
        }
    };

    const onDisconnect = async (provider: MusicProviderId) => {
        setBusy(`${provider}:disconnect`);
        setError(null);
        try {
            await api.post(`/music/${provider}/disconnect`);
            await refreshUser();
            await load();
            setFlash(`${providerLabel(provider)} getrennt.`);
        } catch (err) {
            setError(axiosMessage(err, 'Trennen fehlgeschlagen.'));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Einstellungen</h1>
                <p className="mt-1 text-sm text-muted">
                    Verbinde Musikdienste und aktiviere sie für Wiedergabe — ohne die OAuth-Verbindung zu verlieren.
                </p>
            </div>

            {flash && <Alert variant="success">{flash}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}

            <section className="space-y-3">
                <h2 className="text-lg font-medium">Musikdienste</h2>

                {loading && providers.length === 0 ? (
                    <p className="text-sm text-muted">Laden…</p>
                ) : providers.length === 0 ? (
                    <p className="text-sm text-muted">Keine Anbieter verfügbar.</p>
                ) : (
                    providers.map((p) => {
                        const switchId = `provider-enabled-${p.provider}`;
                        const toggling = busy === `${p.provider}:enabled`;

                        return (
                            <div
                                key={p.provider}
                                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium">{p.label}</p>
                                        <Badge
                                            className={
                                                p.connected
                                                    ? 'border-accent/20 bg-accent/10 text-accent'
                                                    : undefined
                                            }
                                        >
                                            {p.connected ? 'Verbunden' : 'Nicht verbunden'}
                                        </Badge>
                                        <Badge
                                            className={
                                                p.connected && p.enabled
                                                    ? 'border-accent/20 bg-accent/10 text-accent'
                                                    : undefined
                                            }
                                        >
                                            {p.connected && p.enabled ? 'Aktiv' : 'Inaktiv'}
                                        </Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-muted">
                                        {!p.configured
                                            ? `${p.label} ist serverseitig nicht konfiguriert.`
                                            : !p.connected
                                              ? 'Verbinden, um Wiedergabe und Import zu nutzen.'
                                              : p.enabled
                                                ? 'Aktiv für Wiedergabe und Import. Deaktivieren lässt die Verbindung bestehen.'
                                                : 'Verbunden, aber inaktiv — Tokens bleiben gespeichert.'}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    {p.connected ? (
                                        <>
                                            <div className="flex items-center gap-2">
                                                <Label htmlFor={switchId} className="text-sm text-muted">
                                                    Aktiv
                                                </Label>
                                                <Switch
                                                    id={switchId}
                                                    checked={p.enabled}
                                                    disabled={toggling}
                                                    aria-label={`${p.label} aktivieren`}
                                                    onCheckedChange={(next) =>
                                                        void onToggleEnabled(p.provider, next)
                                                    }
                                                />
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={busy === `${p.provider}:disconnect`}
                                                onClick={() => void onDisconnect(p.provider)}
                                            >
                                                {busy === `${p.provider}:disconnect` ? 'Trennen…' : 'Trennen'}
                                            </Button>
                                        </>
                                    ) : (
                                        <Button asChild disabled={!p.configured}>
                                            <a href={providerConnectUrl(p.provider, '/settings')}>Verbinden</a>
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </section>
        </div>
    );
}
