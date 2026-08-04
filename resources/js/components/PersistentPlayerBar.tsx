import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlignLeft,
    Captions,
    CaptionsOff,
    ChevronDown,
    ChevronUp,
    Pause,
    Play,
    Repeat1,
    Shuffle,
    SkipBack,
    SkipForward,
    Volume1,
    Volume2,
    VolumeX,
} from 'lucide-react';
import { usePlayer, formatTime } from '@/context/player-context';
import { useAuth } from '@/context/auth-context';
import { useRoom } from '@/context/room-context';
import { findActiveLrcIndex, parseLrc } from '@/lib/lrc';
import { hasMusicConnected, isProviderConnected, providerLabel } from '@/lib/music';
import api from '@/lib/api';
import type { Song } from '@/types';
import type { MusicProviderId } from '@/music/types';
import { Button } from '@/components/ui/button';
import { FavoriteButton } from '@/components/FavoriteButton';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

type LyricsMode = 'hidden' | 'mini' | 'full';

const LYRICS_MODE_KEY = 'songtexte.player.lyricsMode';
const COLLAPSED_KEY = 'songtexte.player.collapsed';
const LYRICS_MODES: LyricsMode[] = ['hidden', 'mini', 'full'];

function readLyricsMode(): LyricsMode {
    try {
        const raw = localStorage.getItem(LYRICS_MODE_KEY);
        if (raw === 'hidden' || raw === 'mini' || raw === 'full') {
            return raw;
        }
    } catch {
        // ignore
    }
    return 'mini';
}

