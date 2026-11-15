import { HexColorInput, HexColorPicker } from 'react-colorful';
import { cn } from '@/lib/utils';

type ColorPickerProps = {
    color: string;
    onChange: (hex: string) => void;
    className?: string;
    inputId?: string;
    inputLabel?: string;
};

export function ColorPicker({ color, onChange, className, inputId, inputLabel }: ColorPickerProps) {
    return (
        <div className={cn('color-picker space-y-3', className)}>
            <HexColorPicker color={color} onChange={onChange} />
            <HexColorInput
                id={inputId}
                aria-label={inputLabel}
                color={color}
                onChange={onChange}
                prefixed
                className="flex h-9 w-full rounded-lg border border-line bg-surface px-2.5 font-mono text-sm uppercase tracking-wide text-ink shadow-sm placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            />
        </div>
    );
}
