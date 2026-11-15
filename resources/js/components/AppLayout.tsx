import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Compass, ListMusic, Languages, LogOut, Music2, Plus, Radio, Settings, UserRound, Check } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useI18n } from '@/context/locale-context';
import { usePlayer } from '@/context/player-context';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PartyToggle } from '@/components/PartyToggle';
import { CarmineToggle } from '@/components/CarmineToggle';
import { PartyLights } from '@/components/PartyLights';
import { CarmineFire } from '@/components/CarmineFire';
import { PersistentPlayerBar } from '@/components/PersistentPlayerBar';
import { GlobalSearch } from '@/components/GlobalSearch';
import { HeaderSearch } from '@/components/HeaderSearch';
import { UserAvatar } from '@/components/UserAvatar';
import { hasPlaybackConnected } from '@/lib/music';
import { cn } from '@/lib/utils';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
        'rounded-full px-3.5 py-1.5 text-sm transition',
        isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-paper-2 hover:text-ink',
    );

export function AppLayout() {
    const { user, loading, logout } = useAuth();
    const { t, locale, setLocale } = useI18n();
    const { track } = usePlayer();
    const { pathname } = useLocation();
    const isAuthPage = pathname === '/login' || pathname === '/register';
    const isDiscoverPage = pathname === '/discover';
    const playerVisible = Boolean(hasPlaybackConnected(user) && track) && !isAuthPage;
    const [commandOpen, setCommandOpen] = useState(false);

    useEffect(() => {
        if (isAuthPage) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setCommandOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isAuthPage]);

    return (
        <>
            <PartyLights />
            <CarmineFire />
            <div
                className={cn(
                    'relative z-10 flex w-full flex-col',
                    isDiscoverPage ? 'h-dvh overflow-hidden' : 'min-h-screen',
                    playerVisible ? 'pb-[calc(var(--player-bar-height,10rem)+1.5rem)]' : isAuthPage ? 'pb-0' : 'pb-12',
                )}
            >
            <header
                className={cn(
                    'sticky top-0 z-40 w-full border-b border-line/70 bg-paper/80 backdrop-blur-xl',
                    isAuthPage && 'lg:border-line/40',
                )}
            >
                <div
                    className={cn(
                        'grid h-16 w-full items-center gap-2 px-4 sm:gap-4 sm:px-6',
                        isAuthPage
                            ? 'grid-cols-[1fr_auto]'
                            : 'grid-cols-[auto_minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_minmax(14rem,28rem)_minmax(0,1fr)]',
                    )}
                >
                    <div className="flex min-w-0 items-center gap-3 sm:gap-5">
                        <Link to="/" className="group flex shrink-0 items-center gap-2.5">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-paper transition group-hover:bg-accent group-hover:text-white">
                                <Music2 className="h-4 w-4" />
                            </span>
                            <span className="hidden font-display text-xl font-semibold tracking-tight sm:inline">
                                {t('brand')}
                            </span>
                        </Link>

                        {!isAuthPage && (
                            <nav className="hidden items-center gap-1 xl:flex">
                                <NavLink to="/" end className={navLinkClass}>
                                    {t('nav.songs')}
                                </NavLink>
                                <NavLink to="/playlists" className={navLinkClass}>
                                    {t('nav.playlists')}
                                </NavLink>
                                {user && (
                                    <NavLink to="/discover" className={navLinkClass}>
                                        {t('nav.discover')}
                                    </NavLink>
                                )}
                                {user && (
                                    <NavLink to="/rooms" className={navLinkClass}>
                                        {t('nav.rooms')}
                                    </NavLink>
                                )}
                            </nav>
                        )}
                    </div>

                    {!isAuthPage && <HeaderSearch onOpenCommand={() => setCommandOpen(true)} />}

                    <div className="flex items-center justify-end gap-1.5 sm:gap-2">
                        <PartyToggle />
                        <CarmineToggle />
                        <ThemeToggle />

                        {!loading && user && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="gap-2 rounded-full"
                                    >
                                        <UserAvatar user={user} size="sm" className="h-7 w-7" />
                                        <span className="hidden max-w-[8rem] truncate sm:inline">{user.name}</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-52">
                                    <DropdownMenuItem asChild>
                                        <Link to="/profile">
                                            <UserRound className="h-4 w-4 text-muted" />
                                            {t('nav.profile')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="xl:hidden">
                                        <Link to="/songs/create">
                                            <Plus className="h-4 w-4 text-muted" />
                                            {t('nav.addSong')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="xl:hidden">
                                        <Link to="/">
                                            <Music2 className="h-4 w-4 text-muted" />
                                            {t('nav.songs')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="xl:hidden">
                                        <Link to="/discover">
                                            <Compass className="h-4 w-4 text-muted" />
                                            {t('nav.discover')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="xl:hidden">
                                        <Link to="/rooms">
                                            <Radio className="h-4 w-4 text-muted" />
                                            {t('nav.rooms')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="xl:hidden">
                                        <Link to="/playlists">
                                            <ListMusic className="h-4 w-4 text-muted" />
                                            {t('nav.playlists')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="hidden xl:flex">
                                        <Link to="/songs/create">
                                            <Plus className="h-4 w-4 text-muted" />
                                            {t('nav.addSong')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild>
                                        <Link to="/settings">
                                            <Settings className="h-4 w-4 text-muted" />
                                            {t('nav.settings')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuSub>
                                        <DropdownMenuSubTrigger>
                                            <Languages className="h-4 w-4 text-muted" />
                                            {t('language.label')}
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent>
                                            <DropdownMenuItem onSelect={() => setLocale('de')}>
                                                {t('language.de')}
                                                {locale === 'de' ? <Check className="ml-auto h-4 w-4" /> : null}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => setLocale('en')}>
                                                {t('language.en')}
                                                {locale === 'en' ? <Check className="ml-auto h-4 w-4" /> : null}
                                            </DropdownMenuItem>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onSelect={() => {
                                            void logout();
                                        }}
                                    >
                                        <LogOut className="h-4 w-4 text-muted" />
                                        {t('common.logout')}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}

                        {!loading && !user && !isAuthPage && (
                            <>
                                <Button asChild variant="ghost" size="sm" className="rounded-full">
                                    <Link to="/login">{t('common.login')}</Link>
                                </Button>
                                <Button asChild size="sm" className="rounded-full">
                                    <Link to="/register">{t('common.register')}</Link>
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main
                className={cn(
                    'w-full flex-1',
                    isAuthPage
                        ? 'max-w-none px-0 pt-0'
                        : isDiscoverPage
                          ? 'flex min-h-0 w-full max-w-none flex-col overflow-x-visible pt-3 pb-1'
                          : 'mx-auto max-w-5xl px-4 pt-8 sm:px-6',
                )}
            >
                <Outlet />
            </main>
            </div>
            {!isAuthPage && <PersistentPlayerBar />}
            {!isAuthPage && <GlobalSearch open={commandOpen} onOpenChange={setCommandOpen} />}
        </>
    );
}
