import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import api from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AppTooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/context/locale-context';
import { providerLabel } from '@/lib/music';
import type { MusicProviderId } from '@/music/types';
import type { ProviderTrack } from '@/types';
import { cn } from '@/lib/utils';

type Props = {
    providers?: MusicProviderId[];
    provider?: MusicProviderId;
    value: ProviderTrack | null;
    onChange: (track: ProviderTrack | null) => void;
};

export function ProviderTrackPicker({
    providers,
    provider: providerProp = 'spotify',
    value,
    onChange,
}: Props) {
    const availableKey = (providers && providers.length > 0 ? providers : [providerProp]).join(',');
    const available = (availableKey ? availableKey.split(',') : []) as MusicProviderId[];
    const { t } = useI18n();
    const [provider, setProvider] = useState<MusicProviderId>(() => {
        if (value?.provider && available.includes(value.provider)) {
            return value.provider;
        }
        return available[0] ?? providerProp;
    });
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ProviderTrack[]>([]);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const label = provider ? providerLabel(provider) : t('common.music');

    useEffect(() => {
        if (available.length === 0) {
            return;
        }
        if (!available.includes(provider)) {
            setProvider(available[0]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [availableKey, provider]);

    useEffect(() => {
        if (!query.trim() || !provider) {
            setResults([]);
            setError(null);
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setSearching(true);
            setError(null);
            try {
                const { data } = await api.get<{ tracks: ProviderTrack[] }>(`/music/${provider}/search`, {
                    params: { q: query },
                    signal: controller.signal,
                });
                setResults(data.tracks);
            } catch {
                if (!controller.signal.aborted) {
                    setError(t('search.searchFailed'));
                    setResults([]);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setSearching(false);
                }
            }
        }, 300);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [query, provider]);

    if (available.length === 0) {
        return (
            <p className="rounded-xl border border-dashed border-line bg-surface/60 px-3 py-3 text-xs text-muted">
                {t('search.noActiveService')}
            </p>
        );
    }

    if (value) {
        const valueLabel = providerLabel(value.provider);
        return (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2">
                {value.album_art_url ? (
                    <img src={value.album_art_url} alt="" className="h-10 w-10 rounded object-cover" />
                ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-paper-2 text-xs text-muted">{t('common.dash')}</div>
                )}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{value.name}</p>
                    <p className="truncate text-xs text-muted">{value.artist}</p>
                </div>
                <Badge className="border-accent/20 bg-accent/10 text-accent">{valueLabel}</Badge>
                <AppTooltip label={t('search.removeTrack')}>
                    <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label={t('search.removeTrack')}>
                        <X className="h-4 w-4" />
                    </Button>
                </AppTooltip>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {available.length > 1 && (
                <div className="flex flex-wrap gap-2">
                    {available.map((id) => (
                        <Button
                            key={id}
                            type="button"
                            size="sm"
                            variant={provider === id ? 'default' : 'outline'}
                            onClick={() => {
                                setProvider(id);
                                setQuery('');
                                setResults([]);
                                setError(null);
                            }}
                        >
                            {providerLabel(id)}
                        </Button>
                    ))}
                </div>
            )}

            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <Input
                    className="pl-9"
                    placeholder={t('search.searchProvider', { label })}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            {query.trim() && (
                <div className={cn('max-h-64 overflow-y-auto rounded-xl border border-line bg-surface')}>
                    {searching ? (
                        <p className="px-3 py-3 text-sm text-muted">{t('common.searching')}</p>
                    ) : results.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-muted">{t('search.noResults')}</p>
                    ) : (
                        <ul className="divide-y divide-line">
                            {results.map((track) => (
                                <li key={`${track.provider}-${track.id}`}>
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-paper-2"
                                        onClick={() => onChange(track)}
                                    >
                                        {track.album_art_url ? (
                                            <img src={track.album_art_url} alt="" className="h-10 w-10 rounded object-cover" />
                                        ) : (
                                            <div className="flex h-10 w-10 items-center justify-center rounded bg-paper-2 text-xs text-muted">
                                                {t('common.dash')}
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{track.name}</p>
                                            <p className="truncate text-xs text-muted">{track.artist}</p>
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

/** @deprecated use ProviderTrackPicker */
export const SpotifyTrackPicker = ProviderTrackPicker;
