import { t } from '@/i18n';

type ToastVariant = 'error' | 'success' | 'default';

export type ToastItem = {
    id: string;
    title?: string;
    message: string;
    variant: ToastVariant;
    createdAt: number;
};

type Listener = (toasts: ToastItem[]) => void;

const DEFAULT_DURATION_MS = 5500;
const DEDUPE_MS = 2500;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
const recentKeys = new Map<string, number>();
const timers = new Map<string, number>();

function emit(): void {
    listeners.forEach((listener) => listener(toasts));
}

function remove(id: string): void {
    const timer = timers.get(id);
    if (timer) {
        window.clearTimeout(timer);
        timers.delete(id);
    }
    toasts = toasts.filter((t) => t.id !== id);
    emit();
}

function push(variant: ToastVariant, message: string, title?: string, durationMs = DEFAULT_DURATION_MS): string | null {
    const trimmed = message.trim();
    if (!trimmed) {
        return null;
    }

    const key = `${variant}:${title ?? ''}:${trimmed}`;
    const now = Date.now();
    const last = recentKeys.get(key);
    if (last && now - last < DEDUPE_MS) {
        return null;
    }
    recentKeys.set(key, now);

    const id = `${now}-${Math.random().toString(36).slice(2, 9)}`;
    const item: ToastItem = { id, title, message: trimmed, variant, createdAt: now };
    toasts = [...toasts, item].slice(-5);
    emit();

    if (durationMs > 0) {
        timers.set(
            id,
            window.setTimeout(() => {
                remove(id);
            }, durationMs),
        );
    }

    return id;
}

export function subscribeToasts(listener: Listener): () => void {
    listeners.add(listener);
    listener(toasts);
    return () => listeners.delete(listener);
}

export function dismissToast(id: string): void {
    remove(id);
}

export function clearToasts(): void {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    toasts = [];
    emit();
}

export function errorMessage(err: unknown, fallback?: string): string {
    if (typeof err === 'string' && err.trim()) {
        return err;
    }
    if (err && typeof err === 'object') {
        const maybeAxios = err as {
            code?: string;
            message?: string;
            name?: string;
            response?: { data?: { message?: string; errors?: Record<string, string[]> } };
            isAxiosError?: boolean;
        };

        if (maybeAxios.code === 'ERR_CANCELED' || maybeAxios.name === 'CanceledError') {
            return '';
        }

        const data = maybeAxios.response?.data;
        const firstValidation = data?.errors ? Object.values(data.errors)[0]?.[0] : undefined;
        if (firstValidation) {
            return firstValidation;
        }
        if (data?.message) {
            return data.message;
        }
        if (err instanceof Error && err.message) {
            return err.message;
        }
        if (typeof maybeAxios.message === 'string' && maybeAxios.message) {
            return maybeAxios.message;
        }
    }
    if (err instanceof Error && err.message) {
        return err.message;
    }
    return fallback ?? t('errors.generic');
}

export const toast = {
    error(message: string, title?: string) {
        return push('error', message, title ?? t('common.error'));
    },
    success(message: string, title?: string) {
        return push('success', message, title);
    },
    info(message: string, title?: string) {
        return push('default', message, title);
    },
    fromError(err: unknown, fallback?: string, title?: string) {
        const message = errorMessage(err, fallback);
        if (!message) {
            return null;
        }
        return push('error', message, title ?? t('common.error'));
    },
    dismiss: dismissToast,
    clear: clearToasts,
};
