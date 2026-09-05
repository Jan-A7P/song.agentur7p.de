export const SUPPORTED_LOCALES = ['en', 'de'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: Locale = 'en';

export const LOCALE_STORAGE_KEY = 'songtexte.locale';

export type TranslateParams = Record<string, string | number>;

export type MessageTree = {
    [key: string]: string | MessageTree;
};
