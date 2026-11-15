import type { MusicProvider } from './MusicProvider';
import { SpotifyProvider } from './providers/SpotifyProvider';
import { TidalProvider } from './providers/TidalProvider';
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
        case 'tidal':
            provider = new TidalProvider();
            break;
        default:
            throw new Error(`Kein Wiedergabe-Player für ${id as string}.`);
    }

    instances.set(id, provider);
    return provider;
}

/** Disconnect and drop the singleton so inactive providers stop all playback. */
export function releaseProvider(id: MusicProviderId): void {
    const provider = instances.get(id);
    if (!provider) {
        return;
    }
    provider.disconnect();
    instances.delete(id);
}

export function getActiveProvider(activeId: MusicProviderId | null | undefined): MusicProvider | null {
    if (!activeId) {
        return null;
    }
    return getProvider(activeId);
}
