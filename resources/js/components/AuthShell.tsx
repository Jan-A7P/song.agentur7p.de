import { ReactNode } from 'react';
import { useI18n } from '@/context/locale-context';
import { cn } from '@/lib/utils';

type AuthShellProps = {
    title: string;
    subtitle: ReactNode;
    children: ReactNode;
    className?: string;
};

export function AuthShell({ title, subtitle, children, className }: AuthShellProps) {
    const { t } = useI18n();

    return (
        <div className={cn('auth-shell relative w-full', className)}>
            <div className="grid min-h-[calc(100vh-4rem)] w-full lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                <aside className="auth-panel relative hidden overflow-hidden border-r border-line/60 lg:flex lg:flex-col lg:justify-end lg:gap-16 lg:px-12 lg:py-14 xl:px-16">
                    <div
                        className="pointer-events-none absolute inset-0"
                        aria-hidden
                        style={{
                            backgroundImage: `
                                radial-gradient(ellipse 90% 70% at 20% 15%, var(--glow-a), transparent 55%),
                                radial-gradient(ellipse 70% 55% at 85% 80%, var(--glow-b), transparent 50%),
                                linear-gradient(160deg, color-mix(in oklab, var(--paper-2) 70%, transparent), transparent 45%)
                            `,
                        }}
                    />
                    <div
                        className="pointer-events-none absolute -right-16 top-1/4 h-72 w-72 rounded-full border border-line/40"
                        aria-hidden
                    />
                    <div
                        className="pointer-events-none absolute -right-4 top-[28%] h-48 w-48 rounded-full border border-accent/20"
                        aria-hidden
                    />
                    <div
                        className="pointer-events-none absolute bottom-20 left-10 h-24 w-24 rotate-12 rounded-2xl border border-line/50 bg-surface/40"
                        aria-hidden
                    />

                    <div className="auth-enter relative z-10 max-w-md space-y-5">
                        <h2 className="font-display text-5xl font-semibold leading-[1.05] tracking-tight xl:text-6xl">
                            {t('auth.heroTitle')}
                            <span className="mt-2 block text-accent">{t('auth.heroAccent')}</span>
                        </h2>
                        <p className="max-w-sm text-base leading-relaxed text-muted">
                            {t('auth.heroBody')}
                        </p>
                    </div>

                    <p className="auth-enter auth-enter-delay relative z-10 text-sm text-muted">
                        {t('auth.heroFooter')}
                    </p>
                </aside>

                <section className="relative flex flex-col justify-center px-4 py-10 sm:px-8 lg:px-12 xl:px-16">
                    <div className="auth-enter mx-auto w-full max-w-md space-y-8">
                        <header className="space-y-2">
                            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
                            <p className="text-sm leading-relaxed text-muted sm:text-base">{subtitle}</p>
                        </header>
                        {children}
                    </div>
                </section>
            </div>
        </div>
    );
}
