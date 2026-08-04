import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { ListMusic, LogOut, Music2, Plus, Radio, Search, Settings, UserRound } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { usePlayer } from '@/context/player-context';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PersistentPlayerBar } from '@/components/PersistentPlayerBar';
import { GlobalSearch } from '@/components/GlobalSearch';
import { hasMusicConnected } from '@/lib/music';
import { cn } from '@/lib/utils';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
        'rounded-full px-3.5 py-1.5 text-sm transition',
        isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-paper-2 hover:text-ink',
    );

export function AppLayout() {
    const { user, loading, logout } = useAuth();
    const { track } = usePlayer();
    const playerVisible = Boolean(hasMusicConnected(user) && track);
    const [searchOpen, setSearchOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (!menuOpen) {
            return;
        }
        const onClick = () => setMenuOpen(false);
        window.addEventListener('click', onClick);
        return () => window.removeEventListener('click', onClick);
    }, [menuOpen]);

    return (
        <div
            className={cn(
                'flex min-h-screen w-full flex-col',
                playerVisible ? 'pb-[calc(var(--player-bar-height,10rem)+1.5rem)]' : 'pb-12',
            )}
        >
            <header className="sticky top-0 z-40 w-full border-b border-line/70 bg-paper/80 backdrop-blur-xl">
                <div className="grid h-16 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-4 sm:gap-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_minmax(14rem,28rem)_minmax(0,1fr)]">
                    <div className="flex min-w-0 items-center gap-3 sm:gap-5">
                        <Link to="/" className="group flex shrink-0 items-center gap-2.5">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-paper transition group-hover:bg-accent group-hover:text-white">
                                <Music2 className="h-4 w-4" />
                            </span>
                            <span className="hidden font-display text-xl font-semibold tracking-tight sm:inline">
                                Songtexte
                            </span>
                        </Link>

                        <nav className="hidden items-center gap-1 xl:flex">
                            <NavLink to="/" end className={navLinkClass}>
                                Songs
                            </NavLink>
                            <NavLink to="/playlists" className={navLinkClass}>
                                Playlists
                            </NavLink>
                            {user && (
                                <NavLink to="/rooms" className={navLinkClass}>
                                    Hörräume
                                </NavLink>
                            )}
                        </nav>
                    </div>

                    <div className="min-w-0 w-full xl:justify-self-center">
                        <button
                            type="button"
                            onClick={() => setSearchOpen(true)}
                            className="flex h-9 w-full max-w-md items-center gap-2 rounded-full border border-line bg-surface px-3 text-sm text-muted transition hover:border-ink/20 hover:text-ink sm:px-4 xl:mx-auto"
                            aria-label="Suche öffnen"
                        >
                            <Search className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">Suchen…</span>
                            <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] font-medium text-muted sm:inline">
                                Ctrl+K
                            </kbd>
                        </button>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 sm:gap-2">
                        <ThemeToggle />

                        {!loading && user && (
                            <div className="relative" onClick={(e) => e.stopPropagation()}>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="gap-2 rounded-full"
                                    onClick={() => setMenuOpen((v) => !v)}
                                    aria-expanded={menuOpen}
                                    aria-haspopup="menu"
                                >
                                    <UserRound className="h-4 w-4" />
                                    <span className="hidden max-w-[8rem] truncate sm:inline">{user.name}</span>
                                </Button>

                                {menuOpen && (
                                    <div
                                        role="menu"
                                        className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-lg"
                                    >
                                        <Link
                                            to="/songs/create"
                                            role="menuitem"
                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper-2 xl:hidden"
                                            onClick={() => setMenuOpen(false)}
                                        >
                                            <Plus className="h-4 w-4 text-muted" />
                                            Song hinzufügen
                                        </Link>
                                        <Link
                                            to="/"
                                            role="menuitem"
                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper-2 xl:hidden"
                                            onClick={() => setMenuOpen(false)}
                                        >
                                            <Music2 className="h-4 w-4 text-muted" />
                                            Songs
                                        </Link>
                                        <Link
                                            to="/rooms"
                                            role="menuitem"
                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper-2 xl:hidden"
                                            onClick={() => setMenuOpen(false)}
                                        >
                                            <Radio className="h-4 w-4 text-muted" />
                                            Hörräume
                                        </Link>
                                        <Link
                                            to="/playlists"
                                            role="menuitem"
                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper-2 xl:hidden"
                                            onClick={() => setMenuOpen(false)}
                                        >
                                            <ListMusic className="h-4 w-4 text-muted" />
                                            Playlists
                                        </Link>
                                        <Link
                                            to="/songs/create"
                                            role="menuitem"
                                            className="hidden items-center gap-2 px-3 py-2 text-sm hover:bg-paper-2 xl:flex"
                                            onClick={() => setMenuOpen(false)}
                                        >
                                            <Plus className="h-4 w-4 text-muted" />
                                            Song hinzufügen
                                        </Link>
                                        <Link
                                            to="/settings"
                                            role="menuitem"
                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper-2"
                                            onClick={() => setMenuOpen(false)}
                                        >
                                            <Settings className="h-4 w-4 text-muted" />
                                            Einstellungen
                                        </Link>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper-2"
                                            onClick={() => {
                                                setMenuOpen(false);
                                                void logout();
                                            }}
                                        >
                                            <LogOut className="h-4 w-4 text-muted" />
                                            Logout
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {!loading && !user && (
                            <>
                                <Button asChild variant="ghost" size="sm" className="rounded-full">
                                    <Link to="/login">Login</Link>
                                </Button>
                                <Button asChild size="sm" className="rounded-full">
                                    <Link to="/register">Registrieren</Link>
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-8 sm:px-6">
                <Outlet />
            </main>

            <PersistentPlayerBar />
            <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        </div>
    );
}
