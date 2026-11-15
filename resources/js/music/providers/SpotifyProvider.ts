import api from '@/lib/api';
import { t } from '@/i18n';
import type { MusicProvider } from '../MusicProvider';
import type {
    MusicProviderId,
    PlayableTrack,
    ProviderPlaybackState,
    ProviderSearchTrack,
} from '../types';

declare global {
    interface Window {
        onSpotifyWebPlaybackSDKReady: () => void;
        Spotify: {
            Player: new (options: {
                name: string;
                getOAuthToken: (cb: (token: string) => void) => void;
                volume?: number;
            }) => SpotifyPlayerInstance;
        };
    }
}

type SpotifyPlayerInstance = {
    connect: () => Promise<boolean>;
    disconnect: () => void;
    addListener: (event: string, cb: (payload: any) => void) => boolean;
    removeListener: (event: string, cb?: (payload: any) => void) => boolean;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    setVolume: (volume: number) => Promise<void>;
    seek: (positionMs: number) => Promise<void>;
    getCurrentState: () => Promise<SpotifySdkPlaybackState | null>;
};

type SpotifySdkPlaybackState = {
    paused: boolean;
    position: number;
    duration: number;
    track_window: {
        current_track: {
            name: string;
            uri: string;
            id?: string;
            artists: { name: string }[];
            album: { images: { url: string }[] };
            linked_from?: { uri?: string; id?: string };
        } | null;
        previous_tracks?: { uri: string }[];
    };
};

function loadSdk(): Promise<void> {
    if (window.Spotify) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const existing = document.getElementById('spotify-player-sdk');
        if (existing) {
            window.onSpotifyWebPlaybackSDKReady = () => resolve();
            return;
        }

        window.onSpotifyWebPlaybackSDKReady = () => resolve();
        const script = document.createElement('script');
        script.id = 'spotify-player-sdk';
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        script.onerror = () => reject(new Error(t('providers.spotifySdk')));
        document.body.appendChild(script);
    });
}

function mapState(state: SpotifySdkPlaybackState | null): ProviderPlaybackState | null {
    if (!state) {
        return null;
    }

    const current = state.track_window.current_track;

    return {
        paused: state.paused,
        position: state.position,
        duration: state.duration,
        track: current
            ? {
                  uri: current.uri,
                  name: current.name,
                  artists: current.artists.map((a) => a.name),
                  albumArtUrl: current.album.images[1]?.url ?? current.album.images[0]?.url ?? null,
                  linkedFromUri: current.linked_from?.uri ?? null,
              }
            : null,
    };
}

export class SpotifyProvider implements MusicProvider {
    readonly id: MusicProviderId = 'spotify';

    private player: SpotifyPlayerInstance | null = null;
    private deviceId: string | null = null;
    private _ready = false;
    private volume = 0.7;
    private connecting: Promise<void> | null = null;
    private lastSdkState: SpotifySdkPlaybackState | null = null;

    private stateListeners = new Set<(state: ProviderPlaybackState | null) => void>();
    private readyListeners = new Set<(ready: boolean) => void>();
    private errorListeners = new Set<(message: string) => void>();

    get ready(): boolean {
        return this._ready;
    }

    async getAccessToken(): Promise<string> {
        const { data } = await api.get<{ access_token: string }>('/music/spotify/token');
        return data.access_token;
    }

    async search(query: string): Promise<ProviderSearchTrack[]> {
        const { data } = await api.get<{ tracks: ProviderSearchTrack[] }>('/music/spotify/search', {
            params: { q: query },
        });
        return data.tracks ?? [];
    }

