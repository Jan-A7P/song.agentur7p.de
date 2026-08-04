import type { MusicProviderId } from '@/music/types';

export type MusicConnectionStatus = {
    provider: MusicProviderId;
    connected: boolean;
    /** Soft toggle; omitted/true means usable when connected */
    enabled?: boolean;
};

export type User = {
    id: number;
    name: string;
    email: string;
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

export type Song = {
    id: number;
    title: string;
    artist: string;
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
    user_id: number;
    created_at: string;
    updated_at: string;
    user?: {
        id: number;
        name: string;
    };
    pivot?: {
        id?: number;
        position: number;
        playlist_id?: number;
        song_id?: number;
    };
};

export type SongPlay = {
    id: number;
    song_id: number;
    listened_ms: number;
    completed: boolean;
};

export type SongPlayHistoryItem = {
    id: number;
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
        completed_count: number;
        last_played_at: string | null;
    } | null;
    recent_plays: SongPlayHistoryItem[];
    daily: SongDailyStat[];
};

export type Playlist = {
    id: number;
    name: string;
    description: string | null;
    user_id: number;
    created_at: string;
    updated_at: string;
    songs_count?: number;
    user?: {
        id: number;
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

export type RoomMemberRole = 'host' | 'moderator' | 'member';

export type RoomPlaybackState = {
    provider: MusicProviderId | null;
    track_uri: string | null;
    track_title: string | null;
    track_artist: string | null;
    album_art_url: string | null;
    current_song_id: number | null;
    position_ms: number;
    is_playing: boolean;
    playback_updated_at: string | null;
};

export type RoomQueueItem = {
    id: number;
    song_id: number | null;
    provider: MusicProviderId | null;
    track_uri: string;
    title: string;
    artist: string;
    album_art_url: string | null;
    position: number;
    status: string;
    votes_count: number;
    voted_user_ids: number[];
    added_by: { id: number; name: string } | null;
};

export type RoomMember = {
    id: number;
    role: RoomMemberRole;
    user: { id: number; name: string } | null;
};

export type RoomMessage = {
    id: number;
    body: string;
    created_at: string;
    user: { id: number; name: string };
};

export type RoomReaction = {
    id: number;
    emoji: string;
    count: number;
    created_at: string;
    user: { id: number; name: string };
    recent_users: string[];
};

export type ListeningRoom = {
    id: number;
    code: string;
    name: string;
    status: string;
    host: { id: number; name: string } | null;
    my_role: RoomMemberRole | null;
    can_control: boolean;
    state: RoomPlaybackState;
    members: RoomMember[];
    queue: RoomQueueItem[];
    join_url: string;
    members_count?: number;
};
