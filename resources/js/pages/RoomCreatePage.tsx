import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRoom } from '@/context/room-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export function RoomCreatePage() {
    const navigate = useNavigate();
    const { create, loading, error } = useRoom();
    const [name, setName] = useState('');

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const room = await create(name.trim() || 'Hörraum');
        navigate(`/rooms/${room.code}`);
    };

    return (
        <div className="mx-auto max-w-lg space-y-6">
            <div>
                <p className="text-sm text-muted">
                    <Link to="/rooms" className="hover:text-accent">
                        ← Hörräume
                    </Link>
                </p>
                <h1 className="font-display text-3xl font-semibold tracking-tight">Hörraum erstellen</h1>
                <p className="mt-2 text-muted">Andere treten per Code oder Link bei. Du steuerst die Musik.</p>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
                <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Freitagabend Jam"
                        required
                        maxLength={120}
                    />
                </div>
                <Button type="submit" variant="accent" disabled={loading}>
                    {loading ? 'Erstellen…' : 'Raum starten'}
                </Button>
            </form>
        </div>
    );
}
