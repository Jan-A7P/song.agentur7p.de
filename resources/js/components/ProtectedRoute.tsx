import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';

export function ProtectedRoute() {
    const { user, loading } = useAuth();

    if (loading) {
        return <p className="text-muted">Laden…</p>;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return <Outlet />;
}
