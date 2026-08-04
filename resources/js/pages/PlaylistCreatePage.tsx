import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '@/lib/api';
import type { Playlist } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export function PlaylistCreatePage() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const onSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const { data } = await api.post<{ data: Playlist }>('/playlists', {
                name,
                description: description || null,
            });
            navigate(`/playlists/${data.data.id}`);
        } catch (err) {
            if (axios.isAxiosError(err)) {
                const errors = err.response?.data?.errors as Record<string, string[]> | undefined;
                const first = errors ? Object.values(errors)[0]?.[0] : undefined;
                setError(first ?? err.response?.data?.message ?? 'Speichern fehlgeschlagen.');
            } else {
                setError('Speichern fehlgeschlagen.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="mx-auto max-w-xl space-y-6">
            <div>
                <p className="text-sm text-muted">
                    <Link to="/playlists" className="hover:text-accent">
                        ← Playlists
                    </Link>
                </p>
                <h1 className="font-display text-3xl font-semibold">Neue Playlist</h1>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="description">Beschreibung (optional)</Label>
                    <Textarea
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="min-h-[100px]"
                    />
                </div>
                <Button type="submit" variant="accent" disabled={submitting}>
                    {submitting ? 'Speichern…' : 'Erstellen'}
                </Button>
            </form>
        </div>
    );
}
