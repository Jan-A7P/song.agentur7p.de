const HOST_ID = 'tidal-sdk-elements';

export type TidalProductType = 'track' | 'video';

type TidalElements = {
    host: HTMLDivElement;
    playTrigger: HTMLElement;
    progressBar: HTMLElement;
    currentTime: HTMLElement;
    durationTime: HTMLElement;
    videoView: HTMLElement;
};

let mounted: TidalElements | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
function el(tag: string): HTMLElement;
function el(tag: string): HTMLElement {
    return document.createElement(tag);
}

/**
 * Registers TIDAL's custom elements (via the package side-effect) and mounts
 * one instance of each tag. They stay in the document so connectedCallback
 * runs; our PersistentPlayerBar remains the visible chrome.
 */
export async function mountTidalCustomElements(): Promise<TidalElements> {
    await import('@tidal-music/player-web-components');

    if (mounted?.host.isConnected) {
        return mounted;
    }

    mounted?.host.remove();

    const host = el('div');
    host.id = HOST_ID;
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('hidden', '');
    host.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);';

    const playTrigger = el('tidal-play-trigger');
    playTrigger.setAttribute('product-type', 'track');
    const playButton = el('button');
    playButton.type = 'button';
    playButton.tabIndex = -1;
    playButton.textContent = 'Play';
    playTrigger.appendChild(playButton);

    const progressBar = el('tidal-progress-bar');
    const currentTime = el('tidal-current-time');
    const durationTime = el('tidal-duration-time');
    const videoView = el('tidal-video-view');

    host.append(playTrigger, progressBar, currentTime, durationTime, videoView);
    document.body.appendChild(host);

    mounted = { host, playTrigger, progressBar, currentTime, durationTime, videoView };
    return mounted;
}

export function setTidalPlayProduct(productId: string | null, productType: TidalProductType = 'track'): void {
    const trigger = mounted?.playTrigger;
    if (!trigger) {
        return;
    }
    if (productId) {
        trigger.setAttribute('product-id', productId);
        trigger.setAttribute('product-type', productType);
    } else {
        trigger.removeAttribute('product-id');
    }
}

export function unmountTidalCustomElements(): void {
    mounted?.host.remove();
    mounted = null;
}
