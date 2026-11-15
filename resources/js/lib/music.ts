import type { User } from '@/types';
import type { MusicProviderId } from '@/music/types';

/** Providers that can actually play audio in this app. */
export function providerSupportsPlayback(provider: MusicProviderId): boolean {
    return provider === 'spotify' || provider === 'tidal';
}

export function hasMusicConnected(user: User | null | undefined): boolean {
    if (!user) {
        return false;
    }
    if (user.music_connections?.some((c) => c.connected && c.enabled !== false)) {
        return true;
    }
    return Boolean(user.spotify_connected);
}

export function playbackProviderIds(user: User | null | undefined): MusicProviderId[] {
    return connectedProviderIds(user).filter(providerSupportsPlayback);
}

export function hasPlaybackConnected(user: User | null | undefined): boolean {
    return playbackProviderIds(user).length > 0;
}

export function isPlaybackProviderConnected(
    user: User | null | undefined,
    provider: MusicProviderId,
): boolean {
    return providerSupportsPlayback(provider) && isProviderConnected(user, provider);
}

export function activeProviderId(user: User | null | undefined): MusicProviderId | null {
    if (!user) {
        return null;
    }
    if (user.active_provider) {
        return user.active_provider;
    }
    const connected = user.music_connections?.find((c) => c.connected && c.enabled !== false);
    if (connected) {
        return connected.provider;
    }
    if (user.spotify_connected) {
        return 'spotify';
    }
    return null;
}

export function connectedProviderIds(user: User | null | undefined): MusicProviderId[] {
    if (!user) {
        return [];
    }
    const fromConnections = (user.music_connections ?? [])
        .filter((c) => c.connected && c.enabled !== false)
        .map((c) => c.provider);
    if (fromConnections.length > 0) {
        return fromConnections;
    }
    return user.spotify_connected ? ['spotify'] : [];
}

export function isProviderLinked(
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

export function isProviderConnected(
    user: User | null | undefined,
    provider: MusicProviderId,
): boolean {
    if (!user) {
        return false;
    }
    const row = user.music_connections?.find((c) => c.provider === provider);
    if (row) {
        return row.connected && row.enabled !== false;
    }
    return provider === 'spotify' ? Boolean(user.spotify_connected) : false;
}

export function providerFromUri(uri: string | null | undefined): MusicProviderId | null {
    if (!uri) {
        return null;
    }
    if (uri.startsWith('tidal:')) {
        return 'tidal';
    }
    if (uri.startsWith('spotify:')) {
        return 'spotify';
    }
    return null;
}

export function providerLabel(provider: MusicProviderId): string {
    return provider === 'tidal' ? 'TIDAL' : provider === 'spotify' ? 'Spotify' : provider;
}

export function providerConnectUrl(
    provider: MusicProviderId,
    redirect = '/settings',
    options?: { force?: boolean },
): string {
    const params = new URLSearchParams({ redirect });
    if (options?.force) {
        params.set('force', '1');
    }

    if (provider === 'spotify') {
        return `/music/spotify/redirect?${params.toString()}`;
    }
    if (provider === 'tidal') {
        return `/music/tidal/redirect?${params.toString()}`;
    }

    return '/settings';
}

export function providerTrackUri(provider: MusicProviderId, trackId: string): string {
    if (provider === 'tidal') {
        return `tidal:track:${trackId}`;
    }
    return `spotify:track:${trackId}`;
}

function normalizeMatchText(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Higher is better; -1 means unsuitable. */
export function scoreProviderTrackMatch(
    candidate: { name: string; artist: string },
    title: string,
    artist: string,
): number {
    const cTitle = normalizeMatchText(candidate.name);
    const cArtist = normalizeMatchText(candidate.artist);
    const tTitle = normalizeMatchText(title);
    const tArtist = normalizeMatchText(artist);

    if (!cTitle || !tTitle) {
        return -1;
    }

    let score = 0;
    if (cTitle === tTitle) {
        score += 100;
    } else if (cTitle.includes(tTitle) || tTitle.includes(cTitle)) {
        score += 60;
    } else {
        return -1;
    }

    if (tArtist && cArtist) {
        if (cArtist === tArtist) {
            score += 50;
        } else if (cArtist.includes(tArtist) || tArtist.includes(cArtist)) {
            score += 25;
        } else {
            score -= 20;
        }
    }

    return score;
}
