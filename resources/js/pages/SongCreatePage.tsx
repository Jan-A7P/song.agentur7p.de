import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '@/lib/api';
import { SongForm, type SongFormValues } from '@/components/SongForm';
import { useI18n } from '@/context/locale-context';
import { invalidateSongListCache } from '@/lib/song-list-cache';
import type { Song } from '@/types';

export function SongCreatePage() {
    const navigate = useNavigate();
    const { t } = useI18n();

    const onSubmit = async (values: SongFormValues) => {
        try {
            const { data } = await api.post<{ data: Song }>('/songs', values);
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

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div>
                <h1 className="font-display text-3xl font-semibold">{t('songs.addTitle')}</h1>
                <p className="mt-1 text-sm text-muted">{t('songs.addSubtitle')}</p>
            </div>
            <SongForm submitLabel={t('common.save')} onSubmit={onSubmit} />
        </div>
    );
}
