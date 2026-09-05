import type { Credentials, CredentialsProvider } from '@tidal-music/common';
import api from '@/lib/api';
import { t } from '@/i18n';
import type { MusicProvider } from '../MusicProvider';
import type {
    MusicProviderId,
    PlayableTrack,
    ProviderPlaybackState,
    ProviderSearchTrack,
} from '../types';

type TidalPlayerModule = typeof import('@tidal-music/player');

const TIDAL_SCOPES = [
    'user.read',
    'search.read',
    'playlists.read',
    'collection.read',
    'playback',
    'entitlements.read',
] as const;

const READY_TIMEOUT_MS = 10_000;
/** Refresh token from Laravel a bit before typical expiry. */
const TOKEN_CACHE_MS = 50 * 60 * 1000;

function trackIdFromUri(uri: string): string {
    if (uri.startsWith('tidal:track:')) {
        return uri.slice('tidal:track:'.length);
    }
    return uri;
}

function humanizeTidalError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error ?? t('providers.tidalUnknown'));
    if (/\bS1002\b/.test(raw) || /\bHTTP_ERROR\b/i.test(raw)) {
        return t('providers.tidalStream');
    }
    if (/\bS60\d{2}\b/.test(raw)) {
        return t('providers.tidalDrm', { raw });
    }
    return raw.startsWith('TIDAL') ? raw : t('providers.tidalPlayer', { raw });
}

/**
 * Official demo uses a noop EventSender when analytics delivery isn't needed.
 * The SDK still requires *some* EventSender before load/play.
 */
function createNoopEventSender(): { sendEvent: (...args: unknown[]) => void } {
    return {
        sendEvent() {
            // no-op
        },
    };
}

/**
 * TIDAL Web Player SDK must not be imported at module top-level:
 * loading `@tidal-music/player` immediately hits api.tidal.com/v1/ping.
 *
 * Media URLs (e.g. sp-ad-fa.audio.tidal.com) must never be fetched by app code —
 * only via Player.load() / Player.play().
 */
export class TidalProvider implements MusicProvider {
    readonly id: MusicProviderId = 'tidal';

    private _ready = false;
    private bootstrapped = false;
    private listenersAttached = false;
    private eventSenderReady = false;
    private volume = 0.7;
    private connecting: Promise<void> | null = null;
    private resetting: Promise<void> | null = null;
    private session = 0;
    private playerModule: TidalPlayerModule | null = null;
    private currentUri: string | null = null;
    private currentTitle = '';
    private currentArtists: string[] = [];
    private currentArt: string | null = null;
    private positionSeconds = 0;
    private durationSeconds = 0;
    private paused = true;
    private positionTimer: number | null = null;
    private credentialsProvider: CredentialsProvider | null = null;
    private cachedCredentials: Credentials | null = null;
    private cachedCredentialsAt = 0;
    private credentialsInflight: Promise<Credentials> | null = null;

    private stateListeners = new Set<(state: ProviderPlaybackState | null) => void>();
    private readyListeners = new Set<(ready: boolean) => void>();
    private errorListeners = new Set<(message: string) => void>();

    get ready(): boolean {
        return this._ready;
    }

    async getAccessToken(): Promise<string> {
        const credentials = await this.fetchCredentials(true);
        return credentials.token ?? '';
    }

    async search(query: string): Promise<ProviderSearchTrack[]> {
        const { data } = await api.get<{ tracks: ProviderSearchTrack[] }>('/music/tidal/search', {
            params: { q: query },
        });
        return data.tracks ?? [];
    }

    async connect(): Promise<void> {
        if (this._ready && this.bootstrapped && this.eventSenderReady) {
            return;
        }
        if (this.connecting) {
            return this.connecting;
        }

        const job = this.doConnect();
        this.connecting = job;

        try {
            await job;
        } finally {
            if (this.connecting === job) {
                this.connecting = null;
            }
        }
    }

