import { UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { User } from '@/types';

type UserAvatarProps = {
    user: Pick<User, 'name' | 'avatar'> | null | undefined;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
};

const sizeClass = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-9 w-9 text-sm',
    lg: 'h-12 w-12 text-base',
    xl: 'h-24 w-24 text-2xl',
} as const;

export function UserAvatar({ user, size = 'md', className }: UserAvatarProps) {
    const initial = user?.name?.trim()?.charAt(0)?.toUpperCase() || '?';

    if (user?.avatar) {
        return (
            <img
                src={user.avatar}
                alt=""
                className={cn('shrink-0 rounded-full object-cover', sizeClass[size], className)}
            />
        );
    }

    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-full bg-ink text-paper',
                sizeClass[size],
                className,
            )}
            aria-hidden
        >
            {size === 'sm' || size === 'md' ? <UserRound className="h-4 w-4" /> : initial}
        </span>
    );
}
