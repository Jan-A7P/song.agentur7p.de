import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useI18n } from '@/context/locale-context';
import { AuthShell } from '@/components/AuthShell';
import { SocialLoginButtons, authErrorMessage } from '@/components/SocialLoginButtons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { AppTooltip } from '@/components/ui/tooltip';

export function RegisterPage() {
    const { register } = useAuth();
    const { t } = useI18n();
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [authCode, setAuthCode] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('auth');
        if (authErrorMessage(code)) {
            setAuthCode(code);
            window.history.replaceState({}, '', '/register');
        }
    }, [t]);

    const onSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        setAuthCode(null);
        try {
            await register(name, email, password, passwordConfirmation);
            navigate('/');
        } catch (err) {
            if (axios.isAxiosError(err)) {
                const errors = err.response?.data?.errors as Record<string, string[]> | undefined;
                const first = errors ? Object.values(errors)[0]?.[0] : undefined;
                setError(first ?? err.response?.data?.message ?? t('auth.registerFailed'));
            } else {
                setError(t('auth.registerFailed'));
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AuthShell
            title={t('auth.createAccount')}
            subtitle={
                <>
                    {t('auth.alreadyRegistered')}{' '}
                    <Link className="font-medium text-accent underline-offset-4 hover:underline" to="/login">
                        {t('auth.toLogin')}
                    </Link>
                </>
            }
        >
            {(error ?? authErrorMessage(authCode)) && (
                <Alert variant="error">{error ?? authErrorMessage(authCode)}</Alert>
            )}

            <SocialLoginButtons />

            <form onSubmit={onSubmit} className="space-y-5">
                <div className="space-y-2">
                    <Label htmlFor="name">{t('auth.name')}</Label>
                    <Input
                        id="name"
                        autoComplete="name"
                        required
                        placeholder={t('auth.namePlaceholder')}
                        className="h-11"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">{t('auth.email')}</Label>
                    <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        required
                        placeholder={t('auth.emailPlaceholder')}
                        className="h-11"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="password">{t('auth.password')}</Label>
                    <div className="relative">
                        <Input
                            id="password"
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            required
                            placeholder={t('auth.passwordMin')}
                            className="h-11 pr-11"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        <AppTooltip label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}>
                            <button
                                type="button"
                                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted transition hover:text-ink"
                                onClick={() => setShowPassword((v) => !v)}
                                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                            >
                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </AppTooltip>
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="password_confirmation">{t('auth.confirmPassword')}</Label>
                    <Input
                        id="password_confirmation"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        placeholder={t('auth.repeatPassword')}
                        className="h-11"
                        value={passwordConfirmation}
                        onChange={(e) => setPasswordConfirmation(e.target.value)}
                    />
                </div>
                <Button type="submit" variant="accent" size="lg" className="mt-1 w-full" disabled={submitting}>
                    {submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
                </Button>
            </form>
        </AuthShell>
    );
}
