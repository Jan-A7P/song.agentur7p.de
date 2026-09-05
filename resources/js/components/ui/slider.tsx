import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

type SliderProps = {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    onChange: (value: number) => void;
    onChangeEnd?: (value: number) => void;
    className?: string;
    trackClassName?: string;
    'aria-label': string;
    variant?: 'progress' | 'volume';
};

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function Slider({
    value,
    min = 0,
    max = 100,
    step = 1,
    disabled = false,
    onChange,
    onChangeEnd,
    className,
    trackClassName,
    'aria-label': ariaLabel,
    variant = 'progress',
}: SliderProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const [hovering, setHovering] = useState(false);
    const range = Math.max(max - min, 0.0001);
    const percent = clamp(((value - min) / range) * 100, 0, 100);
    const active = hovering || dragging;

    const valueFromClientX = useCallback(
        (clientX: number) => {
            const track = trackRef.current;
            if (!track) {
                return value;
            }

            const rect = track.getBoundingClientRect();
            const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
            const raw = min + ratio * range;
            const stepped = Math.round(raw / step) * step;
            return clamp(stepped, min, max);
        },
        [max, min, range, step, value],
    );

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (disabled) {
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        setDragging(true);
        const next = valueFromClientX(event.clientX);
        onChange(next);
    };

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (!dragging || disabled) {
            return;
        }

        onChange(valueFromClientX(event.clientX));
    };

    const endDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (!dragging) {
            return;
        }

        setDragging(false);
        const next = valueFromClientX(event.clientX);
        onChange(next);
        onChangeEnd?.(next);

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) {
            return;
        }

        const largeStep = step * 10;
        let next = value;

        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowUp':
                next = value + step;
                break;
            case 'ArrowLeft':
            case 'ArrowDown':
                next = value - step;
                break;
            case 'PageUp':
                next = value + largeStep;
                break;
            case 'PageDown':
                next = value - largeStep;
                break;
            case 'Home':
                next = min;
                break;
            case 'End':
                next = max;
                break;
            default:
                return;
        }

        event.preventDefault();
        next = clamp(next, min, max);
        onChange(next);
        onChangeEnd?.(next);
    };

    const isVolume = variant === 'volume';

    return (
        <div
            ref={trackRef}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={ariaLabel}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-disabled={disabled}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            className={cn(
                'group relative flex touch-none select-none items-center outline-none',
                isVolume ? 'h-8 w-full max-w-28' : 'h-8 w-full',
                disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                className,
            )}
        >
            <div
                className={cn(
                    'relative w-full overflow-hidden rounded-full bg-ink/10 transition-[height] duration-200 ease-out',
                    isVolume ? (active ? 'h-1.5' : 'h-1') : active ? 'h-2' : 'h-1.5',
                    trackClassName,
                )}
            >
                <div
                    className={cn(
                        'absolute inset-y-0 left-0 rounded-full transition-[width] duration-75 ease-out',
                        isVolume
                            ? 'bg-gradient-to-r from-ink/70 to-ink'
                            : 'bg-gradient-to-r from-accent to-accent-soft',
                    )}
                    style={{ width: `${percent}%` }}
                />
            </div>

            <div
                className={cn(
                    'pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paper shadow-[0_1px_4px_rgba(26,23,20,0.28),0_0_0_1px_rgba(26,23,20,0.12)] ring-1 ring-line transition-transform duration-150 ease-out dark:shadow-[0_1px_4px_rgba(0,0,0,0.5)]',
                    isVolume ? 'h-3 w-3' : 'h-3.5 w-3.5',
                    active ? 'scale-125' : 'scale-100',
                    !active && !dragging && 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                    (active || dragging) && 'opacity-100',
                    'group-focus-visible:ring-2 group-focus-visible:ring-accent/35 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-paper',
                )}
                style={{ left: `${percent}%` }}
            />
        </div>
    );
}
