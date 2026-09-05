import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Camera, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { useI18n } from '@/context/locale-context';
import { UserAvatar } from '@/components/UserAvatar';
import { Alert } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { User } from '@/types';

function axiosMessage(err: unknown, fallback: string): string {
    if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string; errors?: Record<string, string[]> } | undefined;
        const firstError = data?.errors ? Object.values(data.errors)[0]?.[0] : undefined;
        return firstError || data?.message || fallback;
    }
    if (err instanceof Error && err.message) {
        return err.message;
    }
    return fallback;
}

export function ProfilePage() {
    const { user, setUser } = useAuth();
    const { t } = useI18n();
    const navigate = useNavigate();
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [name, setName] = useState(user?.name ?? '');
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        if (user) {
            setName(user.name);
        }
    }, [user]);

    if (!user) {
        return null;
    }

    const onSave = async (e: FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const { data } = await api.patch<{ user: User }>('/profile', { name: name.trim() });
            setUser(data.user);
            setSuccess(t('profile.saved'));
        } catch (err) {
            setError(axiosMessage(err, t('profile.saveFailed')));
        } finally {
            setSaving(false);
        }
    };

    const onAvatarChange = async (file: File | null) => {
        if (!file) {
            return;
        }
        setUploading(true);
        setError(null);
        setSuccess(null);
        try {
            const body = new FormData();
            body.append('avatar', file);
            const { data } = await api.post<{ user: User }>('/profile/avatar', body, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setUser(data.user);
            setSuccess(t('profile.avatarUpdated'));
        } catch (err) {
            setError(axiosMessage(err, t('profile.avatarUploadFailed')));
        } finally {
            setUploading(false);
            if (fileRef.current) {
                fileRef.current.value = '';
            }
        }
    };

    const onRemoveAvatar = async () => {
        setUploading(true);
        setError(null);
        setSuccess(null);
        try {
            const { data } = await api.delete<{ user: User }>('/profile/avatar');
            setUser(data.user);
            setSuccess(
                data.user.avatar
                    ? t('profile.avatarRemovedSocial')
                    : t('profile.avatarRemoved'),
            );
        } catch (err) {
            setError(axiosMessage(err, t('profile.avatarRemoveFailed')));
        } finally {
            setUploading(false);
        }
    };

    const onDeleteAccount = async () => {
        setDeleting(true);
        setError(null);
        setSuccess(null);
        try {
            await api.delete('/profile');
            setUser(null);
            setDeleteOpen(false);
            navigate('/');
        } catch (err) {
            setError(axiosMessage(err, t('profile.deleteFailed')));
            setDeleteOpen(false);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="mx-auto max-w-lg space-y-8">
            <section className="space-y-2">
                <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t('profile.title')}</h1>
                <p className="text-sm text-muted sm:text-base">
                    {t('profile.subtitleBefore')}{' '}
                    <Link className="font-medium text-accent underline-offset-4 hover:underline" to="/settings">
                        {t('nav.settings')}
                    </Link>
                    .
                </p>
            </section>

            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <section className="space-y-4 rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                    <UserAvatar user={user} size="xl" />
                    <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
                        <div>
                            <p className="font-medium">{user.name}</p>
                            <p className="truncate text-sm text-muted">{user.email}</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                className="hidden"
                                onChange={(e) => void onAvatarChange(e.target.files?.[0] ?? null)}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={uploading || deleting}
                                onClick={() => fileRef.current?.click()}
                            >
                                <Camera className="h-4 w-4" />
                                {uploading ? t('profile.loading') : t('profile.changeImage')}
                            </Button>
                            {user.has_custom_avatar && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={uploading || deleting}
                                    onClick={() => void onRemoveAvatar()}
                                >
                                    <Trash2 className="h-4 w-4" />
                                    {t('profile.remove')}
                                </Button>
                            )}
                        </div>
                        <p className="text-xs text-muted">
                            {t('profile.avatarHint')}
                        </p>
                    </div>
                </div>
            </section>

            <form onSubmit={onSave} className="space-y-5">
                <div className="space-y-2">
                    <Label htmlFor="name">{t('profile.name')}</Label>
                    <Input
                        id="name"
                        required
                        maxLength={255}
                        className="h-11"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">{t('profile.email')}</Label>
                    <Input id="email" className="h-11" value={user.email} disabled readOnly />
                    <p className="text-xs text-muted">{t('profile.emailLocked')}</p>
                </div>
                <Button type="submit" variant="accent" size="lg" disabled={saving || deleting || !name.trim()}>
                    {saving ? t('common.saving') : t('common.save')}
                </Button>
            </form>

            <section className="space-y-3 rounded-2xl border border-danger/25 bg-danger-soft/40 p-5 sm:p-6">
                <div className="space-y-1">
                    <h2 className="font-medium text-danger">{t('profile.deleteHeading')}</h2>
                    <p className="text-sm text-muted">
                        {t('profile.deleteBody')}
                    </p>
                </div>
                <Button
                    type="button"
                    variant="destructive"
                    disabled={deleting}
                    onClick={() => setDeleteOpen(true)}
                >
                    {t('profile.deleteHeading')}
                </Button>
            </section>

            <AlertDialog open={deleteOpen} onOpenChange={(open) => !deleting && setDeleteOpen(open)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('profile.deleteConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('profile.deleteConfirmBody')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger text-paper hover:bg-danger/90"
                            disabled={deleting}
                            onClick={(e) => {
                                e.preventDefault();
                                void onDeleteAccount();
                            }}
                        >
                            {deleting ? t('profile.deleting') : t('profile.deleteForever')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
