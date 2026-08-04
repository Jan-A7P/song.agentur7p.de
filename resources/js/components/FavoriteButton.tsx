import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Song } from '@/types';

type FavoriteButtonProps = {
    songId: number;
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
    const [active, setActive] = useState(favorited);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        setActive(favorited);
    }, [favorited, songId]);

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

        try {
            const { data } = next
                ? await api.post<{ data: Song }>(`/songs/${songId}/favorite`)
                : await api.delete<{ data: Song }>(`/songs/${songId}/favorite`);
            setActive(Boolean(data.data.is_favorited));
            onChange?.(Boolean(data.data.is_favorited), data.data);
        } catch {
            setActive(!next);
            onChange?.(!next);
        } finally {
            setPending(false);
        }
    };

    if (variant === 'button') {
        return (
            <Button
                type="button"
                variant={active ? 'accent' : 'outline'}
                size={size === 'icon' ? 'sm' : size}
                disabled={pending}
                onClick={(e) => void toggle(e)}
                className={cn('gap-1.5', className)}
                aria-pressed={active}
                aria-label={active ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}
            >
                <Heart className={cn('h-4 w-4', active && 'fill-current')} />
                {active ? 'Favorit' : 'Merken'}
            </Button>
        );
    }

    return (
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
            aria-label={active ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}
            title={active ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}
        >
            <Heart className={cn('h-4 w-4', active && 'fill-current')} />
        </Button>
    );
}
