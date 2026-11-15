import type { PlayerTrack } from '@/context/player-context';
import { durationFromLyrics } from '@/lib/lrc';
import {
    activeProviderId,
    isProviderConnected,
    providerLabel,
    providerSupportsPlayback,
} from '@/lib/music';
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
    return songProviderLinks(song).some((link) => providerSupportsPlayback(link.provider));
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
        artists: song.artists?.map((a) => ({ id: a.id, name: a.name, slug: a.slug })),
        albumArtUrl: link.album_art_url ?? song.album_art_url,
        songId: song.id,
        lyrics: song.lyrics,
        durationMs:
            song.duration_ms && song.duration_ms > 0
                ? song.duration_ms
                : durationFromLyrics(song.lyrics),
        providerLinks: toPlayableLinks(allLinks),
        preferredProvider: song.preferred_provider ?? song.provider ?? null,
        lastWorkingProvider: song.last_working_provider ?? null,
    };
}

const LAST_PROVIDER_STORAGE_KEY = 'songtexte.last-song-provider';

export function rememberSongPlaybackProvider(songId: string, provider: MusicProviderId): void {
    try {
        const raw = window.localStorage.getItem(LAST_PROVIDER_STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Record<string, MusicProviderId>) : {};
        parsed[songId] = provider;
        window.localStorage.setItem(LAST_PROVIDER_STORAGE_KEY, JSON.stringify(parsed));
    } catch {
        // private mode / quota
    }
}

export function lastSongPlaybackProvider(songId: string): MusicProviderId | null {
    try {
        const raw = window.localStorage.getItem(LAST_PROVIDER_STORAGE_KEY);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as Record<string, MusicProviderId>;
        return parsed[songId] ?? null;
    } catch {
        return null;
    }
}

export function songMatchesTrack(song: Song, track: { songId?: string | null; uri?: string | null } | null | undefined): boolean {
    if (!track) {
        return false;
    }
    if (track.songId && track.songId === song.id) {
        return true;
    }
    return Boolean(track.uri && songProviderLinks(song).some((link) => link.provider_uri === track.uri));
}

export function connectedSongProviders(song: Song, user: User | null | undefined): MusicProviderId[] {
    return songProviderLinks(song)
        .map((link) => link.provider)
        .filter((provider) => isProviderConnected(user, provider) && providerSupportsPlayback(provider));
}

/**
 * Pick the best stored provider link for playback.
 * Strict order: last explicit choice → preferred → last working → user active → any linked+connected.
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
    const connected = (id: MusicProviderId) =>
        isProviderConnected(user, id) && providerSupportsPlayback(id);

    const remembered = lastSongPlaybackProvider(song.id);
    const preferred = song.preferred_provider ?? null;
    const lastWorking = song.last_working_provider ?? null;
    const active = activeProviderId(user);

    const tryIds: MusicProviderId[] = [];
    if (remembered) {
        tryIds.push(remembered);
    }
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

    // Nothing connected: still return a playback-capable link so the player can prompt to connect.
    const fallback =
        (preferred && providerSupportsPlayback(preferred) && byProvider.get(preferred)) ||
        (lastWorking && providerSupportsPlayback(lastWorking) && byProvider.get(lastWorking)) ||
        links.find((link) => providerSupportsPlayback(link.provider));

    return fallback ? linkToPlayerTrack(song, fallback, links) : null;
}

export function songToPlayerTrack(song: Song, user?: User | null): PlayerTrack | null {
    return resolveSongPlayback(song, user ?? null);
}

export function songToPlayerTrackForProvider(
    song: Song,
    provider: MusicProviderId,
    user?: User | null,
): PlayerTrack | null {
    const links = songProviderLinks(song);
    const link = links.find((item) => item.provider === provider);
    if (!link) {
        return null;
    }
    if (!providerSupportsPlayback(provider)) {
        return null;
    }
    if (user && !isProviderConnected(user, provider)) {
        return null;
    }

    return linkToPlayerTrack(song, link, links);
}

export function playerTrackForProvider(
    track: PlayerTrack,
    provider: MusicProviderId,
): PlayerTrack | null {
    if (!providerSupportsPlayback(provider)) {
        return null;
    }
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
