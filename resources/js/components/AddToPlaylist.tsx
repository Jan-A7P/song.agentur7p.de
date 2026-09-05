import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ListMusic, ListPlus, Loader2, Search } from 'lucide-react';
import api from '@/lib/api';
import type { Paginated, Playlist } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { DialogListSkeleton } from '@/components/skeletons';
import { cn } from '@/lib/utils';
import { AppTooltip } from '@/components/ui/tooltip';
import { useI18n } from '@/context/locale-context';

type Props = {
    songId: string;
    songTitle?: string;
    songArtist?: string;
};

export function AddToPlaylist({ songId, songTitle, songArtist }: Props) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(false);
    const [query, setQuery] = useState('');
    const [addingId, setAddingId] = useState<number | null>(null);
    const [addedIds, setAddedIds] = useState<Set<number>>(() => new Set());
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        setQuery('');
        setError(null);
        setAddedIds(new Set());

        let cancelled = false;
        void (async () => {
            setLoading(true);
            try {
                const { data } = await api.get<Paginated<Playlist>>('/playlists', {
                    params: { mine: 1 },
                });
                if (!cancelled) {
                    setPlaylists(data.data);
                }
            } catch {
                if (!cancelled) {
                    setError(t('playlists.loadFailed'));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return playlists;
        }
        return playlists.filter((p) => p.name.toLowerCase().includes(q));
    }, [playlists, query]);

    const add = async (playlist: Playlist) => {
        if (addingId !== null || addedIds.has(playlist.id)) {
            return;
        }

        setAddingId(playlist.id);
        setError(null);
        try {
            await api.post(`/playlists/${playlist.id}/songs`, { song_id: songId });
            setAddedIds((prev) => new Set(prev).add(playlist.id));
            setPlaylists((prev) =>
                prev.map((p) =>
                    p.id === playlist.id
                        ? { ...p, songs_count: (p.songs_count ?? 0) + 1 }
                        : p,
                ),
            );
        } catch {
            setError(t('addToPlaylist.addFailed', { name: playlist.name }));
        } finally {
            setAddingId(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <AppTooltip label={t('addToPlaylist.title')}>
                <DialogTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t('addToPlaylist.title')}
                    >
                        <ListPlus className="h-4 w-4" />
                    </Button>
                </DialogTrigger>
            </AppTooltip>

            <DialogContent aria-describedby={undefined}>
                <DialogHeader>
                    <DialogTitle>{t('addToPlaylist.title')}</DialogTitle>
                    <DialogDescription>
                        {songTitle ? (
                            <>
                                <span className="font-medium text-ink">{songTitle}</span>
                                {songArtist ? <span> · {songArtist}</span> : null}
                            </>
                        ) : (
                            t('addToPlaylist.choose')
                        )}
                    </DialogDescription>
                </DialogHeader>

                <DialogBody className="space-y-3">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                        <Input
                            className="pl-9"
                            placeholder={t('addToPlaylist.filter')}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>

                    {loading ? (
                        <DialogListSkeleton />
                    ) : filtered.length === 0 ? (
                        <div className="space-y-2 py-8 text-center">
                            <ListMusic className="mx-auto h-8 w-8 text-muted/70" />
                            <p className="text-sm text-muted">
                                {playlists.length === 0
                                    ? t('addToPlaylist.none')
                                    : t('addToPlaylist.noMatch')}
                            </p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                            {filtered.map((playlist) => {
                                const added = addedIds.has(playlist.id);
                                const busy = addingId === playlist.id;

                                return (
                                    <li key={playlist.id}>
                                        <button
                                            type="button"
                                            disabled={busy || added}
                                            onClick={() => void add(playlist)}
                                            className={cn(
                                                'flex w-full items-center gap-3 px-3 py-3 text-left transition',
                                                added
                                                    ? 'bg-accent/8'
                                                    : 'hover:bg-paper-2 disabled:opacity-60',
                                            )}
                                        >
                                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper-2">
                                                {added ? (
                                                    <Check className="h-4 w-4 text-accent" />
                                                ) : busy ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-muted" />
                                                ) : (
                                                    <ListMusic className="h-4 w-4 text-muted" />
                                                )}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-medium">
                                                    {playlist.name}
                                                </span>
                                                <span className="block text-xs text-muted">
                                                    {t('common.songCount', { count: playlist.songs_count ?? 0 })}
                                                    {added ? t('addToPlaylist.added') : ''}
                                                </span>
                                            </span>
                                            {!added && !busy && (
                                                <span className="text-xs font-medium text-accent">
                                                    {t('common.add')}
                                                </span>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {error && <p className="text-sm text-danger">{error}</p>}
                </DialogBody>

                <DialogFooter className="flex items-center justify-between gap-3">
                    <Link
                        to="/playlists/create"
                        className="text-sm text-muted underline-offset-2 hover:text-accent hover:underline"
                        onClick={() => setOpen(false)}
                    >
                        {t('addToPlaylist.createNew')}
                    </Link>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                        {t('common.done')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
