import api from '@/lib/api';
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
            artists: { name: string }[];
            album: { images: { url: string }[] };
        } | null;
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
        script.onerror = () => reject(new Error('Spotify SDK konnte nicht geladen werden.'));
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
                name: 'Songtexte Player',
                getOAuthToken: (cb) => {
                    void this.getAccessToken()
                        .then((token) => cb(token))
                        .catch(() => this.emitError('Spotify-Token konnte nicht geladen werden.'));
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
                this.emitState(mapState(state));
            });

            player.addListener('initialization_error', ({ message }: { message: string }) => {
                this.emitError(message);
            });

            player.addListener('authentication_error', ({ message }: { message: string }) => {
                this.emitError(message || 'Spotify-Auth fehlgeschlagen. Premium erforderlich.');
            });

            player.addListener('account_error', ({ message }: { message: string }) => {
                this.emitError(message || 'Spotify Premium erforderlich.');
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
        this.setReady(false);
    }

    async play(track: PlayableTrack, positionMs = 0): Promise<void> {
        if (track.provider !== 'spotify' && !track.uri.startsWith('spotify:')) {
            throw new Error('Ungültige Spotify-URI.');
        }
        if (!this.deviceId) {
            throw new Error('Spotify Player ist noch nicht bereit.');
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
