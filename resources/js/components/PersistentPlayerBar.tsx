import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlignLeft,
    Captions,
    CaptionsOff,
    ChevronDown,
    ChevronUp,
    Maximize2,
    Minimize2,
    Minus,
    Pause,
    Play,
    Plus,
    Repeat1,
    Shuffle,
    SkipBack,
    SkipForward,
    ListMusic,
    Volume1,
    Volume2,
    VolumeX,
    X,
} from 'lucide-react';
import { usePlayer, formatTime } from '@/context/player-context';
import { useAuth } from '@/context/auth-context';
import { useRoom } from '@/context/room-context';
import { findActiveLrcIndex, parseLrc } from '@/lib/lrc';
import { hasPlaybackConnected, isPlaybackProviderConnected, providerLabel } from '@/lib/music';
import api from '@/lib/api';
import type { Song } from '@/types';
import type { MusicProviderId } from '@/music/types';
import { Button } from '@/components/ui/button';
import { FavoriteButton } from '@/components/FavoriteButton';
import { Slider } from '@/components/ui/slider';
import { subscribeFavoriteChange } from '@/lib/favorite-sync';
import { FitText } from '@/components/FitText';
import { FullscreenLyricsStage } from '@/components/FullscreenLyricsStage';
import { ArtistLinks } from '@/components/ArtistLinks';
import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/context/locale-context';
import { isPartyModeEnabled, subscribePartyMode } from '@/lib/party-mode';

type LyricsMode = 'hidden' | 'mini' | 'full';

const LYRICS_MODE_KEY = 'songtexte.player.lyricsMode';
const COLLAPSED_KEY = 'songtexte.player.collapsed';
const LYRICS_SCALE_KEY = 'songtexte.player.lyricsScale';
const LYRICS_HEIGHT_KEY = 'songtexte.player.lyricsHeight';
const QUEUE_OPEN_KEY = 'songtexte.player.queueOpen';
const LYRICS_MODES: LyricsMode[] = ['hidden', 'mini', 'full'];
const MIN_LYRICS_SCALE = 1;
const MAX_LYRICS_SCALE = 2;
const LYRICS_SCALE_STEP = 0.1;
/** Approximate line height for 3 visible lines at base size. */
const MIN_LYRICS_HEIGHT_PX = 88;

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

function readLyricsScale(): number {
    try {
        const value = Number(localStorage.getItem(LYRICS_SCALE_KEY));
        if (Number.isFinite(value) && value >= MIN_LYRICS_SCALE && value <= MAX_LYRICS_SCALE) {
            return Math.round(value * 10) / 10;
        }
    } catch {
        // ignore
    }
    return 1;
}

function readLyricsHeight(): number | null {
    try {
        const value = Number(localStorage.getItem(LYRICS_HEIGHT_KEY));
        if (Number.isFinite(value) && value >= MIN_LYRICS_HEIGHT_PX) {
            return value;
        }
    } catch {
        // ignore
    }
    return null;
}

function readQueueOpen(): boolean {
    try {
        const raw = localStorage.getItem(QUEUE_OPEN_KEY);
        if (raw === null) {
            return true;
        }
        return raw === '1' || raw === 'true';
    } catch {
        return true;
    }
}

