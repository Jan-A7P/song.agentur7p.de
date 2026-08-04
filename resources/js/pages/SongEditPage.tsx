import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import api from '@/lib/api';
import { SongForm, type SongFormValues } from '@/components/SongForm';
import type { Song } from '@/types';
import { Alert } from '@/components/ui/alert';
import { useAuth } from '@/context/auth-context';

export function SongEditPage() {
    const { id } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [song, setSong] = useState<Song | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get<{ data: Song }>(`/songs/${id}`);
                if (user && data.data.user_id !== user.id) {
                    setError('Nicht berechtigt.');
                    return;
                }
                setSong(data.data);
            } catch {
                setError('Song nicht gefunden.');
            }
        })();
    }, [id, user]);

    const onSubmit = async (values: SongFormValues) => {
        try {
            const { data } = await api.put<{ data: Song }>(`/songs/${id}`, values);
            navigate(`/songs/${data.data.id}`);
        } catch (err) {
            if (axios.isAxiosError(err)) {
                const errors = err.response?.data?.errors as Record<string, string[]> | undefined;
                const first = errors ? Object.values(errors)[0]?.[0] : undefined;
                throw new Error(first ?? err.response?.data?.message ?? 'Speichern fehlgeschlagen.');
            }
            throw err;
        }
    };

    if (error) {
        return <Alert variant="error">{error}</Alert>;
    }

    if (!song) {
        return <p className="text-muted">Laden…</p>;
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div>
                <p className="text-sm text-muted">
                    <Link to={`/songs/${song.id}`} className="hover:text-accent">
                        ← Zurück
                    </Link>
                </p>
                <h1 className="font-display text-3xl font-semibold">Song bearbeiten</h1>
            </div>
            <SongForm initial={song} submitLabel="Aktualisieren" onSubmit={onSubmit} />
        </div>
    );
}