function readCollapsed(): boolean {
    try {
        return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
}

function VolumeIcon({ volume }: { volume: number }) {
    if (volume === 0) {
        return <VolumeX className="h-4 w-4" />;
    }
    if (volume < 0.5) {
        return <Volume1 className="h-4 w-4" />;
    }
    return <Volume2 className="h-4 w-4" />;
}

function LyricsModeIcon({ mode }: { mode: LyricsMode }) {
    if (mode === 'hidden') {
        return <CaptionsOff className="h-4 w-4" />;
    }
    if (mode === 'full') {
        return <AlignLeft className="h-4 w-4" />;
    }
    return <Captions className="h-4 w-4" />;
}

const lyricsModeLabel: Record<LyricsMode, string> = {
    hidden: 'Songtext ausblenden',
    mini: 'Songtext: aktuelle Zeile',
    full: 'Songtext: vollständig',
};

export function PersistentPlayerBar() {
    const { user } = useAuth();
    const {
        track,
        ready,
        playing,
        positionMs,
        durationMs,
        volume,
        error,
        queue,
        shuffle,
        repeatOne,
        canPrev,
        canNext,
        controlsLocked,
        toggle,
        setVolume,
        seek,
        playNext,
        playPrevious,
        switchProvider,
        attachSongProviders,
        toggleShuffle,
        toggleRepeatOne,
    } = usePlayer();
    const { room, sendPlayback } = useRoom();
    const inRoom = Boolean(room);
    const canControlRoom = Boolean(room?.can_control);
    const [scrubbing, setScrubbing] = useState(false);
    const [scrubValue, setScrubValue] = useState(0);
    const [fetchedLyrics, setFetchedLyrics] = useState<string | null>(null);
    const [favorited, setFavorited] = useState(false);
    const [lyricsMode, setLyricsMode] = useState<LyricsMode>(readLyricsMode);
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const barRef = useRef<HTMLDivElement | null>(null);
    const activeLineRef = useRef<HTMLLIElement | null>(null);
    const fetchedForSongId = useRef<number | null>(null);
    const lastVolumeRef = useRef(
        (() => {
            try {
                const raw = localStorage.getItem('songtexte.player.lastVolume');
                const value = raw === null ? volume || 0.7 : Number(raw);
                return Number.isFinite(value) && value > 0 ? Math.min(1, value) : 0.7;
            } catch {
                return volume > 0 ? volume : 0.7;
            }
        })(),
    );

    useEffect(() => {
        if (volume > 0) {
            lastVolumeRef.current = volume;
        }
    }, [volume]);

    useEffect(() => {
        try {
            localStorage.setItem(LYRICS_MODE_KEY, lyricsMode);
        } catch {
            // ignore
        }
    }, [lyricsMode]);

    useEffect(() => {
        try {
            localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
        } catch {
            // ignore
        }
    }, [collapsed]);

    useEffect(() => {
        const el = barRef.current;
        if (!el) {
            return;
        }

        const syncHeight = () => {
            document.documentElement.style.setProperty('--player-bar-height', `${el.offsetHeight}px`);
        };

        syncHeight();
        const observer = new ResizeObserver(syncHeight);
        observer.observe(el);

        return () => {
            observer.disconnect();
            document.documentElement.style.removeProperty('--player-bar-height');
        };
    }, [track?.uri, lyricsMode, collapsed]);

    useEffect(() => {
        if (!track?.songId) {
            setFetchedLyrics(null);
            setFavorited(false);
            fetchedForSongId.current = null;
            return;
        }

        const songId = track.songId;
        const needsLyrics = typeof track.lyrics !== 'string';
        const needsProviders = !track.providerLinks || track.providerLinks.length === 0;
        const alreadyFetched = fetchedForSongId.current === songId;

        if (alreadyFetched && !needsLyrics && !needsProviders) {
            return;
        }

        let cancelled = false;

        void (async () => {
            try {
                const { data } = await api.get<{ data: Song }>(`/songs/${songId}`);
                if (cancelled) {
                    return;
                }
                fetchedForSongId.current = songId;
                if (needsLyrics || typeof track.lyrics !== 'string') {
                    setFetchedLyrics(data.data.lyrics ?? '');
                }
                setFavorited(Boolean(data.data.is_favorited));
                if (needsProviders || !track.providerLinks?.length) {
                    attachSongProviders(data.data);
                }
            } catch {
                if (!cancelled) {
                    fetchedForSongId.current = songId;
                    if (needsLyrics) {
                        setFetchedLyrics('');
                    }
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [track?.songId, track?.lyrics, track?.uri, track?.providerLinks, attachSongProviders]);

    const switchableProviders = useMemo(() => {
        if (!track?.providerLinks?.length) {
            return [] as MusicProviderId[];
        }
        return track.providerLinks
            .map((l) => l.provider)
            .filter((id) => isProviderConnected(user, id));
    }, [track?.providerLinks, user]);

    const lyricsSource = typeof track?.lyrics === 'string' ? track.lyrics : fetchedLyrics;
    const parsedLyrics = useMemo(() => {
        if (!lyricsSource) {
            return null;
        }
        return parseLrc(lyricsSource);
    }, [lyricsSource]);

    const activeLyricIndex = useMemo(() => {
        if (!parsedLyrics?.isLrc || parsedLyrics.lines.length === 0) {
            return -1;
        }
        return findActiveLrcIndex(parsedLyrics.lines, positionMs);
    }, [parsedLyrics, positionMs]);

    const currentLyricLine =
        activeLyricIndex >= 0 ? parsedLyrics?.lines[activeLyricIndex]?.text?.trim() || null : null;

    const hasLyrics = Boolean(lyricsSource?.trim());

    useEffect(() => {
        if (lyricsMode !== 'full' || activeLyricIndex < 0) {
            return;
        }
        activeLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [lyricsMode, activeLyricIndex]);

    const cycleLyricsMode = () => {
        setLyricsMode((prev) => {
            const index = LYRICS_MODES.indexOf(prev);
            return LYRICS_MODES[(index + 1) % LYRICS_MODES.length] ?? 'mini';
        });
    };

    if (!hasMusicConnected(user) || !track) {
        return null;
    }

    const displayPosition = scrubbing ? scrubValue : positionMs;
    const remainingMs = Math.max(0, durationMs - displayPosition);
    const inPlaylist = Boolean(queue) && !inRoom;
    const playbackLocked = controlsLocked || (inRoom && !canControlRoom);

    const onToggle = () => {
        if (inRoom && canControlRoom) {
            void sendPlayback(playing ? 'pause' : 'play', { position_ms: positionMs });
            return;
        }
        void toggle();
    };

    const onSeekEnd = (next: number) => {
        setScrubbing(false);
        if (inRoom && canControlRoom) {
            void sendPlayback('seek', { position_ms: next });
            return;
        }
        void seek(next);
    };

    const onNext = () => {
        if (inRoom && canControlRoom) {
            void sendPlayback('next');
            return;
        }
        void playNext();
    };

    const meta = (
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {track.albumArtUrl ? (
                <img
                    src={track.albumArtUrl}
                    alt=""
                    className={cn(
                        'shrink-0 rounded-lg object-cover shadow-md ring-1 ring-ink/8',
                        collapsed ? 'h-11 w-11' : 'h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]',
                    )}
                />
            ) : (
                <div
                    className={cn(
                        'shrink-0 rounded-lg bg-paper-2 ring-1 ring-ink/5',
                        collapsed ? 'h-11 w-11' : 'h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]',
                    )}
                />
            )}

            <div className="min-w-0 flex-1">
                {track.songId ? (
                    <Link
                        to={`/songs/${track.songId}`}
                        className={cn(
                            'block truncate font-semibold tracking-tight hover:text-accent',
                            collapsed ? 'text-sm' : 'text-sm sm:text-base',
                        )}
                    >
                        {track.title}
                    </Link>
                ) : (
                    <p
                        className={cn(
                            'truncate font-semibold tracking-tight',
                            collapsed ? 'text-sm' : 'text-sm sm:text-base',
                        )}
                    >
                        {track.title}
                    </p>
                )}
                <p className={cn('truncate text-muted', collapsed ? 'text-xs' : 'text-xs sm:text-sm')}>
                    {track.artist}
                </p>
                {switchableProviders.length > 1 && (
                    <div className={cn('flex flex-wrap gap-1', collapsed ? 'mt-0.5' : 'mt-1')}>
                        {switchableProviders.map((provider) => {
                            const active = track.provider === provider;
                            const preferred = track.preferredProvider === provider;
                            return (
                                <button
                                    key={provider}
                                    type="button"
                                    disabled={playbackLocked || active}
                                    onClick={() => void switchProvider(provider)}
                                    className={cn(
                                        'rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition',
                                        active
                                            ? 'border-accent/30 bg-accent/15 text-accent'
                                            : 'border-line bg-paper-2 text-muted hover:border-accent/30 hover:text-ink',
                                        playbackLocked && 'opacity-50',
                                    )}
                                    title={
                                        preferred
                                            ? `${providerLabel(provider)} (bevorzugt)`
                                            : `Mit ${providerLabel(provider)} abspielen`
                                    }
                                >
                                    {providerLabel(provider)}
                                    {preferred ? ' ★' : ''}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {track.songId ? (
                <FavoriteButton
                    songId={track.songId}
                    favorited={favorited}
                    onChange={setFavorited}
                />
            ) : null}
        </div>
    );

    const collapseToggle = (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Player ausklappen' : 'Player einklappen'}
            title={collapsed ? 'Player ausklappen' : 'Player einklappen'}
        >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
    );

    if (collapsed) {
        const progressPercent =
            durationMs > 0 ? Math.min(100, Math.max(0, (displayPosition / durationMs) * 100)) : 0;

        return (
            <div
                ref={barRef}
                className="fixed inset-x-0 bottom-0 z-50 border-t border-line/80 bg-paper/92 shadow-[var(--player-shadow)] backdrop-blur-xl"
            >
                <div className="h-0.5 w-full bg-ink/10">
                    <div
                        className="h-full bg-gradient-to-r from-accent to-accent-soft transition-[width] duration-150 ease-out"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 sm:px-6">
                    <div className="min-w-0 justify-self-start">{meta}</div>

                    <div className="flex flex-col items-center gap-0.5 justify-self-center">
                        <Button
                            type="button"
                            variant="accent"
                            size="icon"
                            disabled={!ready || playbackLocked}
                            onClick={onToggle}
                            aria-label={playing ? 'Pause' : 'Play'}
                            className="h-9 w-9 rounded-full shadow-sm"
                        >
                            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
                        </Button>
                        <span className="text-[10px] tabular-nums text-muted">
                            {formatTime(displayPosition)}
                            {durationMs > 0 ? ` / ${formatTime(durationMs)}` : ''}
                        </span>
                    </div>

                    <div className="justify-self-end">{collapseToggle}</div>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={barRef}
            className="fixed inset-x-0 bottom-0 z-50 border-t border-line/80 bg-paper/92 shadow-[var(--player-shadow)] backdrop-blur-xl"
        >
            {lyricsMode === 'mini' && currentLyricLine && (
                <div className="border-b border-line/60 bg-paper/80 px-4 py-2 text-center sm:px-6">
                    <p
                        key={currentLyricLine}
                        className="truncate font-display text-sm font-medium tracking-tight text-ink transition-opacity duration-300 sm:text-base"
                    >
                        {currentLyricLine}
                    </p>
                </div>
            )}

            {lyricsMode === 'full' && (
                <div className="border-b border-line/60 bg-paper/80">
                    <div className="max-h-[min(40vh,22rem)] overflow-y-auto px-4 py-4 sm:px-6">
                        {!hasLyrics ? (
                            <p className="text-center text-sm text-muted">Kein Songtext verfügbar.</p>
                        ) : parsedLyrics?.isLrc && parsedLyrics.lines.length > 0 ? (
                            <ul className="mx-auto max-w-3xl space-y-1.5 text-center">
                                {parsedLyrics.lines.map((line, index) => {
                                    const active = index === activeLyricIndex;
                                    const past = activeLyricIndex >= 0 && index < activeLyricIndex;
                                    return (
                                        <li
                                            key={`${line.timeMs}-${index}`}
                                            ref={active ? activeLineRef : undefined}
                                            className={cn(
                                                'font-display text-base leading-snug transition-all duration-300 sm:text-lg',
                                                active && 'scale-[1.02] font-semibold text-ink',
                                                past && 'text-muted/70',
                                                !active && !past && 'text-muted',
                                            )}
                                        >
                                            {line.text.trim() || '·'}
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : (
                            <pre className="mx-auto max-w-3xl whitespace-pre-wrap text-center font-display text-base leading-8 text-ink/90 sm:text-lg">
                                {parsedLyrics?.plainText || lyricsSource}
                            </pre>
                        )}
                    </div>
                </div>
            )}

            <div className="w-full px-4 py-3 sm:px-6">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(0,1.4fr)_minmax(10rem,1fr)] sm:gap-4">
                    <div className="min-w-0 justify-self-start">{meta}</div>

                    <div className="col-span-2 flex min-w-0 flex-col gap-1.5 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                        <div className="flex items-center justify-center gap-1 sm:gap-1.5">
                            <Button
                                type="button"
                                variant={shuffle ? 'accent' : 'ghost'}
                                size="icon"
                                className="h-8 w-8"
                                disabled={!inPlaylist}
                                onClick={toggleShuffle}
                                aria-label="Zufällig"
                                title="Zufällige Reihenfolge"
                            >
                                <Shuffle className="h-4 w-4" />
                            </Button>

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={!canPrev || playbackLocked}
                                onClick={() => void playPrevious()}
                                aria-label="Zurück"
                            >
                                <SkipBack className="h-4 w-4" />
                            </Button>

                            <Button
                                type="button"
                                variant="accent"
                                size="icon"
                                disabled={!ready || playbackLocked}
                                onClick={onToggle}
                                aria-label={playing ? 'Pause' : 'Play'}
                                className="h-10 w-10 rounded-full shadow-sm"
                            >
                                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
                            </Button>

                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={(!canNext && !inRoom) || playbackLocked}
                                onClick={onNext}
                                aria-label="Weiter"
                            >
                                <SkipForward className="h-4 w-4" />
                            </Button>

                            <Button
                                type="button"
                                variant={repeatOne ? 'accent' : 'ghost'}
                                size="icon"
                                className="h-8 w-8"
                                onClick={toggleRepeatOne}
                                aria-label="Song wiederholen"
                                title="Aktuellen Song wiederholen"
                            >
                                <Repeat1 className="h-4 w-4" />
                            </Button>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted">
                                {formatTime(displayPosition)}
                            </span>
                            <Slider
                                variant="progress"
                                aria-label="Wiedergabeposition"
                                min={0}
                                max={Math.max(durationMs, 1)}
                                step={250}
                                value={Math.min(displayPosition, durationMs || 0)}
                                disabled={!durationMs || playbackLocked}
                                onChange={(next) => {
                                    setScrubbing(true);
                                    setScrubValue(next);
                                }}
                                onChangeEnd={onSeekEnd}
                            />
                            <span
                                className={cn('w-10 shrink-0 text-[11px] tabular-nums text-muted')}
                                title={`Verbleibend / Gesamt ${formatTime(durationMs)}`}
                            >
                                -{formatTime(remainingMs)}
                            </span>
                        </div>
                    </div>

                    <div className="flex w-auto shrink-0 items-center justify-end gap-1 justify-self-end sm:w-52 sm:gap-1.5">
                        {collapseToggle}

                        <Button
                            type="button"
                            variant={lyricsMode === 'hidden' ? 'ghost' : 'accent'}
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={cycleLyricsMode}
                            aria-label={lyricsModeLabel[lyricsMode]}
                            title={`${lyricsModeLabel[lyricsMode]} (klicken zum Wechseln)`}
                        >
                            <LyricsModeIcon mode={lyricsMode} />
                        </Button>

                        <button
                            type="button"
                            className="rounded-md p-1.5 text-muted transition hover:bg-paper-2 hover:text-ink"
                            aria-label={volume === 0 ? 'Lautstärke an' : 'Stumm'}
                            onClick={() => void setVolume(volume === 0 ? lastVolumeRef.current || 0.7 : 0)}
                        >
                            <VolumeIcon volume={volume} />
                        </button>
                        <Slider
                            variant="volume"
                            aria-label="Lautstärke"
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(volume * 100)}
                            onChange={(next) => void setVolume(next / 100)}
                            className="hidden w-24 shrink-0 sm:flex"
                        />
                    </div>
                </div>

                {error && <p className="mt-2 text-xs text-danger">{error}</p>}
                {!ready && !error && <p className="mt-2 text-xs text-muted">Player wird initialisiert…</p>}
            </div>
        </div>
    );
}
