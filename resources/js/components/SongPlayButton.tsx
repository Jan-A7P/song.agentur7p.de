import { Check, ChevronDown, Pause, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { PlayerTrack } from '@/context/player-context';
import { useAuth } from '@/context/auth-context';
import { useI18n } from '@/context/locale-context';
import { usePlayer } from '@/context/player-context';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AppTooltip } from '@/components/ui/tooltip';
import { hasPlaybackConnected, isPlaybackProviderConnected, isProviderConnected, providerLabel } from '@/lib/music';
import {
    connectedSongProviders,
    rememberSongPlaybackProvider,
    songIsPlayable,
    songMatchesTrack,
    songProviderLinks,
    songToPlayerTrack,
    songToPlayerTrackForProvider,
} from '@/lib/playable';
import { cn } from '@/lib/utils';
import type { MusicProviderId } from '@/music/types';
import type { Song } from '@/types';

type PlayOptions = {
    radio?: boolean;
};

type SongPlaybackProps = {
    song: Song;
    playTrackOptions?: PlayOptions;
    onPlayTrack?: (track: PlayerTrack) => void | Promise<void>;
};

function useSongPlayback({ song, playTrackOptions, onPlayTrack }: SongPlaybackProps) {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { track, playing, playTrack, toggle } = usePlayer();
    const links = songProviderLinks(song);
    const connected = connectedSongProviders(song, user);
    const preferred = song.preferred_provider ?? song.provider;
    const isCurrent = songMatchesTrack(song, track);
    const isPlayingHere = isCurrent && playing;

    const playWith = async (provider?: MusicProviderId) => {
        if (!songIsPlayable(song)) {
            return;
        }

        if (!user) {
            navigate('/login');
            return;
        }

        if (!hasPlaybackConnected(user)) {
            navigate('/settings');
            return;
        }

        const next = provider
            ? songToPlayerTrackForProvider(song, provider, user)
            : songToPlayerTrack(song, user);
        if (!next) {
            navigate('/settings');
            return;
        }

        if (!provider && isCurrent) {
            await toggle();
            return;
        }

        if (provider && isCurrent && track?.provider === next.provider) {
            await toggle();
            return;
        }

        if (provider) {
            rememberSongPlaybackProvider(song.id, provider);
        }

        if (onPlayTrack) {
            await onPlayTrack(next);
            return;
        }

        await playTrack(next, playTrackOptions);
    };

    return {
        links,
        connected,
        preferred,
        isCurrent,
        isPlayingHere,
        currentProvider: isCurrent ? track?.provider ?? null : null,
        playWith,
    };
}

export function SongProviderBadges({
    song,
    className,
    playTrackOptions,
    onPlayTrack,
    showPreferredHint = false,
}: SongPlaybackProps & { className?: string; showPreferredHint?: boolean }) {
    const { t } = useI18n();
    const { user } = useAuth();
    const { links, preferred, currentProvider, isPlayingHere, playWith } = useSongPlayback({
        song,
        playTrackOptions,
        onPlayTrack,
    });

    if (links.length === 0) {
        return null;
    }

    return (
        <div className={cn('flex flex-wrap justify-end gap-1', className)}>
            {links.map((link) => {
                const playableHere =
                    isPlaybackProviderConnected(user, link.provider);
                const linked = isProviderConnected(user, link.provider);
                const active = currentProvider === link.provider;
                const isPreferred = link.provider === preferred;
                const label = !linked
                    ? t('player.providerNotConnected', { provider: providerLabel(link.provider) })
                    : !playableHere
                      ? t('player.catalogOnly', { provider: providerLabel(link.provider) })
                      : active && isPlayingHere
                        ? t('player.playingOn', { provider: providerLabel(link.provider) })
                        : t('player.playWith', { provider: providerLabel(link.provider) });

                if (!playableHere) {
                    return (
                        <AppTooltip key={link.provider} label={label}>
                            <span className="inline-flex">
                                <Badge className="opacity-60">{providerLabel(link.provider)}</Badge>
                            </span>
                        </AppTooltip>
                    );
                }

                return (
                    <AppTooltip key={link.provider} label={label}>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void playWith(link.provider);
                            }}
                            className={cn(
                                'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition',
                                active
                                    ? 'border-accent/30 bg-accent/15 text-accent'
                                    : isPreferred
                                      ? 'border-accent/20 bg-accent/10 text-accent hover:border-accent/40'
                                      : 'border-line bg-paper-2 text-muted hover:border-accent/30 hover:text-ink',
                            )}
                        >
                            {providerLabel(link.provider)}
                            {showPreferredHint && isPreferred ? t('songs.preferredSuffix') : ''}
                        </button>
                    </AppTooltip>
                );
            })}
        </div>
    );
}

export function SongPlayButton({
    song,
    playTrackOptions,
    onPlayTrack,
    className,
}: SongPlaybackProps & { className?: string }) {
    const { t } = useI18n();
    const { user } = useAuth();
    const { links, connected, preferred, isCurrent, isPlayingHere, currentProvider, playWith } =
        useSongPlayback({ song, playTrackOptions, onPlayTrack });

    if (!songIsPlayable(song)) {
        return null;
    }

    const playLabel = isPlayingHere ? t('common.pause') : isCurrent ? t('common.resume') : t('common.play');
    const showChooser = connected.length > 1;

    const playButton = (
        <AppTooltip label={playLabel}>
            <Button
                type="button"
                variant="accent"
                size="icon"
                className={cn(showChooser && 'rounded-r-none', className)}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void playWith();
                }}
                aria-label={playLabel}
            >
                {isPlayingHere ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
        </AppTooltip>
    );

    if (!showChooser) {
        return playButton;
    }

    return (
        <div className="inline-flex shrink-0">
            {playButton}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        aria-label={t('player.chooseProvider')}
                        title={t('player.chooseProvider')}
                        onClick={(event) => event.stopPropagation()}
                        className={cn(
                            buttonVariants({ variant: 'accent' }),
                            'h-10 w-8 rounded-l-none border-l border-white/25 px-0',
                        )}
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t('player.chooseProvider')}</DropdownMenuLabel>
                    {links.map((link) => {
                        const available = isPlaybackProviderConnected(user, link.provider);
                        const active = currentProvider === link.provider;
                        const isPreferred = link.provider === preferred;
                        return (
                            <DropdownMenuItem
                                key={link.provider}
                                disabled={!available}
                                onSelect={() => {
                                    if (!available) {
                                        return;
                                    }
                                    void playWith(link.provider);
                                }}
                            >
                                {active ? (
                                    <Check className="h-4 w-4 text-accent" />
                                ) : (
                                    <span className="h-4 w-4" />
                                )}
                                <span className="flex-1">
                                    {available
                                        ? t('player.playWith', { provider: providerLabel(link.provider) })
                                        : isProviderConnected(user, link.provider)
                                          ? t('player.catalogOnly', {
                                                provider: providerLabel(link.provider),
                                            })
                                          : t('player.providerNotConnected', {
                                                provider: providerLabel(link.provider),
                                            })}
                                    {isPreferred ? t('songs.preferredSuffix') : ''}
                                </span>
                            </DropdownMenuItem>
                        );
                    })}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
