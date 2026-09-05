import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { findActiveLrcIndex, parseLrc } from '@/lib/lrc';
import { usePlayer } from '@/context/player-context';
import { useI18n } from '@/context/locale-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/tooltip';
import { FitText } from '@/components/FitText';
import { cn } from '@/lib/utils';

type Props = {
    lyrics: string;
    songId: string;
    trackUri: string | null;
};

type ViewMode = 'synced' | 'plain';

const VIEWPORT_PX = 200;

function clampCenter(index: number, length: number): number {
    if (length <= 0) {
        return 0;
    }
    return Math.min(Math.max(index, 0), length - 1);
}

export function SyncedLyrics({ lyrics, songId, trackUri }: Props) {
    const { t } = useI18n();
    const { track, positionMs, playing, seek } = usePlayer();
    const parsed = useMemo(() => parseLrc(lyrics), [lyrics]);
    const [mode, setMode] = useState<ViewMode>(parsed.isLrc ? 'synced' : 'plain');
    const [autoFollow, setAutoFollow] = useState(true);
    const [manualCenter, setManualCenter] = useState(0);
    const touchStartY = useRef<number | null>(null);
    const lastSongKey = useRef(`${songId}:${trackUri ?? ''}`);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const lineRefs = useRef<Array<HTMLLIElement | null>>([]);

    const isCurrentTrack =
        Boolean(trackUri) && track?.uri === trackUri && (track.songId === undefined || track.songId === songId);

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
        const key = `${songId}:${trackUri ?? ''}`;
        if (lastSongKey.current !== key) {
            lastSongKey.current = key;
            setAutoFollow(true);
            setManualCenter(0);
        }
    }, [songId, trackUri]);

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

    useEffect(() => {
        const node = lineRefs.current[safeCenter];
        const viewport = viewportRef.current;
        if (!node || !viewport) {
            return;
        }
        const nodeTop = node.offsetTop;
        const nodeHeight = node.offsetHeight;
        const target = nodeTop - viewport.clientHeight / 2 + nodeHeight / 2;
        viewport.scrollTo({
            top: Math.max(0, target),
            behavior: 'smooth',
        });
    }, [safeCenter, mode]);

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
                <Badge className="border-accent/20 bg-accent/10 text-accent">{t('form.lrcAvailable')}</Badge>

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
                        {t('form.fullText')}
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
                    <AppTooltip label={autoFollow ? t('form.autoFollowPause') : t('form.autoFollowResume')}>
                        <button
                            type="button"
                            onClick={autoFollow ? pauseFollow : resumeFollow}
                            aria-label={autoFollow ? t('form.autoFollowPause') : t('form.autoFollowResume')}
                            className={cn(
                                'absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-line/80 bg-paper/90 text-ink shadow-sm backdrop-blur transition-opacity duration-200 hover:bg-paper',
                                autoFollow
                                    ? 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
                                    : 'opacity-100',
                            )}
                        >
                            {autoFollow ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 pl-0.5" />}
                        </button>
                    </AppTooltip>

                    <div
                        ref={viewportRef}
                        className="relative mx-auto max-w-2xl overflow-y-hidden"
                        style={{ height: VIEWPORT_PX }}
                    >
                        <ul className="flex flex-col gap-1" style={{ paddingBlock: VIEWPORT_PX / 2 - 24 }}>
                            {parsed.lines.map((line, index) => {
                                const isCurrent = index === safeCenter;
                                const distance = Math.abs(index - safeCenter);
                                const inView = distance <= 4;

                                return (
                                    <li
                                        key={`${line.timeMs}-${index}`}
                                        ref={(el) => {
                                            lineRefs.current[index] = el;
                                        }}
                                        className="flex justify-center"
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
                                                'w-full rounded-xl px-3 py-2 text-center transition-[color,opacity,background-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                                isCurrentTrack && 'hover:bg-paper-2/60',
                                                isCurrent && 'bg-accent/10',
                                            )}
                                        >
                                            <FitText
                                                text={line.text.trim() || '♪'}
                                                maxRem={isCurrent ? 1.5 : distance === 1 ? 1.125 : 1}
                                                minRem={0.7}
                                                className={cn(
                                                    'transition-[opacity,color,font-weight] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                                    isCurrent
                                                        ? 'font-semibold text-ink opacity-100'
                                                        : distance === 1
                                                          ? 'text-ink/70 opacity-70'
                                                          : 'text-ink/45 opacity-40',
                                                )}
                                            />
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
