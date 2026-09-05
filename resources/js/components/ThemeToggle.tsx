import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/theme-context';
import { useI18n } from '@/context/locale-context';
import { Button } from '@/components/ui/button';
import { AppTooltip } from '@/components/ui/tooltip';

export function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const { t } = useI18n();
    const isDark = theme === 'dark';
    const label = isDark ? t('theme.light') : t('theme.dark');

    return (
        <AppTooltip label={label}>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={toggleTheme}
                aria-label={label}
            >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
        </AppTooltip>
    );
}
