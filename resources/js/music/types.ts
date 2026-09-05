export type MusicProviderId = 'spotify' | 'tidal';

export type PlayableProviderLink = {
    provider: MusicProviderId;
    trackId: string;
    uri: string;
    albumArtUrl?: string | null;
};

export type PlayableTrack = {
    provider: MusicProviderId;
    trackId: string;
    uri: string;
    title: string;
    artist: string;
    artists?: { id: string; name: string; slug: string }[];
    albumArtUrl: string | null;
    songId?: string;
    lyrics?: string | null;
    /** Catalog duration fallback when the provider reports 0/unknown. */
    durationMs?: number | null;
    /** All stored provider links for this song (for fallback + mini-player switch). */
    providerLinks?: PlayableProviderLink[];
    preferredProvider?: MusicProviderId | null;
    lastWorkingProvider?: MusicProviderId | null;
};

export type ProviderPlaybackState = {
    paused: boolean;
    position: number;
    duration: number;
    /** True when the provider reports the current track finished. */
    ended?: boolean;
    track: {
        uri: string;
        name: string;
        artists: string[];
        albumArtUrl: string | null;
        /** Original URI when Spotify relinked the track to a market-specific ID. */
        linkedFromUri?: string | null;
    } | null;
};

export type ProviderSearchTrack = {
    provider: MusicProviderId;
    id: string;
    uri: string;
    name: string;
    artist: string;
    album_art_url: string | null;
    duration_ms?: number | null;
};
