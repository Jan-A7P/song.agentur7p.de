const STORAGE_KEY = 'songtexte.partyMode';

type PartyListener = (enabled: boolean) => void;

const listeners = new Set<PartyListener>();

function readEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function applyPartyModeClass(enabled: boolean): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.documentElement.classList.toggle('party', enabled);
}

export function isPartyModeEnabled(): boolean {
    return readEnabled();
}

export function setPartyModeEnabled(enabled: boolean): void {
    try {
        if (enabled) {
            localStorage.setItem(STORAGE_KEY, '1');
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // ignore
    }
    applyPartyModeClass(enabled);
    listeners.forEach((listener) => {
        try {
            listener(enabled);
        } catch {
            // ignore
        }
    });
}

export function subscribePartyMode(listener: PartyListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
