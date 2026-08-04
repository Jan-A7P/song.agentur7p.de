import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';

export function RegisterPage() {
    const { register } = useAuth();
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const onSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            await register(name, email, password, passwordConfirmation);
            navigate('/');
        } catch (err) {
            if (axios.isAxiosError(err)) {
                const errors = err.response?.data?.errors as Record<string, string[]> | undefined;
                const first = errors ? Object.values(errors)[0]?.[0] : undefined;
                setError(first ?? err.response?.data?.message ?? 'Registrierung fehlgeschlagen.');
            } else {
                setError('Registrierung fehlgeschlagen.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="mx-auto max-w-md space-y-6">
            <div>
                <h1 className="font-display text-3xl font-semibold">Registrieren</h1>
                <p className="mt-1 text-sm text-muted">
                    Schon ein Konto? <Link className="text-accent underline-offset-2 hover:underline" to="/login">Login</Link>
                </p>
            </div>

            {error && <Alert variant="error">{error}</Alert>}

            <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">E-Mail</Label>
                    <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="password">Passwort</Label>
                    <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="password_confirmation">Passwort bestätigen</Label>
                    <Input
                        id="password_confirmation"
                        type="password"
                        required
                        value={passwordConfirmation}
                        onChange={(e) => setPasswordConfirmation(e.target.value)}
                    />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? '…' : 'Konto erstellen'}
                </Button>
            </form>
        </div>
    );
}