function maxLyricsHeightPx(): number {
    // Leave ~10% under the sticky header (h-16 = 4rem) for breathing room.
    const header = 64;
    const controlsReserve = 140;
    const underHeaderGap = Math.round(window.innerHeight * 0.1);
    return Math.max(MIN_LYRICS_HEIGHT_PX, window.innerHeight - header - underHeaderGap - controlsReserve);
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

function lyricsModeLabel(mode: LyricsMode, t: (key: string) => string): string {
    if (mode === 'hidden') {
        return t('player.lyricsHide');
    }
    if (mode === 'mini') {
        return t('player.lyricsMini');
    }
    return t('player.lyricsFull');
}

const glassBarClass =
    'fixed inset-x-0 bottom-0 z-50 border-t border-line/70 bg-paper/80 shadow-[var(--player-shadow)] backdrop-blur-xl';

export function PersistentPlayerBar() {
    const { t } = useI18n();
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
        playQueueCursor,
        removeUpcoming,
        switchProvider,
        attachSongProviders,
        toggleShuffle,
        toggleRepeatOne,
    } = usePlayer();
    const { room, sendPlayback } = useRoom();
    const [partyMode, setPartyMode] = useState(isPartyModeEnabled);

    useEffect(() => subscribePartyMode(setPartyMode), []);
    const inRoom = Boolean(room);
    const canControlRoom = Boolean(room?.can_control);
    const [scrubbing, setScrubbing] = useState(false);
    const [scrubValue, setScrubValue] = useState(0);
    const [fetchedLyrics, setFetchedLyrics] = useState<string | null>(null);
    const [favorited, setFavorited] = useState(false);
    const [lyricsMode, setLyricsMode] = useState<LyricsMode>(readLyricsMode);
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const [lyricsScale, setLyricsScale] = useState(readLyricsScale);
    const [lyricsHeight, setLyricsHeight] = useState(() => readLyricsHeight() ?? Math.min(280, maxLyricsHeightPx()));
    const [lyricsFullscreen, setLyricsFullscreen] = useState(false);
    const [queueOpen, setQueueOpen] = useState(readQueueOpen);
    const barRef = useRef<HTMLDivElement | null>(null);
    const activeLineRef = useRef<HTMLLIElement | null>(null);
    const fetchedForSongId = useRef<string | null>(null);
    const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const lyricsHeightRef = useRef(lyricsHeight);

    useEffect(() => {
        lyricsHeightRef.current = lyricsHeight;
    }, [lyricsHeight]);

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
        try {
            localStorage.setItem(QUEUE_OPEN_KEY, queueOpen ? '1' : '0');
        } catch {
            // ignore
        }
    }, [queueOpen]);

    useEffect(() => {
        if (!queueOpen) {
            return;
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setQueueOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [queueOpen]);

    useEffect(() => {
        try {
            localStorage.setItem(LYRICS_SCALE_KEY, String(lyricsScale));
        } catch {
            // ignore
        }
    }, [lyricsScale]);

    useEffect(() => {
        try {
            localStorage.setItem(LYRICS_HEIGHT_KEY, String(Math.round(lyricsHeight)));
        } catch {
            // ignore
        }
    }, [lyricsHeight]);

    useEffect(() => {
        const onResize = () => {
            setLyricsHeight((prev) => Math.min(prev, maxLyricsHeightPx()));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

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
    }, [track?.uri, lyricsMode, collapsed, lyricsHeight, lyricsScale]);

    // Always load lyrics when a song starts playing so edits mid-playback don't leave stale text.
    useEffect(() => {
        if (!track?.songId) {
            setFetchedLyrics(null);
            setFavorited(false);
            fetchedForSongId.current = null;
            return;
        }

        const songId = track.songId;
        const needsProviders = !track.providerLinks || track.providerLinks.length === 0;
        let cancelled = false;

        void (async () => {
            try {
                const { data } = await api.get<{ data: Song }>(`/songs/${songId}`, {
                    skipErrorToast: true,
                });
                if (cancelled) {
                    return;
                }
                fetchedForSongId.current = songId;
                setFetchedLyrics(data.data.lyrics ?? '');
                setFavorited(Boolean(data.data.is_favorited));
                if (needsProviders) {
                    attachSongProviders(data.data);
                }
            } catch {
                if (!cancelled) {
                    fetchedForSongId.current = songId;
                    setFetchedLyrics('');
                }
            }
        })();

        return () => {
            cancelled = true;
        };
        // intentionally only re-fetch when the playing song changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [track?.songId, track?.uri, attachSongProviders]);

    useEffect(() => {
        if (!track?.songId) {
            return;
        }
        return subscribeFavoriteChange((songId, next) => {
            if (songId === track.songId) {
                setFavorited(next);
            }
        });
    }, [track?.songId]);

    useEffect(() => {
        if (!lyricsFullscreen) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setLyricsFullscreen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [lyricsFullscreen]);

    useEffect(() => {
        if (!track || !hasPlaybackConnected(user)) {
            return;
        }

        const onKey = (e: KeyboardEvent) => {
            if (e.code !== 'Space' && e.key !== ' ') {
                return;
            }
            if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) {
                return;
            }

            const target = e.target as HTMLElement | null;
            if (
                target?.closest(
                    'input, textarea, select, button, a, [role="button"], [contenteditable="true"]',
                )
            ) {
                return;
            }

            if (controlsLocked || (inRoom && !canControlRoom)) {
                return;
            }

            e.preventDefault();

            if (inRoom && canControlRoom) {
                void sendPlayback(playing ? 'pause' : 'play', { position_ms: positionMs });
                return;
            }

            void toggle();
        };

        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [
        track,
        user,
        controlsLocked,
        inRoom,
        canControlRoom,
        playing,
        positionMs,
        sendPlayback,
        toggle,
    ]);

    const switchableProviders = useMemo(() => {
        if (!track?.providerLinks?.length) {
            return [] as MusicProviderId[];
        }
        return track.providerLinks
            .map((l) => l.provider)
            .filter((id) => isPlaybackProviderConnected(user, id));
    }, [track?.providerLinks, user]);

    const lyricsSource = fetchedLyrics ?? (typeof track?.lyrics === 'string' ? track.lyrics : null);
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

    const currentLyricLine = useMemo(() => {
        if (!parsedLyrics?.isLrc) {
            return null;
        }
        if (activeLyricIndex < 0) {
            return '♪';
        }
        return parsedLyrics.lines[activeLyricIndex]?.text?.trim() || '♪';
    }, [parsedLyrics, activeLyricIndex]);

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

    const bumpLyricsScale = (delta: number) => {
        setLyricsScale((prev) => {
            const next = Math.round((prev + delta) * 10) / 10;
            return Math.min(MAX_LYRICS_SCALE, Math.max(MIN_LYRICS_SCALE, next));
        });
    };

    const onLyricsDragStart = (clientY: number) => {
        dragRef.current = { startY: clientY, startHeight: lyricsHeightRef.current };
    };

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) {
                return;
            }
            const next = drag.startHeight + (drag.startY - e.clientY);
            setLyricsHeight(Math.min(maxLyricsHeightPx(), Math.max(MIN_LYRICS_HEIGHT_PX, next)));
        };
        const onUp = () => {
            dragRef.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, []);

    if (!hasPlaybackConnected(user) || !track) {
        return null;
    }

    const displayPosition = scrubbing ? scrubValue : positionMs;
    const remainingMs = Math.max(0, durationMs - displayPosition);
    const progressPercent =
        durationMs > 0 ? Math.min(100, Math.max(0, (displayPosition / durationMs) * 100)) : 0;
    const inPlaylist = Boolean(queue) && !inRoom;
    const playbackLocked = controlsLocked || (inRoom && !canControlRoom);
    const upcoming =
        queue && !inRoom
            ? queue.order
                  .slice(queue.cursor + 1, queue.cursor + 11)
                  .map((trackIndex, offset) => ({
                      orderIndex: queue.cursor + 1 + offset,
                      track: queue.tracks[trackIndex],
                  }))
                  .filter((item) => Boolean(item.track))
            : [];

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

    const cover = track.albumArtUrl ? (
        <img
            src={track.albumArtUrl}
            alt=""
            className={cn(
                'shrink-0 rounded-lg object-cover shadow-md ring-1 ring-ink/8',
                collapsed ? 'h-11 w-11' : 'h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]',
                partyMode && 'party-cover-glow',
            )}
        />
    ) : (
        <div
            className={cn(
                'shrink-0 rounded-lg bg-paper-2 ring-1 ring-ink/5',
                collapsed ? 'h-11 w-11' : 'h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]',
            )}
        />
    );

    const meta = (
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {track.songId ? (
                <AppTooltip label={t('player.goToSong')}>
                    <Link
                        to={`/songs/${track.songId}`}
                        className="shrink-0 transition hover:opacity-90"
                        aria-label={t('player.goToSong')}
                    >
                        {cover}
                    </Link>
                </AppTooltip>
            ) : (
                cover
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
                    <ArtistLinks artists={track.artists} artist={track.artist} />
                </p>
                {switchableProviders.length > 1 && (
                    <div className={cn('flex flex-wrap gap-1', collapsed ? 'mt-0.5' : 'mt-1')}>
                        {switchableProviders.map((provider) => {
                            const active = track.provider === provider;
                            const preferred = track.preferredProvider === provider;
                            return (
                                <AppTooltip
                                    key={provider}
                                    label={
                                        preferred
                                            ? t('player.preferredProvider', { provider: providerLabel(provider) })
                                            : t('player.playWith', { provider: providerLabel(provider) })
                                    }
                                >
                                    <button
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
                                    >
                                        {providerLabel(provider)}
                                        {preferred ? ' ★' : ''}
                                    </button>
                                </AppTooltip>
                            );
                        })}
                    </div>
                )}
            </div>

            {track.songId ? (
                <FavoriteButton songId={track.songId} favorited={favorited} onChange={setFavorited} />
            ) : null}
        </div>
    );

    const collapseToggle = (
        <AppTooltip label={collapsed ? t('player.expand') : t('player.collapse')}>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setCollapsed((v) => !v)}
                aria-label={collapsed ? t('player.expand') : t('player.collapse')}
            >
                {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
        </AppTooltip>
    );

    const renderLyricsList = (activeRef: typeof activeLineRef) => {
        if (!hasLyrics) {
            return <p className="text-center text-sm text-muted">{t('player.noLyrics')}</p>;
        }
        if (parsedLyrics?.isLrc && parsedLyrics.lines.length > 0) {
            return (
                <ul className="mx-auto w-full max-w-3xl space-y-1.5 text-center">
                    {parsedLyrics.lines.map((line, index) => {
                        const active = index === activeLyricIndex;
                        const past = activeLyricIndex >= 0 && index < activeLyricIndex;
                        return (
                            <li
                                key={`${line.timeMs}-${index}`}
                                ref={active ? activeRef : undefined}
                                className={cn(
                                    'font-display transition-colors duration-300',
                                    active && 'font-semibold text-ink',
                                    past && 'text-muted/70',
                                    !active && !past && 'text-muted',
                                )}
                            >
                                <FitText
                                    text={line.text.trim() || '♪'}
                                    maxRem={active ? 1.125 : 1}
                                    minRem={0.7}
                                    className="text-center"
                                />
                            </li>
                        );
                    })}
                </ul>
            );
        }
        return (
            <pre className="mx-auto max-w-3xl whitespace-pre-wrap text-center font-display text-base leading-8 text-ink/90 sm:text-lg">
                {parsedLyrics?.plainText || lyricsSource}
            </pre>
        );
    };

    const fullscreenOverlay = lyricsFullscreen ? (
        <div className="lyric-fs-shell fixed inset-0 z-[90] flex flex-col bg-paper/95 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-2 sm:px-6">
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold tracking-tight">{track.title}</p>
                    <p className="truncate text-xs text-muted">
                        <ArtistLinks artists={track.artists} artist={track.artist} />
                    </p>
                </div>
                <AppTooltip label={t('player.exitFullscreen')}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setLyricsFullscreen(false)}
                        aria-label={t('player.exitFullscreen')}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </AppTooltip>
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden px-6 sm:px-10">
                {!hasLyrics ? (
                    <p className="text-center text-muted">{t('player.noLyrics')}</p>
                ) : parsedLyrics?.isLrc ? (
                    <FullscreenLyricsStage lines={parsedLyrics.lines} activeIndex={activeLyricIndex} />
                ) : (
                    <FullscreenLyricsStage
                        lines={[]}
                        activeIndex={0}
                        plainFallback={
                            parsedLyrics?.plainText?.split('\n').find((l) => l.trim())?.trim() ||
                            lyricsSource?.split('\n').find((l) => l.trim())?.trim() ||
                            '♪'
                        }
                    />
                )}
            </div>

            <div className="border-t border-line/70 bg-paper/80 backdrop-blur-xl">
                <div className="h-0.5 w-full bg-ink/10">
                    <div
                        className="h-full bg-gradient-to-r from-accent to-accent-soft transition-[width] duration-150 ease-out"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 sm:px-6">
                    <div className="justify-self-start" />

                    <div className="flex flex-col items-center gap-0.5 justify-self-center">
                        <AppTooltip label={playing ? t('common.pause') : t('common.play')}>
                            <Button
                                type="button"
                                variant="accent"
                                size="icon"
                                disabled={!ready || playbackLocked}
                                onClick={onToggle}
                                aria-label={playing ? t('common.pause') : t('common.play')}
                                className="h-9 w-9 rounded-full shadow-sm"
                            >
                                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
                            </Button>
                        </AppTooltip>
                        <span className="text-[10px] tabular-nums text-muted">
                            {formatTime(displayPosition)}
                            {durationMs > 0 ? ` / ${formatTime(durationMs)}` : ''}
                        </span>
                    </div>

                    <div className="flex min-w-0 items-center justify-end gap-1 justify-self-end">
                        <AppTooltip label={volume === 0 ? t('player.volumeOn') : t('player.mute')}>
                            <button
                                type="button"
                                className="rounded-md p-1.5 text-muted transition hover:bg-paper-2 hover:text-ink"
                                aria-label={volume === 0 ? t('player.volumeOn') : t('player.mute')}
                                onClick={() => void setVolume(volume === 0 ? lastVolumeRef.current || 0.7 : 0)}
                            >
                                <VolumeIcon volume={volume} />
                            </button>
                        </AppTooltip>
                        <Slider
                            variant="volume"
                            aria-label={t('player.volume')}
                            min={0}
                            max={100}
                            step={1}
                            value={Math.round(volume * 100)}
                            onChange={(next) => void setVolume(next / 100)}
                            className="hidden w-20 sm:flex"
                        />
                        <AppTooltip label={t('player.exitFullscreen')}>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setLyricsFullscreen(false)}
                                aria-label={t('player.exitFullscreen')}
                            >
                                <Minimize2 className="h-4 w-4" />
                            </Button>
                        </AppTooltip>
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    const queueDrawer = (
        <>
            <div
                className={cn(
                    'fixed inset-x-0 z-[44]',
                    queueOpen ? 'pointer-events-auto' : 'pointer-events-none',
                )}
                style={{
                    top: '4rem',
                    bottom: 'var(--player-bar-height, 5rem)',
                }}
                onClick={() => setQueueOpen(false)}
                aria-hidden
            />
            <aside
                className={cn(
                    'fixed right-0 z-[45] flex w-80 max-w-[calc(100vw-1.25rem)] flex-col border-l border-t border-line bg-paper shadow-[var(--player-shadow)] transition-transform duration-300 ease-out',
                    queueOpen ? 'translate-x-0' : 'pointer-events-none translate-x-full',
                )}
                style={{
                    top: '4rem',
                    bottom: 'var(--player-bar-height, 5rem)',
                }}
                aria-hidden={!queueOpen}
                aria-label={t('player.queue')}
            >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-3">
                    <div className="min-w-0">
                        <p className="truncate text-base font-medium">{t('player.queue')}</p>
                        {queue?.mode === 'radio' && <p className="text-sm text-muted">{t('player.radio')}</p>}
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => setQueueOpen(false)}
                        aria-label={t('player.closeQueue')}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                {upcoming.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted">{t('player.noUpcoming')}</p>
                ) : (
                    <ul className="min-h-0 flex-1 overflow-y-auto p-2">
                        {upcoming.map(({ orderIndex, track: item }) => (
                            <li key={`${item.uri}-${orderIndex}`}>
                                <div className="flex items-center gap-1 rounded-lg px-1 py-1.5 hover:bg-paper-2/80">
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        disabled={playbackLocked}
                                        onClick={() => void playQueueCursor(orderIndex)}
                                    >
                                        {item.albumArtUrl ? (
                                            <img
                                                src={item.albumArtUrl}
                                                alt=""
                                                className="h-14 w-14 shrink-0 rounded-md object-cover"
                                            />
                                        ) : (
                                            <span className="h-14 w-14 shrink-0 rounded-md bg-paper-2" />
                                        )}
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-base font-medium leading-tight">
                                                {item.title}
                                            </span>
                                            <span className="mt-0.5 block truncate text-sm leading-tight text-muted">
                                                {item.artist}
                                            </span>
                                        </span>
                                    </button>
                                    {queue?.mode === 'radio' && (
                                        <AppTooltip label={t('player.removeFromQueue')}>
                                            <button
                                                type="button"
                                                className="rounded p-1.5 text-muted hover:bg-paper-2 hover:text-ink"
                                                aria-label={t('common.remove')}
                                                onClick={() => removeUpcoming(orderIndex)}
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </AppTooltip>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </aside>
        </>
    );

    if (collapsed) {
        return (
            <>
                {fullscreenOverlay}
                {queueDrawer}
                <div ref={barRef} className={cn(glassBarClass, partyMode && 'party-player-bar')}>
                    <div className="h-0.5 w-full bg-ink/10">
                        <div
                            className="h-full bg-gradient-to-r from-accent to-accent-soft transition-[width] duration-150 ease-out"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>

                    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 sm:px-6">
                        <div className="min-w-0 justify-self-start">{meta}</div>

                        <div className="flex flex-col items-center gap-0.5 justify-self-center">
                            <AppTooltip label={playing ? t('common.pause') : t('common.play')}>
                                <Button
                                    type="button"
                                    variant="accent"
                                    size="icon"
                                    disabled={!ready || playbackLocked}
                                    onClick={onToggle}
                                    aria-label={playing ? t('common.pause') : t('common.play')}
                                    className="h-9 w-9 rounded-full shadow-sm"
                                >
                                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
                                </Button>
                            </AppTooltip>
                            <span className="text-[10px] tabular-nums text-muted">
                                {formatTime(displayPosition)}
                                {durationMs > 0 ? ` / ${formatTime(durationMs)}` : ''}
                            </span>
                        </div>

                        <div className="justify-self-end">{collapseToggle}</div>
                    </div>
                </div>
            </>
        );
    }

    return (
        <>
            {fullscreenOverlay}
            {queueDrawer}
            <div ref={barRef} className={cn(glassBarClass, partyMode && 'party-player-bar')}>
                {lyricsMode === 'mini' && (
                    <div className="border-b border-line/60 bg-paper/50 px-4 py-2 sm:px-6">
                        <div className="mx-auto flex max-w-3xl items-center gap-2">
                            <div className="flex shrink-0 items-center gap-0.5">
                                <AppTooltip label={t('player.lyricsSmaller')}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        disabled={lyricsScale <= MIN_LYRICS_SCALE}
                                        onClick={() => bumpLyricsScale(-LYRICS_SCALE_STEP)}
                                        aria-label={t('player.lyricsSmaller')}
                                    >
                                        <Minus className="h-3.5 w-3.5" />
                                    </Button>
                                </AppTooltip>
                                <span className="w-9 text-center text-[10px] tabular-nums text-muted">
                                    {Math.round(lyricsScale * 100)}%
                                </span>
                                <AppTooltip label={t('player.lyricsLarger')}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        disabled={lyricsScale >= MAX_LYRICS_SCALE}
                                        onClick={() => bumpLyricsScale(LYRICS_SCALE_STEP)}
                                        aria-label={t('player.lyricsLarger')}
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                    </Button>
                                </AppTooltip>
                            </div>
                            <div className="min-w-0 flex-1">
                                <FitText
                                    key={currentLyricLine ?? 'empty'}
                                    text={currentLyricLine ?? (hasLyrics ? '♪' : t('player.lyricsNone'))}
                                    maxRem={0.875 * lyricsScale}
                                    minRem={0.65}
                                    className="text-center font-display font-medium tracking-tight text-ink"
                                />
                            </div>
                            <AppTooltip label={t('player.lyricsFullscreen')}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    onClick={() => setLyricsFullscreen(true)}
                                    aria-label={t('player.lyricsFullscreen')}
                                >
                                    <Maximize2 className="h-3.5 w-3.5" />
                                </Button>
                            </AppTooltip>
                        </div>
                    </div>
                )}

                {lyricsMode === 'full' && (
                    <div className="border-b border-line/60 bg-paper/50">
                        <AppTooltip label={t('player.resizeHint')}>
                            <button
                                type="button"
                                className="flex w-full cursor-ns-resize items-center justify-center gap-2 py-1.5 text-muted transition hover:bg-paper-2/60 hover:text-ink"
                                aria-label={t('player.resizeAria')}
                                onPointerDown={(e) => {
                                    e.preventDefault();
                                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                                    onLyricsDragStart(e.clientY);
                                }}
                            >
                                <span className="h-1 w-10 rounded-full bg-ink/20" />
                            </button>
                        </AppTooltip>
                        <div className="flex items-center justify-end gap-1 px-4 pb-1 sm:px-6">
                            <AppTooltip label={t('player.lyricsFullscreen')}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setLyricsFullscreen(true)}
                                    aria-label={t('player.lyricsFullscreen')}
                                >
                                    <Maximize2 className="h-3.5 w-3.5" />
                                </Button>
                            </AppTooltip>
                        </div>
                        <div className="overflow-y-auto px-4 pb-4 sm:px-6" style={{ height: lyricsHeight }}>
                            {renderLyricsList(activeLineRef)}
                        </div>
                    </div>
                )}

                <div className="w-full px-4 py-3 sm:px-6">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(0,1.4fr)_minmax(10rem,1fr)] sm:gap-4">
                        <div className="min-w-0 justify-self-start">{meta}</div>

                        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                            <div className="flex items-center justify-center gap-1 sm:gap-1.5">
                                <AppTooltip label={t('player.shuffle')}>
                                    <Button
                                        type="button"
                                        variant={shuffle ? 'accent' : 'ghost'}
                                        size="icon"
                                        className="h-8 w-8"
                                        disabled={!inPlaylist}
                                        onClick={toggleShuffle}
                                        aria-label={t('player.shuffleAria')}
                                    >
                                        <Shuffle className="h-4 w-4" />
                                    </Button>
                                </AppTooltip>

                                <AppTooltip label={t('player.previous')}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        disabled={!canPrev || playbackLocked}
                                        onClick={() => void playPrevious()}
                                        aria-label={t('player.previous')}
                                    >
                                        <SkipBack className="h-4 w-4" />
                                    </Button>
                                </AppTooltip>

                                <AppTooltip label={playing ? t('common.pause') : t('common.play')}>
                                    <Button
                                        type="button"
                                        variant="accent"
                                        size="icon"
                                        disabled={!ready || playbackLocked}
                                        onClick={onToggle}
                                        aria-label={playing ? t('common.pause') : t('common.play')}
                                        className="h-10 w-10 rounded-full shadow-sm"
                                    >
                                        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
                                    </Button>
                                </AppTooltip>

                                <AppTooltip label={t('player.next')}>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        disabled={(!canNext && !inRoom) || playbackLocked}
                                        onClick={onNext}
                                        aria-label={t('player.next')}
                                    >
                                        <SkipForward className="h-4 w-4" />
                                    </Button>
                                </AppTooltip>

                                <AppTooltip label={t('player.repeatOne')}>
                                    <Button
                                        type="button"
                                        variant={repeatOne ? 'accent' : 'ghost'}
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={toggleRepeatOne}
                                        aria-label={t('player.repeatSong')}
                                    >
                                        <Repeat1 className="h-4 w-4" />
                                    </Button>
                                </AppTooltip>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted">
                                    {formatTime(displayPosition)}
                                </span>
                                <Slider
                                    variant="progress"
                                    aria-label={t('player.seek')}
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
                                <AppTooltip
                                    label={
                                        durationMs > 0
                                            ? t('player.remainingTotal', { time: formatTime(durationMs) })
                                            : t('player.durationUnknown')
                                    }
                                >
                                    <span
                                        className={cn('w-10 shrink-0 text-[11px] tabular-nums text-muted')}
                                    >
                                        {durationMs > 0 ? `-${formatTime(remainingMs)}` : '--:--'}
                                    </span>
                                </AppTooltip>
                            </div>
                        </div>

                        <div className="flex w-auto shrink-0 items-center justify-end gap-1 justify-self-end sm:w-52 sm:gap-1.5">
                            {collapseToggle}

                            <AppTooltip
                                label={t('player.lyricsCycle', { label: lyricsModeLabel(lyricsMode, t) })}
                            >
                                <Button
                                    type="button"
                                    variant={lyricsMode === 'hidden' ? 'ghost' : 'accent'}
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={cycleLyricsMode}
                                    aria-label={lyricsModeLabel(lyricsMode, t)}
                                >
                                    <LyricsModeIcon mode={lyricsMode} />
                                </Button>
                            </AppTooltip>

                            {inPlaylist && (
                                <AppTooltip label={queueOpen ? t('player.closeQueue') : t('player.queue')}>
                                    <Button
                                        type="button"
                                        variant={queueOpen ? 'accent' : 'ghost'}
                                        size="icon"
                                        className="h-8 w-8 shrink-0"
                                        onClick={() => setQueueOpen((open) => !open)}
                                        aria-label={queueOpen ? t('player.closeQueue') : t('player.queue')}
                                    >
                                        <ListMusic className="h-4 w-4" />
                                    </Button>
                                </AppTooltip>
                            )}

                            <AppTooltip label={volume === 0 ? t('player.volumeOn') : t('player.mute')}>
                                <button
                                    type="button"
                                    className="rounded-md p-1.5 text-muted transition hover:bg-paper-2 hover:text-ink"
                                    aria-label={volume === 0 ? t('player.volumeOn') : t('player.mute')}
                                    onClick={() => void setVolume(volume === 0 ? lastVolumeRef.current || 0.7 : 0)}
                                >
                                    <VolumeIcon volume={volume} />
                                </button>
                            </AppTooltip>
                            <Slider
                                variant="volume"
                                aria-label={t('player.volume')}
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
                    {!ready && !error && <p className="mt-2 text-xs text-muted">{t('player.initializing')}</p>}
                </div>
            </div>
        </>
    );
}
