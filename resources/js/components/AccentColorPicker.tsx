import { useEffect, useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useI18n } from '@/context/locale-context';
import { useTheme } from '@/context/theme-context';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ColorPicker } from '@/components/ui/color-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AppTooltip } from '@/components/ui/tooltip';
import {
    ACCENT_PRESETS,
    DEFAULT_ACCENT_DARK,
    DEFAULT_ACCENT_LIGHT,
    getAccentColor,
    normalizeAccent,
    setAccentColor,
    subscribeAccentColor,
} from '@/lib/accent-color';
import { cn } from '@/lib/utils';

function useAccentColor() {
    const [accent, setAccent] = useState(getAccentColor);

    useEffect(() => subscribeAccentColor(setAccent), []);

    return accent;
}

function themeDefault(theme: 'light' | 'dark'): string {
    return theme === 'dark' ? DEFAULT_ACCENT_DARK : DEFAULT_ACCENT_LIGHT;
}

export function AccentColorControls({ className, disabled = false }: { className?: string; disabled?: boolean }) {
    const { t } = useI18n();
    const { theme } = useTheme();
    const accent = useAccentColor();
    const current = accent ?? themeDefault(theme);
    const hexId = useId();

    const apply = (hex: string) => {
        if (disabled) {
            return;
        }
        const next = normalizeAccent(hex);
        if (next) {
            setAccentColor(next);
        }
    };

    return (
        <fieldset
            disabled={disabled}
            className={cn('min-w-0 w-full space-y-3 border-0 p-0', className, disabled && 'opacity-50')}
        >
            <div className="space-y-1.5">
                <Label htmlFor={hexId} className="text-xs text-muted">
                    {t('accent.hex')}
                </Label>
                <ColorPicker
                    color={current}
                    onChange={apply}
                    inputId={hexId}
                    inputLabel={t('accent.hex')}
                />
            </div>

            <div className="space-y-1.5">
                <p className="text-xs text-muted">{t('accent.presets')}</p>
                <div className="flex flex-wrap gap-2">
                    {ACCENT_PRESETS.map((hex) => {
                        const active = current.toLowerCase() === hex;
                        return (
                            <button
                                key={hex}
                                type="button"
                                aria-label={hex}
                                aria-pressed={active}
                                disabled={disabled}
                                onClick={() => apply(hex)}
                                className={cn(
                                    'h-7 w-7 rounded-full border border-black/10 transition',
                                    active ? 'ring-2 ring-ink ring-offset-2 ring-offset-paper' : 'hover:scale-105',
                                )}
                                style={{ backgroundColor: hex }}
                            />
                        );
                    })}
                </div>
            </div>

            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={disabled || accent == null}
                onClick={() => setAccentColor(null)}
            >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('accent.reset')}
            </Button>
        </fieldset>
    );
}

export function AccentColorPicker() {
    const { t } = useI18n();
    const label = t('accent.picker');

    return (
        <Popover>
            <AppTooltip label={label}>
                <span className="inline-flex">
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            aria-label={label}
                        >
                            <span className="h-4 w-4 rounded-full bg-accent shadow-sm ring-1 ring-line" />
                        </Button>
                    </PopoverTrigger>
                </span>
            </AppTooltip>
            <PopoverContent
                className="w-[17.5rem]"
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                <div className="mb-3">
                    <p className="text-sm font-medium">{t('accent.label')}</p>
                    <p className="mt-0.5 text-xs text-muted">{t('accent.description')}</p>
                </div>
                <AccentColorControls />
            </PopoverContent>
        </Popover>
    );
}
