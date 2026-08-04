import type { MusicProvider } from './MusicProvider';
import { SpotifyProvider } from './providers/SpotifyProvider';
import type { MusicProviderId } from './types';

const instances = new Map<MusicProviderId, MusicProvider>();

export function getProvider(id: MusicProviderId): MusicProvider {
    let provider = instances.get(id);
    if (provider) {
        return provider;
    }

    switch (id) {
        case 'spotify':
            provider = new SpotifyProvider();
            break;
        default:
            throw new Error(`Unbekannter Musik-Anbieter: ${id as string}`);
    }

    instances.set(id, provider);
    return provider;
}

export function getActiveProvider(activeId: MusicProviderId | null | undefined): MusicProvider | null {
    if (!activeId) {
        return null;
    }
    return getProvider(activeId);
}
