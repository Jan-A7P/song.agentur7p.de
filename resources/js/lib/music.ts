import type { User } from '@/types';

export function hasMusicConnected(user: User | null | undefined): boolean {
    return Boolean(user?.spotify_connected);
}
