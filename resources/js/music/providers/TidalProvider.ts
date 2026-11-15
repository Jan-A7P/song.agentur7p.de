import type { Credentials } from '@tidal-music/common';
import api from '@/lib/api';
import { t } from '@/i18n';
import type { MusicProvider } from '../MusicProvider';
import type {
    MusicProviderId,
    PlayableTrack,
    ProviderPlaybackState,
    ProviderSearchTrack,
} from '../types';
import { mountTidalCustomElements, setTidalPlayProduct, unmountTidalCustomElements } from './tidal-elements';

type TidalPlayerModule = typeof import('@tidal-music/player');
type TidalAuthModule = typeof import('@tidal-music/auth');
type TidalEventProducerModule = typeof import('@tidal-music/event-producer');
type TidalWebComponentsModule = typeof import('@tidal-music/player-web-components');
type TidalPlaybackContext = {
    actualAssetPresentation?: string;
    actualDuration?: number;
    previewReason?: string;
};

const TIDAL_SCOPES = ['playback', 'playlists.read'] as const;
const LOAD_TIMEOUT_MS = 15_000;
const PREVIEW_MAX_SECONDS = 35;

function trackIdFromUri(uri: string): string {
    if (uri.startsWith('tidal:track:')) {
        return uri.slice('tidal:track:'.length);
    }
    return uri;
}

function errorDetail(error: unknown): { raw: string; code: string } {
    if (error && typeof error === 'object') {
        const record = error as { errorCode?: unknown; errorId?: unknown; message?: unknown };
        const code = [record.errorCode, record.errorId].filter((part) => typeof part === 'string').join(' ');
        const message = typeof record.message === 'string' ? record.message : '';
        const raw = [message, code].filter(Boolean).join(' ').trim();
        if (raw) {
            return { raw, code };
        }
    }
    if (error instanceof Error && error.message) {
        return { raw: error.message, code: error.message };
    }
    return { raw: String(error ?? t('providers.tidalUnknown')), code: '' };
}

function humanizeTidalError(error: unknown): string {
    const { raw, code } = errorDetail(error);
    const haystack = `${raw} ${code}`;
    if (/\bNo active player\b/i.test(haystack)) {
        return t('providers.tidalNoPlayer');
    }
    if (/\bPREVIEW\b/.test(haystack)) {
        return t('providers.tidalPreview');
    }
    if (
        /\bS1002\b/.test(haystack) ||
        /\bS10\d{2}\b/.test(haystack) ||
        /\bPENetwork\b/.test(haystack) ||
        /\bHTTP_ERROR\b/i.test(haystack) ||
        /CORS|Access-Control-Allow-Origin|Failed to fetch/i.test(haystack)
    ) {
        return t('providers.tidalStream');
    }
    if (/\bME01\b/.test(haystack) || /MEDIA_ERR_SRC_NOT_SUPPORTED|Failed to open media|HTMLMediaElement/i.test(haystack)) {
        return t('providers.tidalMedia');
    }
    if (/\bS4034\b/.test(haystack) || /\bA4034\b/.test(haystack) || /\bPENotAllowed\b/.test(haystack)) {
        return t('providers.tidalCapabilities');
    }
    if (/\bS60\d{2}\b/.test(haystack)) {
        return t('providers.tidalDrm', { raw });
    }
    return raw.startsWith('TIDAL') ? raw : t('providers.tidalPlayer', { raw });
}

function isPreviewContext(context: TidalPlaybackContext | null | undefined): boolean {
    if (!context) {
        return false;
    }
    if (context.actualAssetPresentation === 'PREVIEW' || Boolean(context.previewReason)) {
        return true;
    }
    return typeof context.actualDuration === 'number' && context.actualDuration > 0 && context.actualDuration <= PREVIEW_MAX_SECONDS;
}

function browserPlatform(): { browserName: string; browserVersion: string; osName: string } {
    const ua = navigator.userAgent;
    let browserName = 'Chrome';
    if (ua.includes('Firefox')) {
        browserName = 'Firefox';
    } else if (ua.includes('Edg/')) {
        browserName = 'Edge';
    } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
        browserName = 'Safari';
    }
    return {
        browserName,
        browserVersion: '1',
        osName: navigator.platform || 'web',
    };
}

