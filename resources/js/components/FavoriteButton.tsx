import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { emitFavoriteChange, subscribeFavoriteChange } from '@/lib/favorite-sync';
import { clearSongListCache } from '@/lib/song-list-cache';
import { AppTooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/context/locale-context';
import type { Song } from '@/types';

type FavoriteButtonProps = {
    songId: string;
    favorited?: boolean;
    onChange?: (favorited: boolean, song?: Song) => void;
    size?: 'sm' | 'default' | 'icon';
    className?: string;
    /** Compact icon-only control (default). */
    variant?: 'icon' | 'button';
};

export function FavoriteButton({
    songId,
    favorited = false,
    onChange,
    size = 'icon',
    className,
    variant = 'icon',
}: FavoriteButtonProps) {
    const { user } = useAuth();
    const { t } = useI18n();
    const [active, setActive] = useState(favorited);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        setActive(favorited);
    }, [favorited, songId]);

    useEffect(() => {
        return subscribeFavoriteChange((id, next) => {
            if (id === songId) {
                setActive(next);
            }
        });
    }, [songId]);

    if (!user) {
        return null;
    }

    const toggle = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (pending) {
            return;
        }

        const next = !active;
        setActive(next);
        setPending(true);
        onChange?.(next);
        emitFavoriteChange(songId, next);

        try {
            const { data } = next
                ? await api.post<{ data: Song }>(`/songs/${songId}/favorite`)
                : await api.delete<{ data: Song }>(`/songs/${songId}/favorite`);
            const confirmed = Boolean(data.data.is_favorited);
            setActive(confirmed);
            onChange?.(confirmed, data.data);
            emitFavoriteChange(songId, confirmed);
            // Drop caches so the next visit refetches; open index views update via favorite-sync.
            clearSongListCache();
        } catch {
            setActive(!next);
            onChange?.(!next);
            emitFavoriteChange(songId, !next);
        } finally {
            setPending(false);
        }
    };

    if (variant === 'button') {
        return (
            <Button
                type="button"
                variant={active ? 'accent' : 'outline'}
                size={size === 'icon' ? 'default' : size}
                disabled={pending}
                onClick={(e) => void toggle(e)}
                className={cn('gap-1.5', className)}
                aria-pressed={active}
                aria-label={active ? t('favorite.remove') : t('favorite.save')}
            >
                <Heart className={cn('h-4 w-4', active && 'fill-current')} />
                {active ? t('favorite.label') : t('favorite.remember')}
            </Button>
        );
    }

    return (
        <AppTooltip label={active ? t('favorite.remove') : t('favorite.save')}>
            <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={pending}
                onClick={(e) => void toggle(e)}
                className={cn(
                    'h-8 w-8 shrink-0',
                    active ? 'text-accent hover:text-accent' : 'text-muted hover:text-ink',
                    className,
                )}
                aria-pressed={active}
                aria-label={active ? t('favorite.remove') : t('favorite.save')}
            >
                <Heart className={cn('h-4 w-4', active && 'fill-current')} />
            </Button>
        </AppTooltip>
    );
}