    async connect(): Promise<void> {
        if (this.player && this._ready) {
            return;
        }
        if (this.connecting) {
            return this.connecting;
        }

        this.connecting = (async () => {
            await loadSdk();

            if (this.player) {
                return;
            }

            const player = new window.Spotify.Player({
                name: t('providers.deviceName'),
                getOAuthToken: (cb) => {
                    void this.getAccessToken()
                        .then((token) => cb(token))
                        .catch(() => this.emitError(t('providers.spotifyToken')));
                },
                volume: this.volume,
            });

            player.addListener('ready', ({ device_id }: { device_id: string }) => {
                this.deviceId = device_id;
                this.setReady(true);
                void player.setVolume(this.volume);
            });

            player.addListener('not_ready', () => {
                this.setReady(false);
            });

            player.addListener('player_state_changed', (state: SpotifySdkPlaybackState | null) => {
                const ended = this.detectEnded(this.lastSdkState, state);
                this.lastSdkState = state;
                const mapped = mapState(state);
                if (mapped && ended) {
                    mapped.ended = true;
                }
                this.emitState(mapped);
            });

            player.addListener('initialization_error', ({ message }: { message: string }) => {
                this.emitError(message);
            });

            player.addListener('authentication_error', ({ message }: { message: string }) => {
                this.emitError(message || t('providers.spotifyAuth'));
            });

            player.addListener('account_error', ({ message }: { message: string }) => {
                this.emitError(message || t('providers.spotifyPremium'));
            });

            const connected = await player.connect();
            if (connected) {
                this.player = player;
            }
        })();

        try {
            await this.connecting;
        } finally {
            this.connecting = null;
        }
    }

    disconnect(): void {
        this.player?.disconnect();
        this.player = null;
        this.deviceId = null;
        this.lastSdkState = null;
        this.setReady(false);
    }

    async play(track: PlayableTrack, positionMs = 0): Promise<void> {
        if (track.provider !== 'spotify' && !track.uri.startsWith('spotify:')) {
            throw new Error(t('providers.spotifyUri'));
        }
        if (!this.deviceId) {
            throw new Error(t('providers.spotifyNotReady'));
        }

        await api.post('/music/spotify/play', {
            uri: track.uri,
            device_id: this.deviceId,
            position_ms: positionMs > 0 ? positionMs : undefined,
        });

        if (positionMs > 0 && this.player) {
            await this.player.seek(positionMs);
        }
    }

    async pause(): Promise<void> {
        await this.player?.pause();
    }

    async resume(): Promise<void> {
        await this.player?.resume();
    }

    async silence(): Promise<void> {
        try {
            await this.player?.pause();
        } catch {
            // ignore
        }
        try {
            await this.setVolume(0);
        } catch {
            // ignore
        }
    }

    async seek(ms: number): Promise<void> {
        await this.player?.seek(ms);
    }

    async setVolume(volume: number): Promise<void> {
        this.volume = Math.min(1, Math.max(0, volume));
        await this.player?.setVolume(this.volume);
    }

    async getCurrentState(): Promise<ProviderPlaybackState | null> {
        return mapState((await this.player?.getCurrentState()) ?? null);
    }

    onStateChange(cb: (state: ProviderPlaybackState | null) => void): () => void {
        this.stateListeners.add(cb);
        return () => this.stateListeners.delete(cb);
    }

    onReadyChange(cb: (ready: boolean) => void): () => void {
        this.readyListeners.add(cb);
        return () => this.readyListeners.delete(cb);
    }

    onError(cb: (message: string) => void): () => void {
        this.errorListeners.add(cb);
        return () => this.errorListeners.delete(cb);
    }

    private detectEnded(
        prev: SpotifySdkPlaybackState | null,
        next: SpotifySdkPlaybackState | null,
    ): boolean {
        if (!next) {
            return Boolean(
                prev && !prev.paused && prev.duration > 0 && prev.position >= prev.duration - 3000,
            );
        }
        if (next.duration > 0 && next.paused && next.position >= next.duration - 400) {
            return true;
        }
        if (
            prev &&
            next.paused &&
            next.position < 1000 &&
            !prev.paused &&
            prev.duration > 0 &&
            (prev.position >= prev.duration - 12000 || prev.position >= prev.duration * 0.8) &&
            prev.track_window.current_track?.uri === next.track_window.current_track?.uri
        ) {
            return true;
        }
        return false;
    }

    private setReady(ready: boolean): void {
        this._ready = ready;
        this.readyListeners.forEach((cb) => cb(ready));
    }

    private emitState(state: ProviderPlaybackState | null): void {
        this.stateListeners.forEach((cb) => cb(state));
    }

    private emitError(message: string): void {
        this.errorListeners.forEach((cb) => cb(message));
    }
}
