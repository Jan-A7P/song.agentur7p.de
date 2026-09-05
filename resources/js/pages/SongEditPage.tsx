import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '@/lib/api';
import { SongForm, type SongFormValues } from '@/components/SongForm';
import { SongFormSkeleton } from '@/components/skeletons';
import { useI18n } from '@/context/locale-context';
import type { Song } from '@/types';
import { Alert } from '@/components/ui/alert';
import { invalidateSongListCache } from '@/lib/song-list-cache';

export function SongEditPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { t } = useI18n();
    const [song, setSong] = useState<Song | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get<{ data: Song }>(`/songs/${id}`, { skipErrorToast: true });
                setSong(data.data);
            } catch {
                setError(t('songs.notFound'));
            }
        })();
    }, [id]);

    const onSubmit = async (values: SongFormValues) => {
        try {
            const { data } = await api.put<{ data: Song }>(`/songs/${id}`, values);
            invalidateSongListCache();
            navigate(`/songs/${data.data.id}`);
        } catch (err) {
            if (axios.isAxiosError(err)) {
                const errors = err.response?.data?.errors as Record<string, string[]> | undefined;
                const first = errors ? Object.values(errors)[0]?.[0] : undefined;
                throw new Error(first ?? err.response?.data?.message ?? t('songs.saveFailed'));
            }
            throw err;
        }
    };

    if (error) {
        return (
            <div className="space-y-4">
                <Alert variant="error">{error}</Alert>
                <p>
                    <Link to="/" className="text-sm text-accent underline-offset-4 hover:underline">
                        {t('songs.toList')}
                    </Link>
                </p>
            </div>
        );
    }

    if (!song) {
        return <SongFormSkeleton />;
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div>
                <p className="text-sm text-muted">
                    <Link to={`/songs/${song.id}`} className="hover:text-accent">
                        ← {t('common.back')}
                    </Link>
                </p>
                <h1 className="font-display text-3xl font-semibold">{t('songs.editTitle')}</h1>
            </div>
            <SongForm initial={song} submitLabel={t('songs.update')} onSubmit={onSubmit} />
        </div>
    );
}
