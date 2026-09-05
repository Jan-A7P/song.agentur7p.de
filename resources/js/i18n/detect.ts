import { FALLBACK_LOCALE, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, type Locale } from './types';

function normalizeLocale(value: string | null | undefined): Locale | null {
    if (!value) {
        return null;
    }
    const base = value.toLowerCase().split(/[-_]/)[0];
    return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : null;
}

export function readStoredLocale(): Locale | null {
    try {
        return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    } catch {
        return null;
    }
}

export function detectBrowserLocale(): Locale {
    const candidates = [
        ...(typeof navigator !== 'undefined' ? navigator.languages ?? [] : []),
        typeof navigator !== 'undefined' ? navigator.language : undefined,
    ];
    for (const candidate of candidates) {
        const locale = normalizeLocale(candidate);
        if (locale) {
            return locale;
        }
    }
    return FALLBACK_LOCALE;
}

export function detectLocale(): Locale {
    return readStoredLocale() ?? detectBrowserLocale();
}

export function persistLocale(locale: Locale): void {
    try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
        // ignore quota / private mode
    }
}

export function applyDocumentLocale(locale: Locale): void {
    if (typeof document === 'undefined') {
        return;
    }
    document.documentElement.lang = locale;
}

export function dateLocale(locale: Locale): string {
    return locale === 'de' ? 'de-DE' : 'en-US';
}
