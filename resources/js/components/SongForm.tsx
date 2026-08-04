import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Download, Loader2, Pause, Play, TimerReset } from 'lucide-react';
import api from '@/lib/api';
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
import type { ProviderTrack, Song } from '@/types';
import { cn } from '@/lib/utils';

export type SongFormValues = {
    title: string;
    artist: string;
    lyrics: string;
    provider: string | null;
    provider_track_id: string | null;
    provider_uri: string | null;
    album_art_url: string | null;
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

export function SongForm({ initial, submitLabel, onSubmit }: Props) {
    const { track: playerTrack, playing, positionMs, playTrack, toggle } = usePlayer();
    const [title, setTitle] = useState(initial?.title ?? '');
    const [artist, setArtist] = useState(initial?.artist ?? '');
    const [lyrics, setLyrics] = useState(initial?.lyrics ?? '');
    const [lines, setLines] = useState<EditableLyricLine[]>(() => lyricsToEditableLines(initial?.lyrics ?? ''));
    const [timingMode, setTimingMode] = useState(false);
    const [activeLine, setActiveLine] = useState(0);
    const [track, setTrack] = useState<ProviderTrack | null>(() => {
        if (initial?.provider_track_id && initial?.provider) {
            return {
                provider: initial.provider,
                id: initial.provider_track_id,
                uri: initial.provider_uri ?? `spotify:track:${initial.provider_track_id}`,
                name: initial.title ?? 'Track',
                artist: initial.artist ?? '',
                album_art_url: initial.album_art_url ?? null,
            };
        }
        return null;
    });
    const [error, setError] = useState<string | null>(null);
    const [lyricsStatus, setLyricsStatus] = useState<string | null>(null);
    const [fetchingLyrics, setFetchingLyrics] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const lyricsRef = useRef(lyrics);
    const titleRef = useRef(title);
    const artistRef = useRef(artist);

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
        setLyricsStatus(
            synced
                ? 'Synchronisierter Songtext von LRCLIB eingefügt.'
                : 'Songtext von LRCLIB eingefügt.',
        );
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
            setError('Titel und Artist werden für die Songtext-Suche benötigt.');
            return;
        }

        const currentLyrics = lyricsRef.current.trim();
        if (currentLyrics && !options?.force) {
            return;
        }

        if (currentLyrics && options?.force) {
            const confirmed = window.confirm('Vorhandenen Songtext mit dem gefundenen Text überschreiben?');
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
            let message = 'Kein Songtext gefunden.';
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
        if (!track?.uri && !track?.id) {
            setError('Bitte zuerst einen Track verknüpfen.');
            return;
        }

        const playUri = track.uri || `spotify:track:${track.id}`;
        const isCurrent = playerTrack?.uri === playUri;
        if (isCurrent) {
            if (!playing) {
                await toggle();
            }
            return;
        }

        await playTrack({
            provider: track.provider || 'spotify',
            trackId: track.id,
            uri: playUri,
            title: title || track.name,
            artist: artist || track.artist,
            albumArtUrl: track.album_art_url,
            songId: initial?.id,
            lyrics: timingMode ? serializeEditableLines(lines) : lyrics,
        });
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const finalLyrics = timingMode ? serializeEditableLines(lines) : lyrics;
            await onSubmit({
                title,
                artist,
                lyrics: finalLyrics,
                provider: track?.provider ?? null,
                provider_track_id: track?.id ?? null,
                provider_uri: track?.uri ?? null,
                album_art_url: track?.album_art_url ?? initial?.album_art_url ?? null,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
        } finally {
            setSubmitting(false);
        }
    };

    const onTrackChange = (next: ProviderTrack | null) => {
        setTrack(next);
        if (!next) {
            return;
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
            durationMs: next.duration_ms,
            force: false,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {error && <Alert variant="error">{error}</Alert>}
            {lyricsStatus && !error && (
                <Alert variant={lyricsStatus.includes('eingefügt') ? 'success' : 'default'}>{lyricsStatus}</Alert>
            )}

            <div className="space-y-2">
                <Label htmlFor="title">Titel</Label>
                <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="space-y-2">
                <Label htmlFor="artist">Artist</Label>
                <Input id="artist" required value={artist} onChange={(e) => setArtist(e.target.value)} />
            </div>

            <div className="space-y-2">
                <Label>Track verknüpfen (optional)</Label>
                <ProviderTrackPicker value={track} onChange={onTrackChange} />
            </div>

            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="lyrics">Songtext</Label>
                    <div className="flex flex-wrap items-center gap-2">
                        {isLrc && <Badge className="border-accent/20 bg-accent/10 text-accent">LRC erkannt</Badge>}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={fetchingLyrics || !title.trim() || !artist.trim()}
                            onClick={() =>
                                void fetchLyrics({
                                    durationMs: track?.duration_ms,
                                    force: true,
                                })
                            }
                        >
                            {fetchingLyrics ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="h-4 w-4" />
                            )}
                            Songtext holen
                        </Button>
                        {!timingMode ? (
                            <Button type="button" size="sm" variant="outline" onClick={enterTimingMode}>
                                Zeitstempel setzen
                            </Button>
                        ) : (
                            <Button type="button" size="sm" variant="outline" onClick={exitTimingMode}>
                                Zur Textansicht
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
                            Automatisch über LRCLIB, manuell oder mit „Zeitstempel setzen“ während der Wiedergabe.
                        </p>
                    </>
                ) : (
                    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <p className="text-sm font-medium">Timing-Modus</p>
                                <p className="text-xs text-muted">
                                    Song abspielen und pro Zeile „Zeit setzen“ drücken ({formatTimePrecise(positionMs)}).
                                </p>
                            </div>
                            <Button type="button" size="sm" variant="accent" onClick={() => void ensurePlaying()}>
                                {playerTrack?.uri === track?.uri && playing ? (
                                    <>
                                        <Pause className="h-4 w-4" /> Pause
                                    </>
                                ) : (
                                    <>
                                        <Play className="h-4 w-4" /> Abspielen
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
                                            placeholder={`Zeile ${index + 1}`}
                                        />
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={activeLine === index ? 'accent' : 'outline'}
                                            onClick={() => {
                                                setActiveLine(index);
                                                stampLine(index);
                                            }}
                                            title="Aktuelle Player-Zeit setzen"
                                        >
                                            <TimerReset className="h-4 w-4" />
                                            Zeit
                                        </Button>
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
                                        const next = [...prev, { timeMs: null, text: 'Neue Zeile' }];
                                        setActiveLine(next.length - 1);
                                        return next;
                                    });
                                }}
                            >
                                Zeile hinzufügen
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    setLines((prev) => prev.map((line) => ({ ...line, timeMs: null })))
                                }
                            >
                                Zeiten löschen
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            <Button type="submit" variant="accent" disabled={submitting}>
                {submitting ? 'Speichern…' : submitLabel}
            </Button>
        </form>
    );
}
