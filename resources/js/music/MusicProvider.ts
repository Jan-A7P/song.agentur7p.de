import type {
    MusicProviderId,
    PlayableTrack,
    ProviderPlaybackState,
    ProviderSearchTrack,
} from './types';

export interface MusicProvider {
    readonly id: MusicProviderId;
    readonly ready: boolean;

    connect(): Promise<void>;
    disconnect(): void;
    getAccessToken(): Promise<string>;
    search(query: string): Promise<ProviderSearchTrack[]>;
    play(track: PlayableTrack, positionMs?: number): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(ms: number): Promise<void>;
    setVolume(volume: number): Promise<void>;
    getCurrentState(): Promise<ProviderPlaybackState | null>;
    onStateChange(cb: (state: ProviderPlaybackState | null) => void): () => void;
    onReadyChange(cb: (ready: boolean) => void): () => void;
    onError(cb: (message: string) => void): () => void;
}
