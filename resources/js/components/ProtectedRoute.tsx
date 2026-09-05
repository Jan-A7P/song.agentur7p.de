import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { PageLoadingSkeleton } from '@/components/skeletons';

export function ProtectedRoute() {
    const { user, loading } = useAuth();

    if (loading) {
        return <PageLoadingSkeleton />;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return <Outlet />;
}
