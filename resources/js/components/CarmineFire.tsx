import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/context/theme-context';
import { isCarmineModeEnabled, subscribeCarmineMode } from '@/lib/carmine-mode';
import { createCarmineFireScene, type CarmineFireScene } from '@/lib/carmine-fire-scene';

function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CarmineFire() {
    const { theme } = useTheme();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<CarmineFireScene | null>(null);
    const [enabled, setEnabled] = useState(isCarmineModeEnabled);
    const [useCanvas, setUseCanvas] = useState(() => !prefersReducedMotion());

    useEffect(() => subscribeCarmineMode(setEnabled), []);

    useEffect(() => {
        if (!enabled || !useCanvas) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const scene = createCarmineFireScene(canvas, { dark: theme === 'dark' });
        if (!scene) {
            setUseCanvas(false);
            return;
        }
        sceneRef.current = scene;
        return () => {
            scene.dispose();
            sceneRef.current = null;
        };
        // Theme is applied via setDark; recreating the renderer on toggle is wasteful.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, useCanvas]);

    useEffect(() => {
        sceneRef.current?.setDark(theme === 'dark');
    }, [theme]);

    if (!enabled) {
        return null;
    }

    return (
        <div className="carmine-fire" aria-hidden>
            <div className="carmine-fire__glow" />
            {useCanvas ? <canvas ref={canvasRef} className="carmine-fire__canvas" /> : null}
        </div>
    );
}
