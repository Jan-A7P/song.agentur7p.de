import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { useI18n } from '@/context/locale-context';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { providerConnectUrl, providerLabel, providerSupportsPlayback } from '@/lib/music';
import {
    isFavoriteSuggestEnabled,
    setFavoriteSuggestEnabled,
} from '@/lib/favorite-suggest';
import { isPartyModeEnabled, PARTY_MODE_VISIBLE, setPartyModeEnabled, subscribePartyMode } from '@/lib/party-mode';
import { isCarmineModeEnabled, setCarmineModeEnabled, subscribeCarmineMode } from '@/lib/carmine-mode';
import { SettingsSkeleton } from '@/components/skeletons';
import { AccentColorControls } from '@/components/AccentColorPicker';
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
    const { t, locale, setLocale } = useI18n();
    const [providers, setProviders] = useState<ProviderStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [favoriteSuggest, setFavoriteSuggest] = useState(() => isFavoriteSuggestEnabled());
    const [partyMode, setPartyMode] = useState(() => isPartyModeEnabled());
    const [carmineMode, setCarmineMode] = useState(() => isCarmineModeEnabled());

    useEffect(() => subscribePartyMode(setPartyMode), []);
    useEffect(() => subscribeCarmineMode(setCarmineMode), []);

    const load = useCallback(async () => {
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
            setError(axiosMessage(err, t('settings.statusFailed')));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void load();
        const params = new URLSearchParams(window.location.search);
        const spotify = params.get('spotify');
        const tidal = params.get('tidal');
        if (spotify === 'connected' || tidal === 'connected') {
            setFlash(
                t('settings.connectedFlash', {
                    label: tidal === 'connected' ? t('common.tidal') : t('common.spotify'),
                }),
            );
            void refreshUser();
        } else if (spotify || tidal) {
            setFlash(t('settings.connectionFailed'));
            setError(t('settings.connectionFailed'));
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
                    ? t('settings.enabledFlash', { label: providerLabel(provider) })
                    : t('settings.disabledFlash', { label: providerLabel(provider) }),
            );

            void load();
        } catch (err) {
            setError(
                axiosMessage(
                    err,
                    enabled ? t('settings.enableFailed') : t('settings.disableFailed'),
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
            setFlash(t('settings.disconnectedFlash', { label: providerLabel(provider) }));
        } catch (err) {
            setError(axiosMessage(err, t('settings.disconnectFailed')));
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight">{t('settings.title')}</h1>
                <p className="mt-1 text-sm text-muted">
                    {t('settings.subtitle')}
                </p>
            </div>

            {flash && <Alert variant="success">{flash}</Alert>}
            {error && <Alert variant="error">{error}</Alert>}

            <section className="space-y-3">
                <h2 className="text-lg font-medium">{t('settings.services')}</h2>

                {loading && providers.length === 0 ? (
                    <SettingsSkeleton />
                ) : providers.length === 0 ? (
                    <p className="text-sm text-muted">{t('settings.noProviders')}</p>
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
                                            {p.connected ? t('settings.connected') : t('settings.notConnected')}
                                        </Badge>
                                        <Badge
                                            className={
                                                p.connected && p.enabled
                                                    ? 'border-accent/20 bg-accent/10 text-accent'
                                                    : undefined
                                            }
                                        >
                                            {p.connected && p.enabled ? t('common.active') : t('common.inactive')}
                                        </Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-muted">
                                        {!p.configured
                                            ? t('settings.notConfigured', { label: p.label })
                                            : !p.connected
                                              ? providerSupportsPlayback(p.provider)
                                                  ? t('settings.connectToUse')
                                                  : t('settings.connectToUseCatalog')
                                              : p.enabled
                                                ? providerSupportsPlayback(p.provider)
                                                    ? t('settings.activeHint')
                                                    : t('settings.activeHintCatalog')
                                                : t('settings.inactiveHint')}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    {p.connected ? (
                                        <>
                                            <div className="flex items-center gap-2">
                                                <Label htmlFor={switchId} className="text-sm text-muted">
                                                    {t('common.active')}
                                                </Label>
                                                <Switch
                                                    id={switchId}
                                                    checked={p.enabled}
                                                    disabled={toggling}
                                                    aria-label={t('settings.enableAria', { label: p.label })}
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
                                                {busy === `${p.provider}:disconnect`
                                                    ? t('common.disconnecting')
                                                    : t('common.disconnect')}
                                            </Button>
                                        </>
                                    ) : (
                                        <Button asChild disabled={!p.configured}>
                                            <a href={providerConnectUrl(p.provider, '/settings')}>
                                                {t('common.connect')}
                                            </a>
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </section>

            <section className="space-y-3">
                <h2 className="text-lg font-medium">{t('settings.playback')}</h2>
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3">
                    <div className="min-w-0 flex-1">
                        <p className="font-medium">{t('settings.favoriteSuggest')}</p>
                        <p className="mt-1 text-sm text-muted">
                            {t('settings.favoriteSuggestBody')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="favorite-suggest" className="text-sm text-muted">
                            {t('common.active')}
                        </Label>
                        <Switch
                            id="favorite-suggest"
                            checked={favoriteSuggest}
                            aria-label={t('settings.favoriteSuggestAria')}
                            onCheckedChange={(next) => {
                                setFavoriteSuggest(next);
                                setFavoriteSuggestEnabled(next);
                            }}
                        />
                    </div>
                </div>
                {PARTY_MODE_VISIBLE ? (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3">
                    <div className="min-w-0 flex-1">
                        <p className="font-medium">{t('settings.party')}</p>
                        <p className="mt-1 text-sm text-muted">
                            {t('settings.partyBody')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="party-mode" className="text-sm text-muted">
                            {t('common.active')}
                        </Label>
                        <Switch
                            id="party-mode"
                            checked={partyMode}
                            aria-label={t('settings.partyAria')}
                            onCheckedChange={(next) => {
                                setPartyMode(next);
                                setPartyModeEnabled(next);
                            }}
                        />
                    </div>
                </div>
                ) : null}
            </section>

            <section className="space-y-3">
                <h2 className="text-lg font-medium">{t('language.label')}</h2>
                <p className="text-sm text-muted">{t('language.description')}</p>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant={locale === 'de' ? 'accent' : 'outline'}
                        onClick={() => setLocale('de')}
                    >
                        {t('language.de')}
                    </Button>
                    <Button
                        type="button"
                        variant={locale === 'en' ? 'accent' : 'outline'}
                        onClick={() => setLocale('en')}
                    >
                        {t('language.en')}
                    </Button>
                </div>
            </section>

            <section className="space-y-3">
                <h2 className="text-lg font-medium">{t('settings.appearance')}</h2>
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3">
                    <div className="min-w-0 flex-1">
                        <p className="font-medium">{t('settings.carmine')}</p>
                        <p className="mt-1 text-sm text-muted">
                            {t('settings.carmineBody')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="carmine-mode" className="text-sm text-muted">
                            {t('common.active')}
                        </Label>
                        <Switch
                            id="carmine-mode"
                            checked={carmineMode}
                            aria-label={t('settings.carmineAria')}
                            onCheckedChange={(next) => {
                                setCarmineMode(next);
                                setCarmineModeEnabled(next);
                            }}
                        />
                    </div>
                </div>
                <p className="text-sm text-muted">{t('accent.description')}</p>
                <div className="rounded-2xl border border-line bg-surface px-3 py-3">
                    <p className="font-medium">{t('accent.label')}</p>
                    <AccentColorControls className="mt-3" />
                </div>
            </section>
        </div>
    );
}
