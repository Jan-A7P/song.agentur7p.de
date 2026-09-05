import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Download, Loader2, Pause, Play, Star, TimerReset, X } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ProviderTrackPicker } from '@/components/ProviderTrackPicker';
import {
    looksLikeLrc,
    lyricsToEditableLines,
    serializeEditableLines,
    type EditableLyricLine,
} from '@/lib/lrc';
import { usePlayer, formatTimePrecise } from '@/context/player-context';
import { connectedProviderIds, providerLabel, providerTrackUri } from '@/lib/music';
import { songProviderLinks } from '@/lib/playable';
import type { MusicProviderId } from '@/music/types';
import type { ProviderTrack, Song, SongProviderLink } from '@/types';
import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/context/locale-context';

export type SongFormValues = {
    title: string;
    artist: string;
    lyrics: string;
    duration_ms: number | null;
    provider: string | null;
    preferred_provider: string | null;
    provider_track_id: string | null;
    provider_uri: string | null;
    album_art_url: string | null;
    providers: SongProviderLink[];
};

type Props = {
    initial?: Partial<Song>;
    submitLabel: string;
    onSubmit: (values: SongFormValues) => Promise<void>;
};

type LyricsLookupResponse = {
    lyrics: string;
    synced: boolean;
    source: string;
};

function initialLinks(initial?: Partial<Song>): SongProviderLink[] {
    if (!initial) {
        return [];
    }
    return songProviderLinks(initial as Song);
}

