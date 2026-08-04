import type { PlayerTrack } from '@/context/player-context';
import { activeProviderId, isProviderConnected, providerLabel } from '@/lib/music';
import type { MusicProviderId, PlayableProviderLink } from '@/music/types';
import type { Song, SongProviderLink, User } from '@/types';

export function songProviderLinks(song: Song): SongProviderLink[] {
    if (song.providers && song.providers.length > 0) {
        return song.providers.map((p) => ({
            provider: p.provider,
            provider_track_id: p.provider_track_id,
            provider_uri: p.provider_uri,
            album_art_url: p.album_art_url ?? null,
        }));
    }

    if (song.provider && song.provider_uri) {
        return [
            {
                provider: song.provider,
                provider_track_id: song.provider_track_id || song.provider_uri.split(':').pop() || '',
                provider_uri: song.provider_uri,
                album_art_url: song.album_art_url,
            },
        ];
    }

    return [];
}

export function songIsPlayable(song: Song): boolean {
    return songProviderLinks(song).length > 0;
}

export function songProviderIds(song: Song): MusicProviderId[] {
    return songProviderLinks(song).map((l) => l.provider);
}

function toPlayableLinks(links: SongProviderLink[]): PlayableProviderLink[] {
    return links.map((link) => ({
        provider: link.provider,
        trackId: link.provider_track_id || link.provider_uri.split(':').pop() || '',
        uri: link.provider_uri,
        albumArtUrl: link.album_art_url ?? null,
    }));
}

function linkToPlayerTrack(
    song: Song,
    link: SongProviderLink,
    allLinks: SongProviderLink[],
): PlayerTrack {
    return {
        provider: link.provider,
        trackId: link.provider_track_id || link.provider_uri.split(':').pop() || '',
        uri: link.provider_uri,
        title: song.title,
        artist: song.artist,
        albumArtUrl: link.album_art_url ?? song.album_art_url,
        songId: song.id,
        lyrics: song.lyrics,
        providerLinks: toPlayableLinks(allLinks),
        preferredProvider: song.preferred_provider ?? song.provider ?? null,
        lastWorkingProvider: song.last_working_provider ?? null,
    };
}

/**
 * Pick the best stored provider link for playback.
 * Strict order: preferred → last working → user active → any linked+connected.
 */
export function resolveSongPlayback(
    song: Song,
    user: User | null | undefined,
): PlayerTrack | null {
    const links = songProviderLinks(song);
    if (links.length === 0) {
        return null;
    }

    const byProvider = new Map(links.map((l) => [l.provider, l]));
    const connected = (id: MusicProviderId) => isProviderConnected(user, id);

    const preferred = song.preferred_provider ?? null;
    const lastWorking = song.last_working_provider ?? null;
    const active = activeProviderId(user);

    const tryIds: MusicProviderId[] = [];
    if (preferred) {
        tryIds.push(preferred);
    }
    if (lastWorking) {
        tryIds.push(lastWorking);
    }
    if (active) {
        tryIds.push(active);
    }
    for (const link of links) {
        tryIds.push(link.provider);
    }

    const seen = new Set<MusicProviderId>();
    for (const id of tryIds) {
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        const link = byProvider.get(id);
        if (link && connected(id)) {
            return linkToPlayerTrack(song, link, links);
        }
    }

    // Nothing connected: still return preferred (or first) so the player can attempt / search.
    const fallback =
        (preferred && byProvider.get(preferred)) ||
        (lastWorking && byProvider.get(lastWorking)) ||
        links[0];

    return fallback ? linkToPlayerTrack(song, fallback, links) : null;
}

export function songToPlayerTrack(song: Song, user?: User | null): PlayerTrack | null {
    return resolveSongPlayback(song, user ?? null);
}

export function playerTrackForProvider(
    track: PlayerTrack,
    provider: MusicProviderId,
): PlayerTrack | null {
    const link = track.providerLinks?.find((l) => l.provider === provider);
    if (!link) {
        return null;
    }

    return {
        ...track,
        provider: link.provider,
        trackId: link.trackId,
        uri: link.uri,
        albumArtUrl: link.albumArtUrl ?? track.albumArtUrl,
    };
}

export function formatProviderBadge(provider: MusicProviderId): string {
    return providerLabel(provider);
}
