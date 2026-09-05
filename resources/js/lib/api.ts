import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { getLocale } from '@/i18n';
import { toast } from '@/lib/toast';

declare module 'axios' {
    export interface AxiosRequestConfig {
        /** When true, the global API error toast is skipped. */
        skipErrorToast?: boolean;
    }
}

export type ApiRequestConfig = InternalAxiosRequestConfig & {
    skipErrorToast?: boolean;
};

const api = axios.create({
    baseURL: '/api',
    withCredentials: true,
    headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    },
});

function readCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

function shouldSkipErrorToast(error: AxiosError): boolean {
    const config = error.config as ApiRequestConfig | undefined;
    if (config?.skipErrorToast) {
        return true;
    }
    if (axios.isCancel(error) || error.code === 'ERR_CANCELED') {
        return true;
    }

    const url = config?.url ?? '';
    const status = error.response?.status;

    // Silent auth probe on boot / session expiry.
    if (status === 401 && (url === '/user' || url.endsWith('/user'))) {
        return true;
    }

    return false;
}

api.interceptors.request.use((config) => {
    const token = readCookie('XSRF-TOKEN');
    if (token) {
        config.headers['X-XSRF-TOKEN'] = token;
    }
    config.headers['Accept-Language'] = getLocale();
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error: AxiosError) => {
        if (!shouldSkipErrorToast(error)) {
            toast.fromError(error);
        }
        return Promise.reject(error);
    },
);

export async function ensureCsrfCookie(): Promise<void> {
    await axios.get('/sanctum/csrf-cookie', { withCredentials: true });
}

export default api;
