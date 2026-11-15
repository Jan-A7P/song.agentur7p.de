import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass, Heart, Pause, Play, RotateCcw, X } from 'lucide-react';
import api from '@/lib/api';
import type { DiscoveryCard, Song } from '@/types';
import { useAuth } from '@/context/auth-context';
import { useI18n } from '@/context/locale-context';
import { usePlayer, type PlayerTrack } from '@/context/player-context';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ArtistLinks } from '@/components/ArtistLinks';
import { AppTooltip } from '@/components/ui/tooltip';
import { hasPlaybackConnected, isProviderConnected } from '@/lib/music';
import { songProviderLinks, songToPlayerTrack } from '@/lib/playable';
import { SongProviderBadges } from '@/components/SongPlayButton';
import { emitFavoriteChange } from '@/lib/favorite-sync';
import { invalidateSongListCache } from '@/lib/song-list-cache';

const SWIPE_MS = 320;

function commitDistance(width: number): number {
    return Math.max(200, width * 0.5);
}

function flyDistance(width: number): number {
    return Math.max(width * 1.35, 480);
}

function cardTitle(card: DiscoveryCard): string {
    return card.song?.title ?? card.spotify?.name ?? 'Track';
}

function cardArtist(card: DiscoveryCard): string {
    return card.song?.artist ?? card.spotify?.artist ?? '';
}

function cardArt(card: DiscoveryCard): string | null {
    return card.song?.album_art_url ?? card.spotify?.album_art_url ?? null;
}

function cardToPlayerTrack(card: DiscoveryCard, user: Parameters<typeof songToPlayerTrack>[1]): PlayerTrack | null {
    if (card.song) {
        return songToPlayerTrack(card.song, user);
    }
    const spotify = card.spotify;
    if (!spotify?.uri || !spotify.id) {
        return null;
    }
    if (user && !isProviderConnected(user, 'spotify')) {
        return null;
    }
    return {
        provider: 'spotify',
        trackId: spotify.id,
        uri: spotify.uri,
        title: spotify.name,
        artist: spotify.artist,
        albumArtUrl: spotify.album_art_url,
        durationMs: spotify.duration_ms,
    };
}

