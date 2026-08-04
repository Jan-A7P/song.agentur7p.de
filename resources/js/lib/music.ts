import type { User } from '@/types';
import type { MusicProviderId } from '@/music/types';

export function hasMusicConnected(user: User | null | undefined): boolean {
    if (!user) {
        return false;
    }
    if (user.music_connections?.some((c) => c.connected)) {
        return true;
    }
    return Boolean(user.spotify_connected);
}

export function activeProviderId(user: User | null | undefined): MusicProviderId | null {
    if (!user) {
        return null;
    }
    if (user.active_provider) {
        return user.active_provider;
    }
    const connected = user.music_connections?.find((c) => c.connected);
    if (connected) {
        return connected.provider;
    }
    if (user.spotify_connected) {
        return 'spotify';
    }
    return null;
}

export function isProviderConnected(
    user: User | null | undefined,
    provider: MusicProviderId,
): boolean {
    if (!user) {
        return false;
    }
    const row = user.music_connections?.find((c) => c.provider === provider);
    if (row) {
        return row.connected;
    }
    return provider === 'spotify' ? Boolean(user.spotify_connected) : false;
}

export function providerConnectUrl(
    provider: MusicProviderId,
    redirect = '/settings',
    options?: { force?: boolean },
): string {
    if (provider === 'spotify') {
        const params = new URLSearchParams({ redirect });
        if (options?.force) {
            params.set('force', '1');
        }
        return `/music/spotify/redirect?${params.toString()}`;
    }
    return '/settings';
}
