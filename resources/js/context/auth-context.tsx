import * as React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { ensureCsrfCookie } from '@/lib/api';
import type { User } from '@/types';

type AuthContextValue = {
    user: User | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (name: string, email: string, password: string, passwordConfirmation: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    setUser: React.Dispatch<React.SetStateAction<User | null>>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshUser = useCallback(async () => {
        try {
            const { data } = await api.get<{ user: User }>('/user');
            setUser(data.user);
        } catch {
            setUser(null);
        }
    }, []);

    useEffect(() => {
        (async () => {
            try {
                await ensureCsrfCookie();
                await refreshUser();
            } finally {
                setLoading(false);
            }
        })();
    }, [refreshUser]);

    const login = useCallback(async (email: string, password: string) => {
        await ensureCsrfCookie();
        const { data } = await api.post<{ user: User }>('/login', { email, password });
        setUser(data.user);
    }, []);

    const register = useCallback(
        async (name: string, email: string, password: string, passwordConfirmation: string) => {
            await ensureCsrfCookie();
            const { data } = await api.post<{ user: User }>('/register', {
                name,
                email,
                password,
                password_confirmation: passwordConfirmation,
            });
            setUser(data.user);
        },
        [],
    );

    const logout = useCallback(async () => {
        await api.post('/logout');
        setUser(null);
    }, []);

    const value = useMemo(
        () => ({ user, loading, login, register, logout, refreshUser, setUser }),
        [user, loading, login, register, logout, refreshUser],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return ctx;
}