    private async loadPlayerModule(): Promise<TidalPlayerModule> {
        if (!this.playerModule) {
            await import('shaka-player');
            this.playerModule = await import('@tidal-music/player');
        }
        return this.playerModule;
    }

    private async fetchCredentials(force = false): Promise<Credentials> {
        const fresh =
            !force &&
            this.cachedCredentials?.token &&
            Date.now() - this.cachedCredentialsAt < TOKEN_CACHE_MS;
        if (fresh && this.cachedCredentials) {
            return this.cachedCredentials;
        }

        if (this.credentialsInflight) {
            return this.credentialsInflight;
        }

        this.credentialsInflight = (async () => {
            const { data } = await api.get<{
                access_token: string;
                client_id?: string | null;
            }>('/music/tidal/token');

            if (!data.client_id) {
                throw new Error(t('providers.tidalClientId'));
            }
            if (!data.access_token) {
                throw new Error(t('providers.tidalToken'));
            }

            const credentials: Credentials = {
                clientId: data.client_id,
                token: data.access_token,
                requestedScopes: [...TIDAL_SCOPES],
            };
            this.cachedCredentials = credentials;
            this.cachedCredentialsAt = Date.now();
            return credentials;
        })();

        try {
            return await this.credentialsInflight;
        } finally {
            this.credentialsInflight = null;
        }
    }

    private async doConnect(): Promise<void> {
        if (this.resetting) {
            await this.resetting;
        }

        const session = this.session;

        try {
            const Player = await this.loadPlayerModule();
            if (session !== this.session) {
                return;
            }

            const credentialsProvider = this.createCredentialsProvider();
            await credentialsProvider.getCredentials();
            if (session !== this.session) {
                return;
            }
            this.credentialsProvider = credentialsProvider;
            Player.setCredentialsProvider(credentialsProvider);

            Player.setEventSender(createNoopEventSender() as never);
            this.eventSenderReady = true;

            this.attachListeners(Player);

            // Match official demo / SDK defaults: shaka handles track (+ video) manifests.
            Player.bootstrap({
                outputDevices: false,
                players: [
                    {
                        player: 'shaka',
                        itemTypes: ['track', 'video'],
                    },
                ],
            });

            await this.waitUntilPlayerIdle(Player, session);
            if (session !== this.session) {
                return;
            }

            this.bootstrapped = true;
            await Player.setVolumeLevel(Math.round(this.volume * 100));
            if (session !== this.session) {
                return;
            }

            this.setReady(true);
            this.startPositionPolling();
        } catch (e) {
            if (session !== this.session) {
                return;
            }
            this.bootstrapped = false;
            this.eventSenderReady = false;
            this.setReady(false);
            const message = humanizeTidalError(e);
            this.emitError(message);
            throw e instanceof Error ? e : new Error(message);
        }
    }

