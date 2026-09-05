import type { MusicProviderId } from '@/music/types';

export type MusicConnectionStatus = {
    provider: MusicProviderId;
    connected: boolean;
    /** Soft toggle; omitted/true means usable when connected */
    enabled?: boolean;
};

export type User = {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
    has_custom_avatar: boolean;
    music_connections: MusicConnectionStatus[];
    active_provider: MusicProviderId | null;
    /** @deprecated use music_connections / active_provider */
    spotify_connected: boolean;
};

export type SongProviderLink = {
    provider: MusicProviderId;
    provider_track_id: string;
    provider_uri: string;
    album_art_url?: string | null;
};

export type Artist = {
    id: string;
    name: string;
    slug: string;
    songs_count?: number;
};

export type Song = {
    id: string;
    title: string;
    artist: string;
    artists?: Artist[];
    lyrics: string;
    provider: MusicProviderId | null;
    preferred_provider?: MusicProviderId | null;
    last_working_provider?: MusicProviderId | null;
    provider_track_id: string | null;
    provider_uri: string | null;
    album_art_url: string | null;
    providers?: SongProviderLink[];
    duration_ms?: number | null;
    play_count?: number;
    total_listen_ms?: number;
    last_played_at?: string | null;
    is_favorited?: boolean;
    user_id: string | null;
    created_at: string;
    updated_at: string;
    user?: {
        id: string;
        name: string;
    } | null;
    pivot?: {
        id?: string;
        position: number;
        playlist_id?: string;
        song_id?: string;
    };
};

export type SongPlay = {
    id: string;
    song_id: string;
    listened_ms: number;
    completed: boolean;
};

export type SongPlayHistoryItem = {
    id: string;
    provider: MusicProviderId | null;
    listened_ms: number;
    completed: boolean;
    created_at: string | null;
};

export type SongDailyStat = {
    date: string;
    plays: number;
    listen_ms: number;
    avg_listen_ms: number;
};

export type SongStats = {
    play_count: number;
    total_listen_ms: number;
    completed_count: number;
    duration_ms: number | null;
    last_played_at: string | null;
    my: {
        play_count: number;
        total_listen_ms: number;
    } | null;
    recent_plays: SongPlayHistoryItem[];
    daily: SongDailyStat[];
};

export type Playlist = {
    id: string;
    name: string;
    description: string | null;
    user_id: string;
    created_at: string;
    updated_at: string;
    songs_count?: number;
    user?: {
        id: string;
        name: string;
    };
    songs?: Song[];
};

export type ProviderTrack = {
    provider: MusicProviderId;
    id: string;
    uri: string;
    name: string;
    artist: string;
    album_art_url: string | null;
    duration_ms?: number | null;
};

/** @deprecated use ProviderTrack */
export type SpotifyTrack = ProviderTrack;

export type Paginated<T> = {
    data: T[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    next_page_url: string | null;
    prev_page_url: string | null;
};

export type DiscoverySpotifyTrack = {
    id: string;
    uri: string;
    name: string;
    artist: string;
    album_art_url: string | null;
    duration_ms: number | null;
};

export type DiscoveryCard = {
    id: string;
    source: 'catalog' | 'spotify';
    song: Song | null;
    spotify: DiscoverySpotifyTrack | null;
};

export type RoomMemberRole = 'host' | 'moderator' | 'member';

export type RoomPlaybackState = {
    provider: MusicProviderId | null;
    track_uri: string | null;
    track_title: string | null;
    track_artist: string | null;
    album_art_url: string | null;
    current_song_id: string | null;
    position_ms: number;
    is_playing: boolean;
    playback_updated_at: string | null;
};

export type RoomQueueItem = {
    id: string;
    song_id: string | null;
    provider: MusicProviderId | null;
    track_uri: string;
    title: string;
    artist: string;
    album_art_url: string | null;
    position: number;
    status: string;
    votes_count: number;
    voted_user_ids: string[];
    added_by: { id: string; name: string } | null;
};

export type RoomMember = {
    id: string;
    role: RoomMemberRole;
    user: { id: string; name: string } | null;
};

export type RoomMessage = {
    id: string;
    body: string;
    created_at: string;
    user: { id: string; name: string };
};

export type RoomReaction = {
    id: string;
    emoji: string;
    count: number;
    created_at: string;
    user: { id: string; name: string };
    recent_users: string[];
};

export type ListeningRoom = {
    id: string;
    code: string;
    name: string;
    status: string;
    host: { id: string; name: string } | null;
    my_role: RoomMemberRole | null;
    can_control: boolean;
    state: RoomPlaybackState;
    members: RoomMember[];
    queue: RoomQueueItem[];
    join_url: string;
    members_count?: number;
};
