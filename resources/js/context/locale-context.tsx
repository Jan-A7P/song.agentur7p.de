import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getLocale, setLocale as applyLocale, subscribeLocale, t as translate, type Locale, type TranslateParams } from '@/i18n';

type LocaleContextValue = {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (key: string, params?: TranslateParams) => string;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(() => getLocale());

    useEffect(() => subscribeLocale(setLocaleState), []);

    const setLocale = useCallback((next: Locale) => {
        applyLocale(next);
    }, []);

    const t = useCallback((key: string, params?: TranslateParams) => translate(key, params), [locale]);

    const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleContextValue {
    const value = useContext(LocaleContext);
    if (!value) {
        throw new Error('useI18n must be used within LocaleProvider');
    }
    return value;
}