/**
 * TIDAL Web Player SDK must not be imported at module top-level:
 * loading `@tidal-music/player` immediately hits api.tidal.com/v1/ping.
 *
 * `player-web-components` registers `<tidal-play-trigger>` and friends and is
 * the official `setCredentialsProvider` path. Playback APIs (bootstrap/load)
 * stay on `@tidal-music/player` so our bar can seek and set volume.
 */
export class TidalProvider implements MusicProvider {
    readonly id: MusicProviderId = 'tidal';

    private _ready = false;
    private bootstrapped = false;
    private listenersAttached = false;
    private authReady = false;
    private eventProducerReady = false;
    private volume = 0.7;
    private connecting: Promise<void> | null = null;
    private session = 0;
    private playerModule: TidalPlayerModule | null = null;
    private authModule: TidalAuthModule | null = null;
    private eventProducer: TidalEventProducerModule | null = null;
    private webComponents: TidalWebComponentsModule | null = null;
    private currentUri: string | null = null;
    private currentTitle = '';
    private currentArtists: string[] = [];
    private currentArt: string | null = null;
    private positionSeconds = 0;
    private durationSeconds = 0;
    private paused = true;
    private positionTimer: number | null = null;
    private loadError: unknown = null;
    private suppressErrorEmit = false;
    private previewAborted = false;

    private stateListeners = new Set<(state: ProviderPlaybackState | null) => void>();
    private readyListeners = new Set<(ready: boolean) => void>();
    private errorListeners = new Set<(message: string) => void>();

    get ready(): boolean {
        return this._ready;
    }

    async getAccessToken(): Promise<string> {
        const { data } = await api.get<{ access_token: string }>('/music/tidal/token');
        if (!data.access_token) {
            throw new Error(t('providers.tidalToken'));
        }
        return data.access_token;
    }

    async search(query: string): Promise<ProviderSearchTrack[]> {
        const { data } = await api.get<{ tracks: ProviderSearchTrack[] }>('/music/tidal/search', {
            params: { q: query },
        });
        return data.tracks ?? [];
    }

