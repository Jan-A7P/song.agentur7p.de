import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/context/locale-context';
import { isPartyModeEnabled, setPartyModeEnabled, subscribePartyMode } from '@/lib/party-mode';
import { cn } from '@/lib/utils';

export function PartyToggle() {
    const { t } = useI18n();
    const [enabled, setEnabled] = useState(isPartyModeEnabled);

    useEffect(() => subscribePartyMode(setEnabled), []);

    const label = enabled ? t('party.off') : t('party.on');

    return (
        <AppTooltip label={label}>
            <Button
                type="button"
                variant={enabled ? 'accent' : 'ghost'}
                size="icon"
                className={cn('h-9 w-9', enabled && 'shadow-md')}
                onClick={() => setPartyModeEnabled(!enabled)}
                aria-pressed={enabled}
                aria-label={label}
            >
                <Sparkles className="h-4 w-4" />
            </Button>
        </AppTooltip>
    );
}
