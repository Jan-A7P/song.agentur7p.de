const STORAGE_KEY = 'songtexte.accent';
const HEX_PATTERN = /^#([0-9a-f]{6})$/i;

export const DEFAULT_ACCENT_LIGHT = '#d65de9';
export const DEFAULT_ACCENT_DARK = '#d65de9';

export const ACCENT_PRESETS = [
    '#d65de9',
    '#c45c26',
    '#b45309',
    '#9a3412',
    '#dc2626',
    '#be185d',
    '#7c3aed',
    '#2563eb',
    '#0f766e',
    '#15803d',
] as const;

type AccentListener = (accent: string | null) => void;

const listeners = new Set<AccentListener>();

export function normalizeAccent(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (!HEX_PATTERN.test(withHash)) {
        return null;
    }
    return withHash.toLowerCase();
}

function readStoredAccent(): string | null {
    try {
        return normalizeAccent(localStorage.getItem(STORAGE_KEY));
    } catch {
        return null;
    }
}

let current = typeof window === 'undefined' ? null : readStoredAccent();

export function applyAccentColor(hex: string | null): void {
    if (typeof document === 'undefined') {
        return;
    }
    const root = document.documentElement;
    if (!hex) {
        root.style.removeProperty('--accent');
        root.removeAttribute('data-accent');
        return;
    }
    root.style.setProperty('--accent', hex);
    root.setAttribute('data-accent', hex);
}

export function getAccentColor(): string | null {
    return current;
}

export function setAccentColor(hex: string | null): void {
    const next = hex ? normalizeAccent(hex) : null;
    current = next;
    try {
        if (next) {
            localStorage.setItem(STORAGE_KEY, next);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // ignore
    }
    applyAccentColor(next);
    listeners.forEach((listener) => {
        try {
            listener(next);
        } catch {
            // ignore
        }
    });
}

export function subscribeAccentColor(listener: AccentListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

if (typeof document !== 'undefined') {
    applyAccentColor(current);
}