    async connect(): Promise<void> {
        if (this._ready && this.bootstrapped) {
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

    disconnect(): void {
        this.session += 1;
        this.connecting = null;
        this.stopPositionPolling();
        this.detachListeners();
        this.setReady(false);
        this.currentUri = null;
        this.positionSeconds = 0;
        this.durationSeconds = 0;
        this.paused = true;
        this.loadError = null;
        setTidalPlayProduct(null);
        unmountTidalCustomElements();

        void this.playerModule?.pause();
        void this.playerModule?.reset().catch(() => {
            // ignore
        });
    }

    async play(track: PlayableTrack, positionMs = 0): Promise<void> {
        if (track.provider !== 'tidal' && !track.uri.startsWith('tidal:')) {
            throw new Error(t('providers.tidalWrongTrack'));
        }

        await this.ensureReady();
        const Player = this.requirePlayer();
        const productId = track.trackId || trackIdFromUri(track.uri);

        this.currentUri = track.uri.startsWith('tidal:') ? track.uri : `tidal:track:${productId}`;
        this.currentTitle = track.title;
        this.currentArtists = track.artist ? [track.artist] : [];
        this.currentArt = track.albumArtUrl;
        this.durationSeconds = track.durationMs && track.durationMs > 0 ? track.durationMs / 1000 : 0;
        this.positionSeconds = Math.max(0, positionMs / 1000);
        this.previewAborted = false;
        setTidalPlayProduct(productId, 'track');

        try {
            await this.loadAndPlay(Player, productId, Math.max(0, positionMs / 1000));
            this.applyVolume(Player);
        } catch (error) {
            this.paused = true;
            this.stopPositionPolling();
            const message = humanizeTidalError(error);
            this.emitError(message);
            throw error instanceof Error ? error : new Error(message);
        }

        this.paused = false;
        this.startPositionPolling();
        this.emitState();
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
        await this.requirePlayer().play();
        this.paused = false;
        this.startPositionPolling();
        this.emitState();
    }

    async silence(): Promise<void> {
        this.stopPositionPolling();
        this.paused = true;
        try {
            await this.playerModule?.pause();
        } catch {
            // ignore
        }
        try {
            await this.playerModule?.reset();
        } catch {
            // ignore
        }
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
            this.applyVolume(this.playerModule);
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

    private async doConnect(): Promise<void> {
        const session = this.session;

        try {
            const [auth, Player, eventProducer, webComponents] = await Promise.all([
                this.authModule ? Promise.resolve(this.authModule) : import('@tidal-music/auth'),
                this.playerModule ? Promise.resolve(this.playerModule) : import('@tidal-music/player'),
                this.eventProducer ? Promise.resolve(this.eventProducer) : import('@tidal-music/event-producer'),
                this.webComponents
                    ? Promise.resolve(this.webComponents)
                    : import('@tidal-music/player-web-components'),
            ]);
            if (session !== this.session) {
                return;
            }
            this.authModule = auth;
            this.playerModule = Player;
            this.eventProducer = eventProducer;
            this.webComponents = webComponents;

            const credentials = await this.fetchLaravelCredentials();
            if (session !== this.session) {
                return;
            }

            if (!this.authReady) {
                await auth.init({
                    clientId: credentials.clientId,
                    credentialsStorageKey: 'songtexte.tidal',
                    scopes: [...TIDAL_SCOPES],
                });
                this.authReady = true;
            }

            await this.applyCredentials(auth, credentials);

            await mountTidalCustomElements();
            webComponents.setCredentialsProvider(auth.credentialsProvider);
            Player.setCredentialsProvider(auth.credentialsProvider);

            if (!this.eventProducerReady) {
                await eventProducer.init({
                    appInfo: { appName: 'Songtexte', appVersion: '1.0.0' },
                    blockedConsentCategories: {
                        NECESSARY: false,
                        PERFORMANCE: true,
                        TARGETING: true,
                    },
                    credentialsProvider: auth.credentialsProvider,
                    platform: browserPlatform(),
                    tlConsumerUri: 'https://ec.tidal.com/api/event-batch',
                    tlPublicConsumerUri: 'https://ec.tidal.com/api/public/event-batch',
                });
                this.eventProducerReady = true;
            }
            webComponents.setEventSender(eventProducer);
            Player.setEventSender(eventProducer);

            this.attachListeners(Player);

            if (!this.bootstrapped) {
                Player.bootstrap({
                    outputDevices: false,
                    players: [
                        {
                            player: 'shaka',
                            itemTypes: ['track', 'video'],
                            qualities: ['HIGH', 'LOSSLESS', 'LOW', 'HI_RES_LOSSLESS'],
                        },
                    ],
                });
                this.bootstrapped = true;
            }

            this.applyVolume(Player);
            this.setReady(true);
        } catch (error) {
            if (session !== this.session) {
                return;
            }
            this.setReady(false);
            const message = humanizeTidalError(error);
            this.emitError(message);
            throw error instanceof Error ? error : new Error(message);
        }
    }

    private async fetchLaravelCredentials(): Promise<Credentials & { refreshToken?: string }> {
        const { data } = await api.get<{
            access_token: string;
            refresh_token?: string | null;
            client_id?: string | null;
            user_id?: string | number | null;
            expires_at?: number | null;
        }>('/music/tidal/token');

        if (!data.client_id) {
            throw new Error(t('providers.tidalClientId'));
        }
        if (!data.access_token) {
            throw new Error(t('providers.tidalToken'));
        }

        const credentials: Credentials & { refreshToken?: string } = {
            clientId: data.client_id,
            token: data.access_token,
            requestedScopes: [...TIDAL_SCOPES],
            grantedScopes: [...TIDAL_SCOPES],
        };
        if (data.user_id != null && String(data.user_id) !== '') {
            credentials.userId = String(data.user_id);
        }
        if (typeof data.expires_at === 'number' && data.expires_at > 0) {
            credentials.expires = data.expires_at;
        }
        if (data.refresh_token) {
            credentials.refreshToken = data.refresh_token;
        }
        return credentials;
    }

    private async applyCredentials(
        auth: TidalAuthModule,
        credentials: Credentials & { refreshToken?: string },
    ): Promise<void> {
        const payload = {
            accessToken: {
                clientId: credentials.clientId,
                token: credentials.token,
                requestedScopes: credentials.requestedScopes,
                grantedScopes: credentials.grantedScopes ?? credentials.requestedScopes,
                userId: credentials.userId,
                expires: credentials.expires,
            },
            refreshToken: credentials.refreshToken,
        };

        try {
            await auth.setCredentials(payload);
        } catch {
            auth.logout();
            await auth.setCredentials(payload);
        }
    }

    private async loadAndPlay(Player: TidalPlayerModule, productId: string, startAtSeconds: number): Promise<void> {
        this.loadError = null;
        this.previewAborted = false;
        this.suppressErrorEmit = true;

        let timeoutId = 0;
        const timeout = new Promise<never>((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error(t('providers.tidalNotReady'))), LOAD_TIMEOUT_MS);
        });


        try {
            await Promise.race([
                Player.load(
                    {
                        productType: 'track',
                        productId,
                        sourceType: 'catalog',
                        sourceId: productId,
                    },
                    startAtSeconds,
                ),
                timeout,
            ]);

            if (this.loadError) {
                throw this.loadError;
            }
            if (this.previewAborted) {
                throw new Error('PREVIEW');
            }

            this.rejectIfPreview(Player.getPlaybackContext());

            const media = Player.getMediaElement();
            const state = Player.getPlaybackState();
            if (!media && state === 'IDLE') {
                throw new Error('No active player');
            }

            await Player.play();
            await this.waitForAudibleStart(Player);
            if (this.loadError) {
                throw this.loadError;
            }
            if (this.previewAborted) {
                throw new Error('PREVIEW');
            }
        } finally {
            window.clearTimeout(timeoutId);
            this.suppressErrorEmit = false;
        }
    }

    /** CORS/S1002 hits when Shaka fetches `*.audio.tidal.com` — after play() resolves. */
    private async waitForAudibleStart(Player: TidalPlayerModule): Promise<void> {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
            if (this.loadError) {
                throw this.loadError;
            }
            if (this.previewAborted) {
                throw new Error('PREVIEW');
            }

            const media = Player.getMediaElement();
            const pos = Player.getAssetPosition();
            const time =
                typeof pos === 'number' && Number.isFinite(pos) && pos > 0
                    ? pos
                    : (media?.currentTime ?? 0);
            if (Player.getPlaybackState() === 'PLAYING' && time > 0.05) {
                return;
            }

            await new Promise((resolve) => window.setTimeout(resolve, 120));
        }

        if (this.loadError) {
            throw this.loadError;
        }
        throw new Error('S1002');
    }

