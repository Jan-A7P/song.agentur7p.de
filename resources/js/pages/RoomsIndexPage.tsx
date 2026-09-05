import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DoorOpen, Plus, Radio } from 'lucide-react';
import api from '@/lib/api';
import type { ListeningRoom } from '@/types';
import { useI18n } from '@/context/locale-context';
import { useRoom } from '@/context/room-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { RoomListSkeleton } from '@/components/skeletons';

export function RoomsIndexPage() {
    const navigate = useNavigate();
    const { t } = useI18n();
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
                setError(t('rooms.loadFailed'));
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
            setError(roomError ?? t('rooms.joinFailed'));
        } finally {
            setJoining(false);
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-4xl font-semibold tracking-tight">{t('rooms.title')}</h1>
                    <p className="mt-2 max-w-xl text-muted">{t('rooms.subtitle')}</p>
                </div>
                <Button asChild variant="accent">
                    <Link to="/rooms/create">
                        <Plus className="h-4 w-4" />
                        {t('rooms.createRoom')}
                    </Link>
                </Button>
            </div>

            {(error || roomError) && <Alert variant="error">{error || roomError}</Alert>}

            <form onSubmit={onJoin} className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-4">
                <div className="min-w-[12rem] flex-1 space-y-2">
                    <label className="text-sm font-medium" htmlFor="room-code">
                        {t('rooms.joinWithCode')}
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
                    {joining ? t('rooms.joining') : t('rooms.join')}
                </Button>
            </form>

            <div>
                <h2 className="mb-3 text-sm font-medium text-muted">{t('rooms.yourOpen')}</h2>
                {loading ? (
                    <RoomListSkeleton />
                ) : rooms.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                        <Radio className="mx-auto mb-3 h-8 w-8 text-muted" />
                        <p className="text-muted">{t('rooms.noneOpen')}</p>
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
                                            {t('rooms.code', { code: room.code })}
                                            {room.host ? ` · ${room.host.name}` : ''}
                                            {typeof room.members_count === 'number'
                                                ? t('common.peopleCount', { count: room.members_count })
                                                : ''}
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
