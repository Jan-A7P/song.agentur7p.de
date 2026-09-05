import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function SongListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
    return (
        <ul className={cn('divide-y divide-line border-y border-line', className)}>
            {Array.from({ length: rows }, (_, i) => (
                <li key={i}>
                    <div className="-mx-3 flex items-center gap-4 px-3 py-4">
                        <Skeleton className="h-14 w-14 shrink-0 rounded" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-48 max-w-full" />
                            <Skeleton className="h-3 w-32 max-w-full" />
                        </div>
                        <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                        <Skeleton className="hidden h-8 w-8 shrink-0 rounded-lg sm:block" />
                    </div>
                </li>
            ))}
        </ul>
    );
}

export function PlaylistListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
    return (
        <ul className={cn('divide-y divide-line border-y border-line', className)}>
            {Array.from({ length: rows }, (_, i) => (
                <li key={i}>
                    <div className="-mx-3 flex items-center gap-4 px-3 py-4">
                        <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-40 max-w-full" />
                            <Skeleton className="h-3 w-28 max-w-full" />
                        </div>
                        <Skeleton className="h-5 w-14 rounded-md" />
                    </div>
                </li>
            ))}
        </ul>
    );
}

export function ImportPlaylistListSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <ul className="divide-y divide-line border-y border-line">
            {Array.from({ length: rows }, (_, i) => (
                <li key={i} className="flex items-center gap-4 py-4">
                    <Skeleton className="h-14 w-14 shrink-0 rounded" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-44 max-w-full" />
                        <Skeleton className="h-3 w-32 max-w-full" />
                    </div>
                    <Skeleton className="hidden h-5 w-16 rounded-md sm:block" />
                    <Skeleton className="h-8 w-24 rounded-lg" />
                </li>
            ))}
        </ul>
    );
}

export function SongShowSkeleton() {
    return (
        <div className="space-y-8">
            <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 gap-4">
                    <Skeleton className="h-24 w-24 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-3 pt-1">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-8 w-72 max-w-full" />
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-5 w-28 rounded-full" />
                    </div>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <Skeleton className="h-10 w-10 rounded-lg" />
                </div>
            </div>
            <div className="space-y-3">
                <Skeleton className="mx-auto h-6 w-64 max-w-full" />
                <Skeleton className="mx-auto h-6 w-52 max-w-full" />
                <Skeleton className="mx-auto h-6 w-72 max-w-full" />
                <Skeleton className="mx-auto h-6 w-40 max-w-full" />
                <Skeleton className="mx-auto h-6 w-56 max-w-full" />
            </div>
            <div className="space-y-3 rounded-2xl border border-line p-4">
                <Skeleton className="h-5 w-32" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                </div>
            </div>
        </div>
    );
}

export function PlaylistShowSkeleton() {
    return (
        <div className="space-y-8">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-9 w-64 max-w-full" />
                    <Skeleton className="h-4 w-48 max-w-full" />
                    <Skeleton className="h-3 w-40" />
                </div>
                <div className="flex shrink-0 gap-2">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <Skeleton className="h-10 w-10 rounded-lg" />
                </div>
            </div>
            <SongListSkeleton rows={5} />
        </div>
    );
}

export function SongFormSkeleton() {
    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-56" />
            </div>
            <div className="space-y-5">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                </div>
                <div className="space-y-2">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                </div>
                <div className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-40 w-full rounded-lg" />
                </div>
                <Skeleton className="h-10 w-36 rounded-lg" />
            </div>
        </div>
    );
}

export function SettingsSkeleton() {
    return (
        <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
                <div
                    key={i}
                    className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3"
                >
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-64 max-w-full" />
                    </div>
                    <Skeleton className="h-6 w-11 rounded-full" />
                    <Skeleton className="h-9 w-24 rounded-lg" />
                </div>
            ))}
        </div>
    );
}

export function RoomListSkeleton({ rows = 4 }: { rows?: number }) {
    return (
        <ul className="space-y-3">
            {Array.from({ length: rows }, (_, i) => (
                <li key={i} className="rounded-2xl border border-line bg-surface px-4 py-4">
                    <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-4 w-36 max-w-full" />
                            <Skeleton className="h-3 w-24 max-w-full" />
                        </div>
                        <Skeleton className="h-8 w-20 rounded-lg" />
                    </div>
                </li>
            ))}
        </ul>
    );
}

export function DialogListSkeleton({ rows = 4 }: { rows?: number }) {
    return (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {Array.from({ length: rows }, (_, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-3">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-3.5 w-40 max-w-full" />
                        <Skeleton className="h-3 w-24 max-w-full" />
                    </div>
                </li>
            ))}
        </ul>
    );
}

export function PageLoadingSkeleton() {
    return (
        <div className="space-y-4 py-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <div className="space-y-3 pt-4">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
            </div>
        </div>
    );
}
