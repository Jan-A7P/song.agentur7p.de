import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { findActiveLrcIndex, parseLrc } from '@/lib/lrc';
import { usePlayer } from '@/context/player-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
    lyrics: string;
    songId: number;
    spotifyUri: string | null;
};

type ViewMode = 'synced' | 'plain';

const LINE_STEP_PX = 56;
const VISIBLE_LINES = 3;

function clampCenter(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return Math.min(Math.max(index, 0), length - 1);
}

export function SyncedLyrics({ lyrics, songId, spotifyUri }: Props) {
    const { track, positionMs, playing, seek } = usePlayer();
    const parsed = useMemo(() => parseLrc(lyrics), [lyrics]);
    const [mode, setMode] = useState<ViewMode>(parsed.isLrc ? 'synced' : 'plain');
    const [autoFollow, setAutoFollow] = useState(true);
    const [manualCenter, setManualCenter] = useState(0);
    const touchStartY = useRef<number | null>(null);
    const lastSongKey = useRef(`${songId}:${spotifyUri ?? ''}`);

    const isCurrentTrack =
        Boolean(spotifyUri) && track?.uri === spotifyUri && (track.songId === undefined || track.songId === songId);

    const playbackIndex = useMemo(() => {
        if (!parsed.isLrc) {
            return 0;
        }
        if (!isCurrentTrack) {
            return 0;
        }
        const found = findActiveLrcIndex(parsed.lines, positionMs);
        return found >= 0 ? found : 0;
    }, [parsed, isCurrentTrack, positionMs]);

    useEffect(() => {
        setMode(parsed.isLrc ? 'synced' : 'plain');
    }, [parsed.isLrc, lyrics]);

    useEffect(() => {
        const key = `${songId}:${spotifyUri ?? ''}`;
        if (lastSongKey.current !== key) {
            lastSongKey.current = key;
            setAutoFollow(true);
            setManualCenter(0);
        }
    }, [songId, spotifyUri]);

    useEffect(() => {
        if (isCurrentTrack && playing && positionMs < 1500) {
            setAutoFollow(true);
        }
    }, [isCurrentTrack, playing, track?.uri, positionMs]);

    useEffect(() => {
        if (autoFollow) {
            setManualCenter(playbackIndex);
        }
    }, [autoFollow, playbackIndex]);

    const center = autoFollow ? playbackIndex : manualCenter;
    const safeCenter = clampCenter(center, parsed.lines.length);

    const nudge = useCallback(
        (delta: number) => {
            setAutoFollow(false);
            setManualCenter((prev) => clampCenter((autoFollow ? playbackIndex : prev) + delta, parsed.lines.length));
        },
        [autoFollow, playbackIndex, parsed.lines.length],
    );

    const onWheel = (event: React.WheelEvent) => {
        if (Math.abs(event.deltaY) < 2) {
            return;
        }
        event.preventDefault();
        nudge(event.deltaY > 0 ? 1 : -1);
    };

    const onTouchStart = (event: React.TouchEvent) => {
        touchStartY.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchEnd = (event: React.TouchEvent) => {
        if (touchStartY.current == null) {
            return;
        }
        const endY = event.changedTouches[0]?.clientY;
        if (endY == null) {
            touchStartY.current = null;
            return;
        }
        const delta = touchStartY.current - endY;
        touchStartY.current = null;
        if (Math.abs(delta) < 28) {
            return;
        }
        nudge(delta > 0 ? 1 : -1);
    };

    const resumeFollow = () => {
        setAutoFollow(true);
        setManualCenter(playbackIndex);
    };

    const pauseFollow = () => {
        setAutoFollow(false);
        setManualCenter(playbackIndex);
    };

    if (!parsed.isLrc) {
        return <pre className="whitespace-pre-wrap font-sans text-base leading-8 text-ink/90">{lyrics}</pre>;
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Badge className="border-accent/20 bg-accent/10 text-accent">LRC verfügbar</Badge>

                <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'synced' ? 'default' : 'ghost'}
                        className="h-8"
                        onClick={() => setMode('synced')}
                    >
                        LRC
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'plain' ? 'default' : 'ghost'}
                        className="h-8"
                        onClick={() => setMode('plain')}
                    >
                        Volltext
                    </Button>
                </div>
            </div>

            {mode === 'plain' ? (
                <pre className="whitespace-pre-wrap font-sans text-base leading-8 text-ink/90">{parsed.plainText}</pre>
            ) : (
                <div
                    className="group relative touch-pan-y overflow-hidden rounded-2xl border border-line/80 bg-surface px-4 py-8 sm:px-8"
                    onWheel={onWheel}
                    onTouchStart={onTouchStart}
                    onTouchEnd={onTouchEnd}
                >
                    <button
                        type="button"
                        onClick={autoFollow ? pauseFollow : resumeFollow}
                        aria-label={autoFollow ? 'Auto-Mitlaufen pausieren' : 'Auto-Mitlaufen fortsetzen'}
                        className={cn(
                            'absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-line/80 bg-paper/90 text-ink shadow-sm backdrop-blur transition-opacity duration-200 hover:bg-paper',
                            autoFollow
                                ? 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
                                : 'opacity-100',
                        )}
                    >
                        {autoFollow ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}
                    </button>

                    <div
                        className="relative mx-auto max-w-2xl overflow-hidden"
                        style={{ height: LINE_STEP_PX * VISIBLE_LINES }}
                    >
                        <ul
                            className="will-change-transform"
                            style={{
                                transform: `translateY(${-safeCenter * LINE_STEP_PX}px)`,
                                transition: 'transform 650ms cubic-bezier(0.22, 1, 0.36, 1)',
                            }}
                        >
                            {parsed.lines.map((line, index) => {
                                const isCurrent = index === safeCenter;
                                const distance = Math.abs(index - safeCenter);
                                const inView = distance <= VISIBLE_LINES;

                                return (
                                    <li
                                        key={`${line.timeMs}-${index}`}
                                        className="flex items-center justify-center"
                                        style={{ height: LINE_STEP_PX }}
                                    >
                                        <button
                                            type="button"
                                            tabIndex={inView ? 0 : -1}
                                            onClick={() => {
                                                if (isCurrentTrack) {
                                                    void seek(line.timeMs);
                                                }
                                                if (!autoFollow) {
                                                    setManualCenter(index);
                                                }
                                            }}
                                            disabled={!isCurrentTrack}
                                            className={cn(
                                                'w-full rounded-xl px-3 py-1.5 text-center transition-[color,opacity,transform,font-weight,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                                isCurrentTrack && 'hover:bg-paper-2/60',
                                                isCurrent && 'bg-accent/10',
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'block leading-snug transition-[font-size,opacity,transform,color,font-weight] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                                    isCurrent
                                                        ? 'scale-100 text-xl font-semibold text-ink opacity-100 sm:text-2xl'
                                                        : distance === 1
                                                          ? 'scale-[0.98] text-base text-ink/70 opacity-70 sm:text-lg'
                                                          : 'scale-95 text-base text-ink/45 opacity-40 sm:text-lg',
                                                )}
                                            >
                                                {line.text || '♪'}
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
