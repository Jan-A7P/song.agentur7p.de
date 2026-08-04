import { cn } from '@/lib/utils';

export function Alert({
    className,
    variant = 'default',
    ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'success' | 'error' }) {
    return (
        <div
            role="alert"
            className={cn(
                'rounded-lg border px-4 py-3 text-sm',
                variant === 'default' && 'border-line bg-paper-2 text-ink',
                variant === 'success' && 'border-success/30 bg-success/10 text-success',
                variant === 'error' && 'border-danger/30 bg-danger-soft text-danger',
                className,
            )}
            {...props}
        />
    );
}
