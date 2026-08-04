import * as React from 'react';
import { cn } from '@/lib/utils';

type SwitchProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
};

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
    ({ checked, onCheckedChange, className, disabled, id, ...props }, ref) => {
        return (
            <label
                className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center',
                    disabled && 'cursor-not-allowed opacity-50',
                    className,
                )}
            >
                <input
                    ref={ref}
                    id={id}
                    type="checkbox"
                    role="switch"
                    className="peer sr-only"
                    checked={checked}
                    disabled={disabled}
                    onChange={(e) => onCheckedChange(e.target.checked)}
                    {...props}
                />
                <span
                    aria-hidden
                    className={cn(
                        'absolute inset-0 rounded-full border transition-colors',
                        'peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40',
                        'peer-checked:border-accent peer-checked:bg-accent',
                        'border-line bg-paper-2',
                    )}
                />
                <span
                    aria-hidden
                    className={cn(
                        'pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform',
                        'peer-checked:translate-x-5',
                    )}
                />
            </label>
        );
    },
);
Switch.displayName = 'Switch';
