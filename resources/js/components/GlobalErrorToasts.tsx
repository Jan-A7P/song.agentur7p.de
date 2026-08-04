import { useEffect } from 'react';
import { toast } from '@/lib/toast';

/**
 * Catches unhandled runtime / promise errors and surfaces them as toasts.
 */
export function GlobalErrorToasts() {
    useEffect(() => {
        const onRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            // Axios errors are already toasted by the API interceptor.
            if (reason && typeof reason === 'object' && 'isAxiosError' in reason) {
                return;
            }
            toast.fromError(reason, 'Unbehandelter Fehler.');
        };

        const onError = (event: ErrorEvent) => {
            const message = event.message || event.error?.message;
            if (!message) {
                return;
            }
            // Ignore noisy script load / extension errors without detail.
            if (message === 'Script error.' || message === 'ResizeObserver loop completed with undelivered notifications.') {
                return;
            }
            toast.error(message);
        };

        window.addEventListener('unhandledrejection', onRejection);
        window.addEventListener('error', onError);

        return () => {
            window.removeEventListener('unhandledrejection', onRejection);
            window.removeEventListener('error', onError);
        };
    }, []);

    return null;
}
