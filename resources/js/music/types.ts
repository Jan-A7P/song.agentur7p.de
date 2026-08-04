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
    albumArtUrl: string | null;
    songId?: number;
    lyrics?: string | null;
    /** All stored provider links for this song (for fallback + mini-player switch). */
    providerLinks?: PlayableProviderLink[];
    preferredProvider?: MusicProviderId | null;
    lastWorkingProvider?: MusicProviderId | null;
};

export type ProviderPlaybackState = {
    paused: boolean;
    position: number;
    duration: number;
    track: {
        uri: string;
        name: string;
        artists: string[];
        albumArtUrl: string | null;
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