    private rejectIfPreview(context: TidalPlaybackContext | null | undefined): void {
        if (!isPreviewContext(context)) {
            return;
        }
        this.previewAborted = true;
        void this.playerModule?.pause();
        void this.playerModule?.reset().catch(() => {
            // ignore
        });
        throw new Error('PREVIEW');
    }

    private applyVolume(Player: TidalPlayerModule): void {
        Player.setVolumeLevel(this.volume);
        const media = Player.getMediaElement();
        if (media) {
            media.volume = this.volume;
        }
    }

    private async ensureReady(): Promise<void> {
        if (!this._ready || !this.bootstrapped) {
            await this.connect();
        }
        if (!this._ready || !this.bootstrapped) {
            throw new Error(t('providers.tidalNotReady'));
        }
    }

    private requirePlayer(): TidalPlayerModule {
        if (!this.playerModule) {
            throw new Error(t('providers.tidalNotReady'));
        }
        return this.playerModule;
    }

    private attachListeners(Player: TidalPlayerModule): void {
        if (this.listenersAttached) {
            return;
        }
        Player.events.addEventListener('error', this.onPlayerError);
        Player.events.addEventListener('playback-state-change', this.onPlaybackStateChange);
        Player.events.addEventListener('media-product-transition', this.onMediaProductTransition);
        Player.events.addEventListener('ended', this.onEnded);
        this.listenersAttached = true;
    }

    private detachListeners(): void {
        if (!this.listenersAttached || !this.playerModule) {
            this.listenersAttached = false;
            return;
        }
        const Player = this.playerModule;
        Player.events.removeEventListener('error', this.onPlayerError);
        Player.events.removeEventListener('playback-state-change', this.onPlaybackStateChange);
        Player.events.removeEventListener('media-product-transition', this.onMediaProductTransition);
        Player.events.removeEventListener('ended', this.onEnded);
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
                playbackContext?: TidalPlaybackContext;
            }>
        ).detail;
        try {
            this.rejectIfPreview(detail?.playbackContext);
        } catch {
            if (!this.suppressErrorEmit) {
                this.emitError(t('providers.tidalPreview'));
            }
            this.paused = true;
            this.emitState();
            return;
        }
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
        const detail = (event as CustomEvent<unknown>).detail;
        this.loadError = detail ?? event;
        if (this.suppressErrorEmit) {
            return;
        }
        this.emitError(humanizeTidalError(this.loadError));
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
        }, 250);
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
