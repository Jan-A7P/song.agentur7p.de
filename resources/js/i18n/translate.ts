import { dictionaries } from './messages';
import { FALLBACK_LOCALE, type Locale, type MessageTree, type TranslateParams } from './types';

function lookup(tree: MessageTree, key: string): string | MessageTree | undefined {
    const parts = key.split('.');
    let current: string | MessageTree | undefined = tree;
    for (const part of parts) {
        if (!current || typeof current === 'string') {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

function interpolate(template: string, params?: TranslateParams): string {
    if (!params) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = params[name];
        return value == null ? `{${name}}` : String(value);
    });
}

export function translate(locale: Locale, key: string, params?: TranslateParams): string {
    const primary = dictionaries[locale] as unknown as MessageTree;
    const fallback = dictionaries[FALLBACK_LOCALE] as unknown as MessageTree;
    const count = typeof params?.count === 'number' ? params.count : undefined;
    const plural = count === 1 ? 'one' : count != null ? 'other' : null;

    const resolve = (tree: MessageTree): string | undefined => {
        if (plural) {
            const branched = lookup(tree, `${key}.${plural}`);
            if (typeof branched === 'string') {
                return branched;
            }
        }
        const direct = lookup(tree, key);
        return typeof direct === 'string' ? direct : undefined;
    };

    const template = resolve(primary) ?? resolve(fallback) ?? key;
    return interpolate(template, params);
}