    private async waitUntilPlayerIdle(Player: TidalPlayerModule, session: number): Promise<void> {
        const started = Date.now();
        while (Date.now() - started < READY_TIMEOUT_MS) {
            if (session !== this.session) {
                return;
            }
            const state = Player.getPlaybackState();
            if (state === 'IDLE' || state === 'NOT_PLAYING') {
                return;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
    }

    disconnect(): void {
        this.session += 1;
        this.connecting = null;
        this.stopPositionPolling();
        this.detachListeners();
        this.bootstrapped = false;
        this.eventSenderReady = false;
        this.credentialsProvider = null;
        this.cachedCredentials = null;
        this.cachedCredentialsAt = 0;
        this.credentialsInflight = null;
        this.setReady(false);
        this.currentUri = null;
        this.positionSeconds = 0;
        this.durationSeconds = 0;
        this.paused = true;

        const Player = this.playerModule;
        if (!Player) {
            return;
        }

        const resetJob = Player.reset().catch(() => {
            // ignore
        });
        this.resetting = resetJob.finally(() => {
            if (this.resetting === resetJob) {
                this.resetting = null;
            }
        });
    }

    async play(track: PlayableTrack, positionMs = 0): Promise<void> {
        if (track.provider !== 'tidal' && !track.uri.startsWith('tidal:')) {
            throw new Error(t('providers.tidalWrongTrack'));
        }

        await this.ensureReady();
        const Player = await this.loadPlayerModule();

        const productId = track.trackId || trackIdFromUri(track.uri);
        this.currentUri = track.uri.startsWith('tidal:') ? track.uri : `tidal:track:${productId}`;
        this.currentTitle = track.title;
        this.currentArtists = track.artist ? [track.artist] : [];
        this.currentArt = track.albumArtUrl;
        this.durationSeconds =
            track.durationMs && track.durationMs > 0 ? track.durationMs / 1000 : 0;
        this.positionSeconds = Math.max(0, positionMs / 1000);

        // Warm Laravel-managed OAuth token only — do not touch media CDNs from app code.
        await this.fetchCredentials(true);
        await api.post('/music/tidal/play', {
            uri: this.currentUri,
            device_id: 'tidal-web',
            position_ms: positionMs > 0 ? positionMs : undefined,
        });

        const startAtSeconds = Math.max(0, positionMs / 1000);

        try {
            // SDK owns auth → playback info → DRM → media bytes.
            await Player.load(
                {
                    productType: 'track',
                    productId,
                    sourceType: 'catalog',
                    sourceId: productId,
                },
                startAtSeconds,
            );
            await Player.play();
        } catch (error) {
            const message = humanizeTidalError(error);
            this.emitError(message);
            throw error instanceof Error ? error : new Error(message);
        }

        this.paused = false;
        this.emitState();
    }

    private async ensureReady(): Promise<void> {
        if (this.resetting) {
            await this.resetting;
        }
        if (!this._ready || !this.bootstrapped || !this.eventSenderReady) {
            await this.connect();
        }
        if (!this._ready || !this.bootstrapped || !this.eventSenderReady) {
            throw new Error(t('providers.tidalNotReady'));
        }
    }

    async pause(): Promise<void> {
        if (!this._ready || !this.playerModule) {
            return;
        }
        await this.playerModule.pause();
        this.paused = true;
        this.emitState();
    }

    async resume(): Promise<void> {
        await this.ensureReady();
        const Player = await this.loadPlayerModule();
        await Player.play();
        this.paused = false;
        this.emitState();
    }

    async seek(ms: number): Promise<void> {
        if (!this._ready || !this.playerModule) {
            return;
        }
        await this.playerModule.seek(Math.max(0, ms / 1000));
        this.positionSeconds = Math.max(0, ms / 1000);
        this.emitState();
    }

    async setVolume(volume: number): Promise<void> {
        this.volume = Math.min(1, Math.max(0, volume));
        if (this._ready && this.playerModule) {
            await this.playerModule.setVolumeLevel(Math.round(this.volume * 100));
        }
    }

    async getCurrentState(): Promise<ProviderPlaybackState | null> {
        return this.buildState();
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

    private createCredentialsProvider(): CredentialsProvider {
        return {
            bus: () => {
                // Server-managed tokens; no local credential bus events needed.
            },
            getCredentials: async () => this.fetchCredentials(false),
        };
    }

    private attachListeners(Player: TidalPlayerModule): void {
        if (this.listenersAttached) {
            return;
        }
        Player.events.addEventListener('playback-state-change', this.onPlaybackStateChange as EventListener);
        Player.events.addEventListener('media-product-transition', this.onMediaProductTransition as EventListener);
        Player.events.addEventListener('error', this.onPlayerError as EventListener);
        Player.events.addEventListener('device-change', this.onDeviceChange as EventListener);
        Player.events.addEventListener('active-device-changed', this.onActiveDeviceChanged as EventListener);
        Player.events.addEventListener('ended', this.onEnded as EventListener);
        this.listenersAttached = true;
    }

    private detachListeners(): void {
        if (!this.listenersAttached || !this.playerModule) {
            this.listenersAttached = false;
            return;
        }
        const Player = this.playerModule;
        Player.events.removeEventListener('playback-state-change', this.onPlaybackStateChange as EventListener);
        Player.events.removeEventListener('media-product-transition', this.onMediaProductTransition as EventListener);
        Player.events.removeEventListener('error', this.onPlayerError as EventListener);
        Player.events.removeEventListener('device-change', this.onDeviceChange as EventListener);
        Player.events.removeEventListener('active-device-changed', this.onActiveDeviceChanged as EventListener);
        Player.events.removeEventListener('ended', this.onEnded as EventListener);
        this.listenersAttached = false;
    }

    private onPlaybackStateChange = (event: Event) => {
        const detail = (event as CustomEvent<{ state?: string }>).detail;
        const state = detail?.state;
        this.paused = state !== 'PLAYING';
        if (state === 'IDLE') {
            this.positionSeconds = 0;
        }
        this.emitState();
    };

    private onMediaProductTransition = (event: Event) => {
        const detail = (
            event as CustomEvent<{
                mediaProduct?: { productId?: string };
                playbackContext?: { actualDuration?: number };
            }>
        ).detail;
        const productId = detail?.mediaProduct?.productId;
        if (productId) {
            this.currentUri = `tidal:track:${productId}`;
        }
        const duration = detail?.playbackContext?.actualDuration;
        if (typeof duration === 'number' && duration > 0) {
            this.durationSeconds = duration;
        }
        this.emitState();
    };

    private onPlayerError = (event: Event) => {
        const detail = (event as CustomEvent<{ errorCode?: string; message?: string }>).detail;
        const code = detail?.errorCode ? ` (${detail.errorCode})` : '';
        this.emitError(humanizeTidalError(new Error((detail?.message || t('providers.tidalError')) + code)));
    };

    private onDeviceChange = () => {
        // Observed for SDK readiness / device routing; no UI action required.
    };

    private onActiveDeviceChanged = () => {
        // Observed for SDK readiness / device routing; no UI action required.
    };

    private onEnded = () => {
        this.paused = true;
        this.emitState({ ended: true });
    };

    private startPositionPolling(): void {
        this.stopPositionPolling();
        this.positionTimer = window.setInterval(() => {
            try {
                const pos = this.playerModule?.getAssetPosition();
                if (typeof pos === 'number' && Number.isFinite(pos)) {
                    this.positionSeconds = pos;
                    this.emitState();
                }
            } catch {
                // ignore
            }
        }, 500);
    }

    private stopPositionPolling(): void {
        if (this.positionTimer != null) {
            window.clearInterval(this.positionTimer);
            this.positionTimer = null;
        }
    }

    private buildState(): ProviderPlaybackState | null {
        if (!this.currentUri) {
            return {
                paused: this.paused,
                position: Math.floor(this.positionSeconds * 1000),
                duration: Math.floor(this.durationSeconds * 1000),
                track: null,
            };
        }

        return {
            paused: this.paused,
            position: Math.floor(this.positionSeconds * 1000),
            duration: Math.floor(this.durationSeconds * 1000),
            track: {
                uri: this.currentUri,
                name: this.currentTitle || t('player.fallbackTrack'),
                artists: this.currentArtists,
                albumArtUrl: this.currentArt,
            },
        };
    }

    private emitState(options?: { ended?: boolean }): void {
        const state = this.buildState();
        if (!state) {
            return;
        }
        if (options?.ended) {
            state.ended = true;
        }
        this.stateListeners.forEach((cb) => cb(state));
    }

    private setReady(ready: boolean): void {
        this._ready = ready;
        this.readyListeners.forEach((cb) => cb(ready));
    }

    private emitError(message: string): void {
        this.errorListeners.forEach((cb) => cb(message));
    }
}
