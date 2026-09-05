import { useMemo } from 'react';
import { FitText } from '@/components/FitText';
import type { LrcLine } from '@/lib/lrc';
import { cn } from '@/lib/utils';

type Props = {
    lines: LrcLine[];
    activeIndex: number;
    plainFallback?: string | null;
};

type StageItem = {
    id: string;
    text: string;
    index: number;
};

const STEP_PX = 88;
const EASE =
    'transform 620ms cubic-bezier(0.22, 1, 0.36, 1), opacity 520ms cubic-bezier(0.22, 1, 0.36, 1), font-weight 420ms ease';

/**
 * Synced lyrics stage: lines keep stable keys and slide between
 * previous / active / next slots via CSS transitions.
 */
export function FullscreenLyricsStage({ lines, activeIndex, plainFallback }: Props) {
    const cursor = activeIndex < 0 ? -1 : activeIndex;

    const items = useMemo<StageItem[]>(() => {
        if (lines.length === 0) {
            return [
                {
                    id: 'plain',
                    text: plainFallback?.trim() || '♪',
                    index: 0,
                },
            ];
        }

        return [
            { id: 'intro-note', text: '♪', index: -1 },
            ...lines.map((line, index) => ({
                id: `line-${index}`,
                text: line.text.trim() || '♪',
                index,
            })),
        ];
    }, [lines, plainFallback]);

    const visible = items.filter((item) => {
        const dist = item.index - cursor;
        return dist >= -1 && dist <= 1;
    });

    return (
        <div className="lyric-fs-stage relative mx-auto flex h-[13.5rem] w-full max-w-5xl items-center justify-center sm:h-[15.5rem]">
            {visible.map((item) => {
                const dist = item.index - cursor;
                const isActive = dist === 0;
                const isNext = dist === 1;
                const isPrev = dist === -1;

                return (
                    <div
                        key={item.id}
                        className={cn(
                            'pointer-events-none absolute inset-x-0 w-full min-w-0 px-2 will-change-transform sm:px-4',
                            isActive && 'z-20',
                            isNext && 'z-10',
                            isPrev && 'z-0',
                        )}
                        style={{
                            transform: `translateY(${dist * STEP_PX}px) scale(${isActive ? 1 : isNext ? 0.62 : 0.78})`,
                            opacity: isActive ? 1 : isNext ? 0.28 : 0,
                            transition: EASE,
                        }}
                    >
                        <FitText
                            text={item.text}
                            maxRem={3}
                            minRem={0.5}
                            className={cn(
                                'text-center font-display tracking-tight transition-[color,font-weight] duration-500',
                                isActive ? 'font-semibold text-ink' : 'font-medium text-muted',
                            )}
                        />
                    </div>
                );
            })}
        </div>
    );
}