export function SongForm({ initial, submitLabel, onSubmit }: Props) {
    const { user } = useAuth();
    const { t } = useI18n();
    const { track: playerTrack, playing, positionMs, playTrack, toggle } = usePlayer();
    const [title, setTitle] = useState(initial?.title ?? '');
    const [artist, setArtist] = useState(initial?.artist ?? '');
    const [lyrics, setLyrics] = useState(initial?.lyrics ?? '');
    const [lines, setLines] = useState<EditableLyricLine[]>(() => lyricsToEditableLines(initial?.lyrics ?? ''));
    const [timingMode, setTimingMode] = useState(false);
    const [activeLine, setActiveLine] = useState(0);
    const [links, setLinks] = useState<SongProviderLink[]>(() => initialLinks(initial));
    const [preferredProvider, setPreferredProvider] = useState<MusicProviderId | null>(
        () =>
            (initial?.preferred_provider as MusicProviderId | null | undefined) ??
            initialLinks(initial)[0]?.provider ??
            null,
    );
    const [durationMs, setDurationMs] = useState<number | null>(() =>
        initial?.duration_ms && initial.duration_ms > 0 ? initial.duration_ms : null,
    );
    const [error, setError] = useState<string | null>(null);
    const [lyricsStatus, setLyricsStatus] = useState<string | null>(null);
    const [fetchingLyrics, setFetchingLyrics] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const lyricsRef = useRef(lyrics);
    const titleRef = useRef(title);
    const artistRef = useRef(artist);

    const preferredLink = useMemo(
        () => links.find((l) => l.provider === preferredProvider) ?? links[0] ?? null,
        [links, preferredProvider],
    );

    const activeProviders = useMemo(() => connectedProviderIds(user), [user]);
    const searchProviders = activeProviders;

    useEffect(() => {
        lyricsRef.current = lyrics;
    }, [lyrics]);

    useEffect(() => {
        titleRef.current = title;
    }, [title]);

    useEffect(() => {
        artistRef.current = artist;
    }, [artist]);

    const composedLyrics = useMemo(
        () => (timingMode ? serializeEditableLines(lines) : lyrics),
        [timingMode, lines, lyrics],
    );
    const isLrc = useMemo(() => looksLikeLrc(composedLyrics), [composedLyrics]);

    useEffect(() => {
        if (!timingMode) {
            setLyrics(serializeEditableLines(lines));
        }
    }, [lines, timingMode]);

    const applyFetchedLyrics = (nextLyrics: string, synced: boolean) => {
        setLyrics(nextLyrics);
        if (timingMode) {
            setLines(lyricsToEditableLines(nextLyrics));
            setActiveLine(0);
        }
        setLyricsStatus(synced ? t('form.lyricsSynced') : t('form.lyricsPlain'));
    };

    const fetchLyrics = async (options?: {
        title?: string;
        artist?: string;
        durationMs?: number | null;
        force?: boolean;
    }) => {
        const lookupTitle = (options?.title ?? titleRef.current).trim();
        const lookupArtist = (options?.artist ?? artistRef.current).trim();

        if (!lookupTitle || !lookupArtist) {
            setError(t('form.needTitleArtist'));
            return;
        }

        const currentLyrics = lyricsRef.current.trim();
        if (currentLyrics && !options?.force) {
            return;
        }

        if (currentLyrics && options?.force) {
            const confirmed = window.confirm(t('form.overwriteLyrics'));
            if (!confirmed) {
                return;
            }
        }

        setFetchingLyrics(true);
        setError(null);
        setLyricsStatus(null);

        try {
            const { data } = await api.get<LyricsLookupResponse>('/lyrics/lookup', {
                params: {
                    title: lookupTitle,
                    artist: lookupArtist,
                    duration_ms: options?.durationMs || undefined,
                },
            });
            applyFetchedLyrics(data.lyrics, data.synced);
        } catch (err) {
            let message = t('form.noLyricsFound');
            if (axios.isAxiosError(err)) {
                message = (err.response?.data as { message?: string } | undefined)?.message ?? message;
            }
            if (options?.force) {
                setError(message);
            } else {
                setLyricsStatus(message);
            }
        } finally {
            setFetchingLyrics(false);
        }
    };

    const enterTimingMode = () => {
        const nextLines = lyricsToEditableLines(lyrics).filter((line) => line.text.trim().length > 0);
        setLines(nextLines.length > 0 ? nextLines : [{ timeMs: null, text: '' }]);
        setActiveLine(0);
        setTimingMode(true);
    };

    const exitTimingMode = () => {
        setLyrics(serializeEditableLines(lines));
        setTimingMode(false);
    };

    const stampLine = (index: number) => {
        setLines((prev) =>
            prev.map((line, i) => (i === index ? { ...line, timeMs: Math.max(0, Math.floor(positionMs)) } : line)),
        );
        setActiveLine((prev) => Math.min(prev + 1, lines.length - 1));
    };

    const ensurePlaying = async () => {
        if (!preferredLink) {
            setError(t('form.linkTrackFirst'));
            return;
        }

        const playUri =
            preferredLink.provider_uri ||
            providerTrackUri(preferredLink.provider, preferredLink.provider_track_id);
        const isCurrent = playerTrack?.uri === playUri;
        if (isCurrent) {
            if (!playing) {
                await toggle();
            }
            return;
        }

        await playTrack({
            provider: preferredLink.provider,
            trackId: preferredLink.provider_track_id,
            uri: playUri,
            title: title || preferredLink.provider,
            artist: artist,
            albumArtUrl: preferredLink.album_art_url ?? null,
            songId: initial?.id,
            lyrics: timingMode ? serializeEditableLines(lines) : lyrics,
        }, { radio: false });
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const finalLyrics = timingMode ? serializeEditableLines(lines) : lyrics;
            const preferred = preferredLink;
            await onSubmit({
                title,
                artist,
                lyrics: finalLyrics,
                duration_ms: durationMs,
                provider: preferred?.provider ?? null,
                preferred_provider: preferred?.provider ?? null,
                provider_track_id: preferred?.provider_track_id ?? null,
                provider_uri: preferred?.provider_uri ?? null,
                album_art_url: preferred?.album_art_url ?? initial?.album_art_url ?? null,
                providers: links,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : t('songs.saveFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    const onTrackChange = (next: ProviderTrack | null) => {
        if (!next) {
            return;
        }

        if (!activeProviders.includes(next.provider)) {
            setError(t('form.providerInactive', { provider: providerLabel(next.provider) }));
            return;
        }

        const link: SongProviderLink = {
            provider: next.provider,
            provider_track_id: next.id,
            provider_uri: next.uri || providerTrackUri(next.provider, next.id),
            album_art_url: next.album_art_url,
        };

        setLinks((prev) => {
            const without = prev.filter((l) => l.provider !== next.provider);
            return [...without, link];
        });
        setPreferredProvider((prev) => prev ?? next.provider);

        if (next.duration_ms && next.duration_ms > 0) {
            setDurationMs((prev) => prev ?? next.duration_ms ?? null);
        }

        const nextTitle = titleRef.current || next.name;
        const nextArtist = artistRef.current || next.artist;
        if (!titleRef.current) {
            setTitle(next.name);
        }
        if (!artistRef.current) {
            setArtist(next.artist);
        }

        void fetchLyrics({
            title: nextTitle,
            artist: nextArtist,
            durationMs: next.duration_ms ?? durationMs,
            force: false,
        });
    };

    const removeLink = (provider: MusicProviderId) => {
        setLinks((prev) => {
            const next = prev.filter((l) => l.provider !== provider);
            setPreferredProvider((current) => {
                if (current !== provider) {
                    return current;
                }
                return next[0]?.provider ?? null;
            });
            return next;
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error && <Alert variant="error">{error}</Alert>}
            {lyricsStatus && !error && (
                <Alert
                    variant={
                        lyricsStatus === t('form.lyricsSynced') || lyricsStatus === t('form.lyricsPlain')
                            ? 'success'
                            : 'default'
                    }
                >
                    {lyricsStatus}
                </Alert>
            )}

            <div className="space-y-2">
                <Label htmlFor="title">{t('form.title')}</Label>
                <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="space-y-2">
                <Label htmlFor="artist">{t('form.artist')}</Label>
                <Input
                    id="artist"
                    required
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder={t('form.artistPlaceholder')}
                />
                <p className="text-xs text-muted">{t('form.artistHint')}</p>
            </div>

            <div className="space-y-2">
                <Label>{t('form.linkTracks')}</Label>
                <p className="text-xs text-muted">{t('form.linkTracksHint')}</p>

                {links.length > 0 && (
                    <div
                        role="radiogroup"
                        aria-label={t('form.preferredService')}
                        className="space-y-2"
                    >
                        {links.map((link) => {
                            const isPreferred = preferredProvider === link.provider;
                            const preferId = `preferred-${link.provider}`;
                            const isActive = activeProviders.includes(link.provider);

                            return (
                                <div
                                    key={link.provider}
                                    className={cn(
                                        'flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-3 transition-colors',
                                        isPreferred
                                            ? 'border-accent/40 bg-accent/5 ring-1 ring-accent/15'
                                            : 'border-line bg-surface hover:border-accent/25',
                                        !isActive && 'opacity-70',
                                    )}
                                >
                                    {link.album_art_url ? (
                                        <img
                                            src={link.album_art_url}
                                            alt=""
                                            className="h-11 w-11 shrink-0 rounded-lg object-cover"
                                        />
                                    ) : (
                                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-paper-2 text-[10px] font-medium text-muted">
                                            {providerLabel(link.provider).slice(0, 2).toUpperCase()}
                                        </div>
                                    )}

                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium">
                                                {providerLabel(link.provider)}
                                            </span>
                                            {isPreferred && (
                                                <Badge className="border-accent/20 bg-accent/10 text-accent">
                                                    {t('common.preferred')}
                                                </Badge>
                                            )}
                                            {!isActive && (
                                                <Badge>{t('common.inactive')}</Badge>
                                            )}
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-muted">
                                            {link.provider_uri}
                                        </p>
                                    </div>

                                    <button
                                        type="button"
                                        id={preferId}
                                        role="radio"
                                        aria-checked={isPreferred}
                                        aria-label={t('form.setPreferred', { provider: providerLabel(link.provider) })}
                                        onClick={() => setPreferredProvider(link.provider)}
                                        className={cn(
                                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                                            isPreferred
                                                ? 'border-accent/35 bg-accent text-white shadow-sm'
                                                : 'border-line bg-paper-2 text-muted hover:border-accent/30 hover:text-ink',
                                        )}
                                    >
                                        <Star
                                            className={cn(
                                                'h-3.5 w-3.5',
                                                isPreferred && 'fill-current',
                                            )}
                                            aria-hidden
                                        />
                                        {isPreferred ? t('common.preferred') : t('form.prefer')}
                                    </button>

                                    <AppTooltip label={t('form.removeProvider', { provider: providerLabel(link.provider) })}>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 shrink-0"
                                            aria-label={t('form.removeProvider', { provider: providerLabel(link.provider) })}
                                            onClick={() => removeLink(link.provider)}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </AppTooltip>
                                </div>
                            );
                        })}
                    </div>
                )}

                {searchProviders.length > 0 ? (
                    <ProviderTrackPicker
                        providers={searchProviders}
                        value={null}
                        onChange={onTrackChange}
                    />
                ) : (
                    <p className="rounded-xl border border-dashed border-line bg-surface/60 px-3 py-3 text-xs text-muted">
                        {t('form.noActiveService')}
                    </p>
                )}
            </div>

            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="lyrics">{t('form.lyrics')}</Label>
                    <div className="flex flex-wrap items-center gap-2">
                        {isLrc && <Badge className="border-accent/20 bg-accent/10 text-accent">{t('form.lrcDetected')}</Badge>}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={fetchingLyrics || !title.trim() || !artist.trim()}
                            onClick={() =>
                                void fetchLyrics({
                                    durationMs: undefined,
                                    force: true,
                                })
                            }
                        >
                            {fetchingLyrics ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="h-4 w-4" />
                            )}
                            {t('form.fetchLyrics')}
                        </Button>
                        {!timingMode ? (
                            <Button type="button" size="sm" variant="outline" onClick={enterTimingMode}>
                                {t('form.setTimestamps')}
                            </Button>
                        ) : (
                            <Button type="button" size="sm" variant="outline" onClick={exitTimingMode}>
                                {t('form.textView')}
                            </Button>
                        )}
                    </div>
                </div>

                {!timingMode ? (
                    <>
                        <Textarea
                            id="lyrics"
                            value={lyrics}
                            onChange={(e) => setLyrics(e.target.value)}
                            className="min-h-[280px] font-mono text-[13px] leading-relaxed"
                            placeholder={'[00:12.00] Erste Zeile\n[00:17.50] Zweite Zeile\n[00:22.00] Dritte Zeile'}
                        />
                        <p className="text-xs text-muted">
                            {t('form.lyricsHint')}
                        </p>
                    </>
                ) : (
                    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <p className="text-sm font-medium">{t('form.timingMode')}</p>
                                <p className="text-xs text-muted">
                                    {t('form.timingHint', { time: formatTimePrecise(positionMs) })}
                                </p>
                            </div>
                            <Button type="button" size="sm" variant="accent" onClick={() => void ensurePlaying()}>
                                {playerTrack?.uri === preferredLink?.provider_uri && playing ? (
                                    <>
                                        <Pause className="h-4 w-4" /> {t('common.pause')}
                                    </>
                                ) : (
                                    <>
                                        <Play className="h-4 w-4" /> {t('common.play')}
                                    </>
                                )}
                            </Button>
                        </div>

                        <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                            {lines.map((line, index) => {
                                if (!line.text.trim()) {
                                    return null;
                                }

                                return (
                                    <li
                                        key={index}
                                        className={cn(
                                            'flex items-start gap-2 rounded-xl border px-2 py-2',
                                            activeLine === index
                                                ? 'border-accent/40 bg-accent/5'
                                                : 'border-transparent bg-paper/40',
                                        )}
                                    >
                                        <span className="mt-2 w-14 shrink-0 font-mono text-[11px] tabular-nums text-muted">
                                            {line.timeMs == null ? '--:--.--' : formatTimePrecise(line.timeMs)}
                                        </span>
                                        <Input
                                            value={line.text}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                setLines((prev) =>
                                                    prev.map((item, i) =>
                                                        i === index ? { ...item, text: value } : item,
                                                    ),
                                                );
                                            }}
                                            onFocus={() => setActiveLine(index)}
                                            className="flex-1"
                                            placeholder={t('form.line', { n: index + 1 })}
                                        />
                                        <AppTooltip label={t('form.setTime')}>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={activeLine === index ? 'accent' : 'outline'}
                                                onClick={() => {
                                                    setActiveLine(index);
                                                    stampLine(index);
                                                }}
                                                aria-label={t('form.setTime')}
                                            >
                                                <TimerReset className="h-4 w-4" />
                                                {t('form.time')}
                                            </Button>
                                        </AppTooltip>
                                    </li>
                                );
                            })}
                        </ul>

                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setLines((prev) => {
                                        const next = [...prev, { timeMs: null, text: t('form.newLine') }];
                                        setActiveLine(next.length - 1);
                                        return next;
                                    });
                                }}
                            >
                                {t('form.addLine')}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    setLines((prev) => prev.map((line) => ({ ...line, timeMs: null })))
                                }
                            >
                                {t('form.clearTimes')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <Button type="submit" variant="accent" disabled={submitting}>
                {submitting ? t('common.saving') : submitLabel}
            </Button>
        </form>
    );
}
