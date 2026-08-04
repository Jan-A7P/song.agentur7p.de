export type User = {
    id: number;
    name: string;
    email: string;
    spotify_connected: boolean;
};

export type Song = {
    id: number;
    title: string;
    artist: string;
    lyrics: string;
    spotify_track_id: string | null;
    spotify_uri: string | null;
    album_art_url: string | null;
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

export type SpotifyTrack = {
    id: string;
    uri: string;
    name: string;
    artist: string;
    album_art_url: string | null;
    duration_ms?: number | null;
};

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
    spotify_uri: string | null;
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
    spotify_uri: string;
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
