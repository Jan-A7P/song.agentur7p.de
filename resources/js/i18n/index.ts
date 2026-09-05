import { applyDocumentLocale, dateLocale, detectLocale, persistLocale } from './detect';
import { translate } from './translate';
import type { Locale, TranslateParams } from './types';

export type { Locale, TranslateParams } from './types';
export { SUPPORTED_LOCALES, FALLBACK_LOCALE, LOCALE_STORAGE_KEY } from './types';
export { dateLocale, detectBrowserLocale, detectLocale } from './detect';

let currentLocale: Locale = detectLocale();
applyDocumentLocale(currentLocale);

const listeners = new Set<(locale: Locale) => void>();

export function getLocale(): Locale {
    return currentLocale;
}

export function setLocale(locale: Locale): void {
    if (locale === currentLocale) {
        persistLocale(locale);
        applyDocumentLocale(locale);
        return;
    }
    currentLocale = locale;
    persistLocale(locale);
    applyDocumentLocale(locale);
    listeners.forEach((listener) => listener(locale));
}

export function subscribeLocale(listener: (locale: Locale) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function t(key: string, params?: TranslateParams): string {
    return translate(currentLocale, key, params);
}
