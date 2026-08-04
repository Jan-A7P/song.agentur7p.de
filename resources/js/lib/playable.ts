import type { PlayerTrack } from '@/context/player-context';
import type { MusicProviderId } from '@/music/types';
import type { Song } from '@/types';

export function songIsPlayable(song: Song): boolean {
    return Boolean(song.provider && song.provider_uri);
}

export function songToPlayerTrack(song: Song): PlayerTrack | null {
    if (!songIsPlayable(song) || !song.provider_uri || !song.provider) {
        return null;
    }

    return {
        provider: song.provider as MusicProviderId,
        trackId: song.provider_track_id || song.provider_uri.split(':').pop() || '',
        uri: song.provider_uri,
        title: song.title,
        artist: song.artist,
        albumArtUrl: song.album_art_url,
        songId: song.id,
        lyrics: song.lyrics,
    };
}
