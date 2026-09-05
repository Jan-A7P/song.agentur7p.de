import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { dismissToast, subscribeToasts, type ToastItem } from '@/lib/toast';

export function Toaster() {
    const [items, setItems] = useState<ToastItem[]>([]);

    useEffect(() => subscribeToasts(setItems), []);

    if (items.length === 0) {
        return null;
    }

    return (
        <div
            className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-end gap-2 p-4 sm:p-6"
            aria-live="polite"
            aria-relevant="additions"
        >
            {items.map((item) => (
                <div
                    key={item.id}
                    role={item.variant === 'error' ? 'alert' : 'status'}
                    className={cn(
                        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm',
                        item.variant === 'error' && 'border-danger/30 bg-danger-soft text-danger',
                        item.variant === 'success' && 'border-success/30 bg-success/10 text-success',
                        item.variant === 'default' && 'border-line bg-surface text-ink',
                    )}
                >
                    <div className="min-w-0 flex-1">
                        {item.title && <p className="text-sm font-medium">{item.title}</p>}
                        <p className={cn('text-sm', item.title && 'mt-0.5 opacity-90')}>{item.message}</p>
                    </div>
                    <button
                        type="button"
                        className="rounded-md p-1 opacity-70 transition hover:opacity-100"
                        aria-label={t('common.close')}
                        onClick={() => dismissToast(item.id)}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            ))}
        </div>
    );
}
