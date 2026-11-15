import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/context/locale-context';
import { isCarmineModeEnabled, setCarmineModeEnabled, subscribeCarmineMode } from '@/lib/carmine-mode';
import { cn } from '@/lib/utils';

export function CarmineToggle() {
    const { t } = useI18n();
    const [enabled, setEnabled] = useState(isCarmineModeEnabled);

    useEffect(() => subscribeCarmineMode(setEnabled), []);

    const label = enabled ? t('carmine.off') : t('carmine.on');

    return (
        <AppTooltip label={label}>
            <Button
                type="button"
                variant={enabled ? 'accent' : 'ghost'}
                size="icon"
                className={cn('h-9 w-9', enabled && 'shadow-md')}
                onClick={() => setCarmineModeEnabled(!enabled)}
                aria-pressed={enabled}
                aria-label={label}
            >
                <Flame className={cn('h-4 w-4', enabled && 'carmine-toggle-flame')} />
            </Button>
        </AppTooltip>
    );
}