export function DiscoverPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const { user } = useAuth();
    const { track, playing, playTrack, toggle } = usePlayer();
    const [cards, setCards] = useState<DiscoveryCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
    const startRef = useRef<{ x: number; y: number } | null>(null);
    const pointerIdRef = useRef<number | null>(null);
    const busyRef = useRef(false);
    const currentRef = useRef<DiscoveryCard | null>(null);
    const cardsRef = useRef<DiscoveryCard[]>([]);
    const cardRef = useRef<HTMLDivElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const shellRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef(drag);
    const userRef = useRef(user);
    userRef.current = user;
    dragRef.current = drag;

    const load = useCallback(async (append = false) => {
        if (!append) {
            setLoading(true);
        }
        setError(null);
        try {
            const { data } = await api.get<{ data: DiscoveryCard[] }>('/discover/feed', {
                params: { limit: 12 },
            });
            setCards((prev) => {
                const incoming = data.data ?? [];
                if (!append) {
                    return incoming;
                }
                const seen = new Set(prev.map((card) => card.id));
                return [...prev, ...incoming.filter((card) => !seen.has(card.id))];
            });
        } catch {
            setError(t('discover.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const current = cards[0] ?? null;
    currentRef.current = current;
    cardsRef.current = cards;
    busyRef.current = busy;

    const playable = current ? cardToPlayerTrack(current, user) : null;
    const canPlay = Boolean(
        playable || (current?.spotify?.uri && current.source === 'spotify'),
    );
    const isCurrent = Boolean(
        playable &&
            (track?.uri === playable.uri ||
                (playable.songId != null && track?.songId === playable.songId)),
    );
    const isPlayingHere = isCurrent && playing;

    const onPlay = async () => {
        const card = currentRef.current;
        if (!card) {
            return;
        }
        if (!hasPlaybackConnected(user)) {
            navigate('/settings');
            return;
        }
        const next = cardToPlayerTrack(card, user);
        if (!next) {
            navigate('/settings');
            return;
        }
        const same =
            track?.uri === next.uri || (next.songId != null && track?.songId === next.songId);
        if (same) {
            await toggle();
            return;
        }
        await playTrack(next, { radio: false });
    };

    const swipe = useCallback(async (direction: 'like' | 'dislike') => {
        const card = currentRef.current;
        if (!card || busyRef.current) {
            return;
        }
        busyRef.current = true;
        setBusy(true);
        pointerIdRef.current = null;
        startRef.current = null;

        const upcoming = cardsRef.current[1] ?? null;
        const payload =
            card.source === 'catalog' && card.song
                ? { direction, song_id: card.song.id }
                : {
                      direction,
                      provider: 'spotify' as const,
                      provider_track_id: card.spotify?.id,
                      provider_uri:
                          card.spotify?.uri ||
                          (card.spotify?.id ? `spotify:track:${card.spotify.id}` : undefined),
                      title: card.spotify?.name || t('common.unknownTitle'),
                      artist: card.spotify?.artist || t('common.unknownArtist'),
                      album_art_url: card.spotify?.album_art_url,
                      duration_ms:
                          card.spotify?.duration_ms && card.spotify.duration_ms > 0
                              ? card.spotify.duration_ms
                              : undefined,
                  };
        const request = api.post<{ data: { song: Song | null } }>('/discover/swipe', payload);

        const width = cardRef.current?.getBoundingClientRect().width ?? 360;
        const sign = direction === 'like' ? 1 : -1;
        const from = dragRef.current;
        setDrag({ x: from.x, y: from.y, active: false });
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setDrag({ x: sign * flyDistance(width), y: from.y * 0.25, active: false });
                    window.setTimeout(resolve, SWIPE_MS);
                });
            });
        });

        try {
            const { data } = await request;
            const song = data.data?.song;
            if (direction === 'like' && song?.id) {
                emitFavoriteChange(song.id, true);
                invalidateSongListCache();
            }
            setCards((prev) => prev.slice(1));
            setDrag({ x: 0, y: 0, active: false });
            if (upcoming) {
                const next = cardToPlayerTrack(upcoming, userRef.current);
                if (next) {
                    await playTrack(next, { radio: false });
                }
            }
        } catch {
            setDrag({ x: 0, y: 0, active: false });
            setError(direction === 'like' ? t('discover.likeFailed') : t('discover.swipeFailed'));
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [playTrack]);

    useEffect(() => {
        if (!loading && cards.length < 4 && cards.length > 0) {
            void load(true);
        }
    }, [cards.length, loading, load]);

    useEffect(() => {
        if (!current) {
            return;
        }
        const shell = shellRef.current;
        if (!shell) {
            return;
        }
        const active = document.activeElement;
        if (
            active === document.body ||
            active === document.documentElement ||
            shell === active ||
            shell.contains(active)
        ) {
            shell.focus({ preventScroll: true });
        }
    }, [current?.id]);

    const onDiscoverKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.currentTarget !== event.target) {
            return;
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            void swipe('like');
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            void swipe('dislike');
        }
    };

    useEffect(() => {
        const stage = stageRef.current;
        if (!stage) {
            return;
        }
        const apply = () => {
            const maxSide = Math.min(stage.clientWidth, 448);
            const side = Math.max(180, Math.min(maxSide, stage.clientHeight - 72));
            stage.style.setProperty('--discover-card', `${Math.floor(side)}px`);
        };
        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(stage);
        return () => observer.disconnect();
    }, [current?.id, loading, error]);

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (busy || !current) {
            return;
        }
        if ((event.target as HTMLElement).closest('a, button')) {
            return;
        }
        shellRef.current?.focus({ preventScroll: true });
        pointerIdRef.current = event.pointerId;
        startRef.current = { x: event.clientX, y: event.clientY };
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ x: 0, y: 0, active: true });
    };

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!startRef.current || pointerIdRef.current !== event.pointerId) {
            return;
        }
        setDrag({
            x: event.clientX - startRef.current.x,
            y: event.clientY - startRef.current.y,
            active: true,
        });
    };

    const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (pointerIdRef.current !== event.pointerId) {
            return;
        }
        const start = startRef.current;
        pointerIdRef.current = null;
        startRef.current = null;
        const x = start ? event.clientX - start.x : dragRef.current.x;
        const y = start ? event.clientY - start.y : dragRef.current.y;
        const width = cardRef.current?.getBoundingClientRect().width ?? 360;
        const threshold = commitDistance(width);
        if (Math.abs(x) >= threshold && Math.abs(x) >= Math.abs(y)) {
            void swipe(x > 0 ? 'like' : 'dislike');
            return;
        }
        setDrag({ x: 0, y: 0, active: false });
    };

    const width = cardRef.current?.getBoundingClientRect().width ?? 360;
    const threshold = commitDistance(width);
    const rotate = Math.max(-20, Math.min(20, drag.x / 16));
    const likeHint = Math.min(1, Math.max(0, drag.x / threshold));
    const dislikeHint = Math.min(1, Math.max(0, -drag.x / threshold));

    return (
        <div className="mx-auto flex h-full min-h-0 w-full flex-col">
            {error && (
                <div className="mx-auto w-full max-w-lg shrink-0 px-4 pb-2 sm:px-6">
                    <Alert variant="error">{error}</Alert>
                </div>
            )}

            {loading && !current ? (
                <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden rounded-3xl border border-line bg-paper-2 shadow-sm">
                    <div className="min-h-0 flex-1 animate-pulse bg-line/40" />
                    <div className="shrink-0 space-y-2 p-4">
                        <div className="h-5 w-2/3 animate-pulse rounded bg-line/50" />
                        <div className="h-4 w-1/3 animate-pulse rounded bg-line/40" />
                    </div>
                </div>
            ) : !current ? (
                <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-line px-6 py-8 text-center">
                    <Compass className="mb-3 h-8 w-8 text-muted" />
                    <p className="font-medium">{t('discover.emptyTitle')}</p>
                    <p className="mt-1 text-sm text-muted">{t('discover.emptyBody')}</p>
                    <Button type="button" className="mt-5" variant="outline" onClick={() => void load()}>
                        <RotateCcw className="h-4 w-4" />
                        {t('common.reload')}
                    </Button>
                </div>
            ) : (
                <div
                    ref={shellRef}
                    tabIndex={0}
                    role="region"
                    aria-label={t('discover.regionLabel')}
                    onKeyDown={onDiscoverKeyDown}
                    className="flex min-h-0 w-full flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset"
                >
                    <div
                        ref={stageRef}
                        className="relative flex min-h-0 w-full flex-1 flex-col items-center justify-center overflow-x-visible"
                    >
                        <div className="relative select-none pb-4" style={{ width: 'min(100%, var(--discover-card, 24rem))' }}>
                            {cards.slice(1, 3).map((card, index) => (
                                <div
                                    key={card.id}
                                    aria-hidden
                                    className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden rounded-3xl border border-line bg-paper shadow-sm"
                                    style={{
                                        transform: `translateY(${(index + 1) * 8}px) scale(${1 - (index + 1) * 0.04})`,
                                        zIndex: 1 - index,
                                        opacity: 0.7 - index * 0.15,
                                    }}
                                >
                                    <div className="aspect-square bg-paper-2">
                                        {cardArt(card) ? (
                                            <img
                                                src={cardArt(card) ?? ''}
                                                alt=""
                                                className="h-full w-full object-cover object-center"
                                            />
                                        ) : null}
                                    </div>
                                    <div className="h-14 bg-paper" />
                                </div>
                            ))}

                            <div
                                ref={cardRef}
                                className={cn(
                                    'relative z-10 touch-none select-none overflow-hidden rounded-3xl border border-line bg-paper shadow-[0_18px_50px_rgba(26,23,20,0.14)] dark:shadow-[0_22px_48px_rgba(0,0,0,0.5)]',
                                    drag.active ? 'cursor-grabbing' : 'cursor-grab',
                                )}
                                style={{
                                    transform: `translate(${drag.x}px, ${drag.y * 0.2}px) rotate(${rotate}deg)`,
                                    transition: drag.active
                                        ? 'none'
                                        : `transform ${SWIPE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                                }}
                                onPointerDown={onPointerDown}
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerUp}
                                onPointerCancel={onPointerUp}
                            >
                                <div className="relative aspect-square bg-paper-2">
                                    {cardArt(current) ? (
                                        <img
                                            src={cardArt(current) ?? ''}
                                            alt=""
                                            className="h-full w-full object-cover object-center"
                                            draggable={false}
                                        />
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-muted">
                                            <Heart className="h-12 w-12" />
                                        </div>
                                    )}

                                    <div
                                        className="pointer-events-none absolute inset-0 bg-success/35"
                                        style={{ opacity: likeHint * 0.85 }}
                                    />
                                    <div
                                        className="pointer-events-none absolute inset-0 bg-danger/35"
                                        style={{ opacity: dislikeHint * 0.85 }}
                                    />

                                    <span
                                        className="pointer-events-none absolute left-3 top-3 rotate-[-12deg] rounded-lg border-2 border-success px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-success shadow-sm backdrop-blur-sm sm:left-4 sm:top-4 sm:px-3 sm:py-1 sm:text-xs"
                                        style={{ opacity: likeHint }}
                                    >
                                        {t('discover.like')}
                                    </span>
                                    <span
                                        className="pointer-events-none absolute right-3 top-3 rotate-[12deg] rounded-lg border-2 border-danger px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-danger shadow-sm backdrop-blur-sm sm:right-4 sm:top-4 sm:px-3 sm:py-1 sm:text-xs"
                                        style={{ opacity: dislikeHint }}
                                    >
                                        {t('discover.skip')}
                                    </span>

                                    {canPlay && (
                                        <div
                                            className={cn(
                                                'absolute inset-0 flex items-center justify-center transition-opacity',
                                                drag.active && 'pointer-events-none opacity-0',
                                            )}
                                        >
                                            <AppTooltip label={isPlayingHere ? t('common.pause') : isCurrent ? t('common.resume') : t('common.play')}>
                                                <Button
                                                    type="button"
                                                    variant="accent"
                                                    size="icon"
                                                    className="h-14 w-14 rounded-full shadow-lg sm:h-16 sm:w-16"
                                                    onClick={() => void onPlay()}
                                                    aria-label={isPlayingHere ? t('common.pause') : isCurrent ? t('common.resume') : t('common.play')}
                                                >
                                                    {isPlayingHere ? (
                                                        <Pause className="h-6 w-6 sm:h-7 sm:w-7" />
                                                    ) : (
                                                        <Play className="h-6 w-6 translate-x-px sm:h-7 sm:w-7" />
                                                    )}
                                                </Button>
                                            </AppTooltip>
                                        </div>
                                    )}
                                </div>

                                    <div className="flex items-start justify-between gap-3 border-t border-line bg-paper px-4 py-2.5">
                                    <div className="min-w-0">
                                        <h2 className="truncate font-display text-lg font-semibold leading-tight tracking-tight sm:text-xl">
                                            {cardTitle(current)}
                                        </h2>
                                        <p className="mt-0.5 truncate text-sm text-muted">
                                            {current.song ? (
                                                <ArtistLinks artists={current.song.artists} artist={current.song.artist} />
                                            ) : (
                                                cardArtist(current)
                                            )}
                                        </p>
                                        {current.song && songProviderLinks(current.song).length > 1 && (
                                            <div
                                                className="mt-2"
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => event.stopPropagation()}
                                            >
                                                <SongProviderBadges
                                                    song={current.song}
                                                    className="justify-start"
                                                    playTrackOptions={{ radio: false }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    {current.source === 'spotify' && (
                                        <Badge className="mt-0.5 shrink-0 border-accent/20 bg-accent/10 text-accent">
                                            {t('common.spotify')}
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="relative z-10 flex shrink-0 items-center justify-center gap-4 py-2 sm:gap-5">
                        <AppTooltip label={t('discover.skipHint')}>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-14 w-14 rounded-full border-line bg-paper text-muted shadow-sm hover:border-danger/40 hover:text-danger sm:h-16 sm:w-16"
                                disabled={busy}
                                onClick={() => void swipe('dislike')}
                                aria-label={t('discover.skip')}
                            >
                                <X className="h-6 w-6 sm:h-7 sm:w-7" />
                            </Button>
                        </AppTooltip>
                        {canPlay && (
                            <AppTooltip label={isPlayingHere ? t('common.pause') : isCurrent ? t('common.resume') : t('common.play')}>
                                <Button
                                    type="button"
                                    variant={isPlayingHere ? 'accent' : 'outline'}
                                    size="icon"
                                    className="h-12 w-12 rounded-full shadow-sm sm:h-14 sm:w-14"
                                    onClick={() => void onPlay()}
                                    aria-label={isPlayingHere ? t('common.pause') : isCurrent ? t('common.resume') : t('common.play')}
                                >
                                    {isPlayingHere ? (
                                        <Pause className="h-5 w-5 sm:h-6 sm:w-6" />
                                    ) : (
                                        <Play className="h-5 w-5 translate-x-px sm:h-6 sm:w-6" />
                                    )}
                                </Button>
                            </AppTooltip>
                        )}
                        <AppTooltip label={t('discover.likeHint')}>
                            <Button
                                type="button"
                                variant="accent"
                                size="icon"
                                className="h-14 w-14 rounded-full shadow-md sm:h-16 sm:w-16"
                                disabled={busy}
                                onClick={() => void swipe('like')}
                                aria-label={t('discover.like')}
                            >
                                <Heart className="h-6 w-6 fill-current sm:h-7 sm:w-7" />
                            </Button>
                        </AppTooltip>
                    </div>
                </div>
            )}
        </div>
    );
}
