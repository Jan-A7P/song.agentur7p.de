const STORAGE_KEY = 'songtexte.carmine';

type CarmineListener = (enabled: boolean) => void;

const listeners = new Set<CarmineListener>();

function readEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function applyCarmineModeClass(enabled: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.documentElement.classList.toggle('carmine', enabled);
}

export function isCarmineModeEnabled(): boolean {
    return readEnabled();
}

export function setCarmineModeEnabled(enabled: boolean): void {
    try {
        if (enabled) {
            localStorage.setItem(STORAGE_KEY, '1');
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // ignore
    }
    applyCarmineModeClass(enabled);
    listeners.forEach((listener) => {
        try {
            listener(enabled);
        } catch {
            // ignore
        }
    });
}

export function subscribeCarmineMode(listener: CarmineListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

if (typeof document !== 'undefined') {
    applyCarmineModeClass(readEnabled());
}
