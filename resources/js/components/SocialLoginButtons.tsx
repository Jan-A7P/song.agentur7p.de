import { useI18n } from '@/context/locale-context';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

type SocialLoginButtonsProps = {
    className?: string;
    redirectTo?: string;
};

function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden>
            <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
        </svg>
    );
}

function SpotifyIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.6 14.4c-.2.3-.5.4-.8.2-2.2-1.3-5-1.6-8.3-.9-.3.1-.6-.1-.7-.4-.1-.3.1-.6.4-.7 3.6-.8 6.7-.4 9.2 1 .3.2.4.5.2.8zm1.2-2.7c-.2.4-.7.5-1 .3-2.5-1.6-6.4-2-9.4-1.1-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-.9 3.4-1 7.7-.6 10.6 1.2.4.2.5.6.2 1zm.1-2.8C14.9 9 9.4 8.8 6.5 9.7c-.5.1-1-.2-1.1-.6-.2-.5.1-1 .6-1.1 3.4-1 9.3-.8 13 1.4.4.3.6.8.3 1.2-.2.4-.7.5-1.1.3z" />
        </svg>
    );
}

export function SocialLoginButtons({ className, redirectTo = '/' }: SocialLoginButtonsProps) {
    const { t } = useI18n();
    const redirectParam = encodeURIComponent(redirectTo);

    return (
        <div className={cn('space-y-4', className)}>
            <div className="grid gap-3">
                <a
                    href={`/auth/google/redirect?redirect=${redirectParam}`}
                    className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink transition hover:bg-paper-2"
                >
                    <GoogleIcon className="h-5 w-5 shrink-0" />
                    {t('auth.continueGoogle')}
                </a>
                <a
                    href={`/auth/spotify/redirect?redirect=${redirectParam}`}
                    className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-transparent bg-[#1DB954] px-4 text-sm font-medium text-white transition hover:bg-[#1aa34a]"
                >
                    <SpotifyIcon className="h-5 w-5 shrink-0" />
                    {t('auth.continueSpotify')}
                </a>
            </div>

            <div className="relative flex items-center gap-3">
                <div className="h-px flex-1 bg-line" />
                <span className="text-xs uppercase tracking-wide text-muted">{t('common.or')}</span>
                <div className="h-px flex-1 bg-line" />
            </div>
        </div>
    );
}

export function authErrorMessage(code: string | null): string | null {
    switch (code) {
        case 'denied':
            return t('auth.denied');
        case 'invalid_state':
            return t('auth.invalidState');
        case 'missing_code':
            return t('auth.missingCode');
        case 'failed':
            return t('auth.failed');
        default:
            return null;
    }
}
