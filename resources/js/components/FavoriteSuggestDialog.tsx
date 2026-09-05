import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { emitFavoriteChange } from '@/lib/favorite-sync';
import { clearSongListCache } from '@/lib/song-list-cache';
import {
    markFavoriteSuggestDismissed,
    setFavoriteSuggestEnabled,
    subscribeFavoriteSuggest,
} from '@/lib/favorite-suggest';
import { useI18n } from '@/context/locale-context';
import type { Song } from '@/types';

export function FavoriteSuggestDialog() {
    const { user } = useAuth();
    const { t } = useI18n();
    const [song, setSong] = useState<Song | null>(null);
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);

    useEffect(() => {
        if (!user) {
            return;
        }

        return subscribeFavoriteSuggest((songId) => {
            void (async () => {
                try {
                    const { data } = await api.get<{ data: Song }>(`/songs/${songId}`, {
                        skipErrorToast: true,
                    });
                    if (data.data.is_favorited) {
                        return;
                    }
                    setSong(data.data);
                    setOpen(true);
                } catch {
                    // ignore
                }
            })();
        });
    }, [user]);

    const close = (dismissSong = true) => {
        if (dismissSong && song) {
            markFavoriteSuggestDismissed(song.id);
        }
        setOpen(false);
        setSong(null);
    };

    const onFavorite = async () => {
        if (!song || pending) {
            return;
        }
        setPending(true);
        try {
            const { data } = await api.post<{ data: Song }>(`/songs/${song.id}/favorite`);
            emitFavoriteChange(song.id, true);
            clearSongListCache();
            markFavoriteSuggestDismissed(song.id);
            setOpen(false);
            setSong(data.data);
            window.setTimeout(() => setSong(null), 0);
        } catch {
            // keep dialog open
        } finally {
            setPending(false);
        }
    };

    const onOptOut = () => {
        setFavoriteSuggestEnabled(false);
        close(true);
    };

    if (!user) {
        return null;
    }

    return (
        <AlertDialog
            open={open && Boolean(song)}
            onOpenChange={(next) => {
                if (!next) {
                    close(true);
                }
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t('favorite.suggestTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {t('favorite.suggestBody', {
                            track: song
                                ? `${song.title}${song.artist ? ` · ${song.artist}` : ''}`
                                : '',
                        })}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:flex-col-reverse sm:items-stretch">
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <AlertDialogCancel disabled={pending} onClick={() => close(true)}>
                            {t('favorite.notNow')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={pending}
                            onClick={(e) => {
                                e.preventDefault();
                                void onFavorite();
                            }}
                            className="gap-1.5"
                        >
                            <Heart className="h-4 w-4 fill-current" />
                            {pending ? t('common.saving') : t('favorite.save')}
                        </AlertDialogAction>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted"
                        disabled={pending}
                        onClick={onOptOut}
                    >
                        {t('favorite.dontSuggest')}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
