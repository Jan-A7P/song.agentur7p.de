import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DoorOpen, Plus, Radio } from 'lucide-react';
import api from '@/lib/api';
import type { ListeningRoom } from '@/types';
import { useRoom } from '@/context/room-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';

export function RoomsIndexPage() {
    const navigate = useNavigate();
    const { join, error: roomError } = useRoom();
    const [rooms, setRooms] = useState<ListeningRoom[]>([]);
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [joining, setJoining] = useState(false);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const { data } = await api.get<{ data: ListeningRoom[] }>('/rooms');
                setRooms(data.data);
            } catch {
                setError('Hörräume konnten nicht geladen werden.');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const onJoin = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!code.trim()) {
            return;
        }
        setJoining(true);
        setError(null);
        try {
            const room = await join(code.trim());
            navigate(`/rooms/${room.code}`);
        } catch {
            setError(roomError ?? 'Beitritt fehlgeschlagen.');
        } finally {
            setJoining(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-4xl font-semibold tracking-tight">Hörräume</h1>
                    <p className="mt-2 max-w-xl text-muted">
                        Gemeinsam hören wie bei Spotify Jam — Host steuert, alle spielen synchron mit.
                    </p>
                </div>
                <Button asChild variant="accent">
                    <Link to="/rooms/create">
                        <Plus className="h-4 w-4" />
                        Raum erstellen
                    </Link>
                </Button>
            </div>

            {(error || roomError) && <Alert variant="error">{error || roomError}</Alert>}

            <form onSubmit={onJoin} className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4">
                <div className="min-w-[12rem] flex-1 space-y-2">
                    <label className="text-sm font-medium" htmlFor="room-code">
                        Mit Code beitreten
                    </label>
                    <Input
                        id="room-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        placeholder="ABC123"
                        maxLength={12}
                        className="font-mono tracking-widest"
                    />
                </div>
                <Button type="submit" disabled={joining || !code.trim()}>
                    <DoorOpen className="h-4 w-4" />
                    {joining ? 'Beitreten…' : 'Beitreten'}
                </Button>
            </form>

            <div>
                <h2 className="mb-3 text-sm font-medium text-muted">Deine offenen Räume</h2>
                {loading ? (
                    <p className="text-muted">Laden…</p>
                ) : rooms.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                        <Radio className="mx-auto mb-3 h-8 w-8 text-muted" />
                        <p className="text-muted">Noch kein aktiver Hörraum.</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-line border-y border-line">
                        {rooms.map((room) => (
                            <li key={room.id}>
                                <Link
                                    to={`/rooms/${room.code}`}
                                    className="group -mx-3 flex items-center gap-4 rounded-lg px-3 py-4 transition hover:bg-surface"
                                    onClick={() => void join(room.code)}
                                >
                                    <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-paper-2 text-muted">
                                        <Radio className="h-5 w-5" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium">{room.name}</p>
                                        <p className="truncate text-sm text-muted">
                                            Code {room.code}
                                            {room.host ? ` · ${room.host.name}` : ''}
                                            {typeof room.members_count === 'number' ? ` · ${room.members_count} Personen` : ''}
                                        </p>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
