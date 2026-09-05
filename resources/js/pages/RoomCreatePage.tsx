import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '@/context/locale-context';
import { useRoom } from '@/context/room-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export function RoomCreatePage() {
    const navigate = useNavigate();
    const { t } = useI18n();
    const { create, loading, error } = useRoom();
    const [name, setName] = useState('');

    const onSubmit = async (event: FormEvent) => {
        event.preventDefault();
        const room = await create(name.trim() || t('rooms.defaultName'));
        navigate(`/rooms/${room.code}`);
    };

    return (
        <div className="mx-auto max-w-lg space-y-6">
            <div>
                <p className="text-sm text-muted">
                    <Link to="/rooms" className="hover:text-accent">
                        {t('rooms.back')}
                    </Link>
                </p>
                <h1 className="font-display text-3xl font-semibold tracking-tight">{t('rooms.createTitle')}</h1>
                <p className="mt-2 text-muted">{t('rooms.createSubtitle')}</p>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
                <div className="space-y-2">
                    <Label htmlFor="name">{t('rooms.name')}</Label>
                    <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('rooms.namePlaceholder')}
                        required
                        maxLength={120}
                    />
                </div>
                <Button type="submit" variant="accent" disabled={loading}>
                    {loading ? t('rooms.creating') : t('rooms.start')}
                </Button>
            </form>
        </div>
    );
}
