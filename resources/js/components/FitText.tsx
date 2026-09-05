import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type FitTextProps = {
    text: string;
    className?: string;
    /** Target font size in rem at full width. */
    maxRem?: number;
    /** Smallest allowed font size in rem. */
    minRem?: number;
};

/**
 * Single-line text that shrinks to fit the container width —
 * no wrapping, no ellipsis truncation.
 */
export function FitText({ text, className, maxRem = 3, minRem = 0.55 }: FitTextProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const textRef = useRef<HTMLSpanElement | null>(null);
    const [fontRem, setFontRem] = useState(maxRem);
    const [scale, setScale] = useState(1);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const node = textRef.current;
        if (!container || !node) {
            return;
        }

        const fit = () => {
            const available = container.clientWidth;
            if (available <= 0) {
                return;
            }

            node.style.transform = 'none';
            node.style.fontSize = `${maxRem}rem`;

            let lo = minRem;
            let hi = maxRem;
            let best = minRem;

            for (let i = 0; i < 16; i++) {
                const mid = (lo + hi) / 2;
                node.style.fontSize = `${mid}rem`;
                if (node.scrollWidth <= available + 0.5) {
                    best = mid;
                    lo = mid;
                } else {
                    hi = mid;
                }
            }

            node.style.fontSize = `${best}rem`;
            let nextScale = 1;
            if (node.scrollWidth > available + 0.5) {
                nextScale = Math.max(0.35, available / node.scrollWidth);
            }

            setFontRem(best);
            setScale(nextScale);
            node.style.transform = nextScale < 1 ? `scale(${nextScale})` : 'none';
        };

        fit();
        const raf = window.requestAnimationFrame(fit);

        const observer = new ResizeObserver(() => fit());
        observer.observe(container);
        return () => {
            window.cancelAnimationFrame(raf);
            observer.disconnect();
        };
    }, [text, maxRem, minRem]);

    return (
        <div ref={containerRef} className={cn('w-full min-w-0 overflow-visible', className)}>
            <span
                ref={textRef}
                className="mx-auto block w-max max-w-none origin-center whitespace-nowrap text-center leading-snug"
                style={{
                    fontSize: `${fontRem}rem`,
                    transform: scale < 1 ? `scale(${scale})` : undefined,
                }}
            >
                {text}
            </span>
        </div>
    );
}
