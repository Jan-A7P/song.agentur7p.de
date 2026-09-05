import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const STORAGE_KEY = 'songtexte.scrollPositions';

function readPositions(): Record<string, number> {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw) as Record<string, number>;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writePositions(positions: Record<string, number>) {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
    } catch {
        // ignore
    }
}

function locationKey(pathname: string, search: string): string {
    return `${pathname}${search}`;
}

function currentScrollY(): number {
    return window.scrollY || document.documentElement.scrollTop || 0;
}

function maxScrollY(): number {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

/**
 * Saves window scroll per route and restores it when navigating back,
 * including after async list content mounts.
 *
 * Positions are recorded only from real scroll events (and successful restores).
 * Cleanup must not read scrollY — after unmount the browser clamps it to 0.
 */
export function ScrollRestoration() {
    const location = useLocation();
    const positionsRef = useRef<Record<string, number>>(readPositions());
    const keyRef = useRef(locationKey(location.pathname, location.search));
    const key = locationKey(location.pathname, location.search);
    keyRef.current = key;

    useLayoutEffect(() => {
        positionsRef.current = { ...positionsRef.current, ...readPositions() };
        const target = positionsRef.current[key] ?? 0;
        let cancelled = false;
        let settled = false;

        const apply = () => {
            if (cancelled || settled) {
                return;
            }

            if (target <= 0) {
                window.scrollTo(0, 0);
                settled = true;
                return;
            }

            if (maxScrollY() < target - 8) {
                return;
            }

            window.scrollTo(0, target);
            window.requestAnimationFrame(() => {
                if (cancelled) {
                    return;
                }
                window.scrollTo(0, target);
                positionsRef.current[key] = target;
                writePositions(positionsRef.current);
                if (Math.abs(currentScrollY() - target) <= 12) {
                    settled = true;
                }
            });
        };

        apply();

        const observer = new ResizeObserver(() => apply());
        observer.observe(document.documentElement);

        // Retry a few frames later for list caches that hydrate after first paint.
        const rafRetry = window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => apply());
        });

        const timeoutId = window.setTimeout(() => {
            if (!cancelled && !settled && target > 0) {
                window.scrollTo(0, target);
                positionsRef.current[key] = target;
                writePositions(positionsRef.current);
                settled = true;
            }
        }, 8000);

        return () => {
            cancelled = true;
            observer.disconnect();
            window.cancelAnimationFrame(rafRetry);
            window.clearTimeout(timeoutId);
        };
    }, [key]);

    useEffect(() => {
        let frame = 0;

        const onScroll = () => {
            const k = keyRef.current;
            positionsRef.current[k] = currentScrollY();
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(() => {
                writePositions(positionsRef.current);
            });
        };

        window.addEventListener('scroll', onScroll, { passive: true });

        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
            // Flush last known positions — do not read scrollY here.
            writePositions(positionsRef.current);
        };
    }, [key]);

    return null;
}
