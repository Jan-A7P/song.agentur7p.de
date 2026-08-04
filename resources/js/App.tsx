import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/auth-context';
import { PlayerProvider } from '@/context/player-context';
import { ThemeProvider } from '@/context/theme-context';
import { RoomProvider } from '@/context/room-context';
import { AppLayout } from '@/components/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { SongsIndexPage } from '@/pages/SongsIndexPage';
import { SongShowPage } from '@/pages/SongShowPage';
import { SongCreatePage } from '@/pages/SongCreatePage';
import { SongEditPage } from '@/pages/SongEditPage';
import { PlaylistsIndexPage } from '@/pages/PlaylistsIndexPage';
import { PlaylistCreatePage } from '@/pages/PlaylistCreatePage';
import { PlaylistImportPage } from '@/pages/PlaylistImportPage';
import { PlaylistShowPage } from '@/pages/PlaylistShowPage';
import { RoomsIndexPage } from '@/pages/RoomsIndexPage';
import { RoomCreatePage } from '@/pages/RoomCreatePage';
import { RoomShowPage } from '@/pages/RoomShowPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';

export default function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
                    <PlayerProvider>
                        <RoomProvider>
                            <Routes>
                                <Route element={<AppLayout />}>
                                    <Route index element={<SongsIndexPage />} />
                                    <Route path="songs/:id" element={<SongShowPage />} />
                                    <Route path="playlists" element={<PlaylistsIndexPage />} />
                                    <Route path="login" element={<LoginPage />} />
                                    <Route path="register" element={<RegisterPage />} />

                                    <Route element={<ProtectedRoute />}>
                                        <Route path="songs/create" element={<SongCreatePage />} />
                                        <Route path="songs/:id/edit" element={<SongEditPage />} />
                                        <Route path="playlists/create" element={<PlaylistCreatePage />} />
                                        <Route path="playlists/import" element={<PlaylistImportPage />} />
                                        <Route path="rooms" element={<RoomsIndexPage />} />
                                        <Route path="rooms/create" element={<RoomCreatePage />} />
                                        <Route path="rooms/:code" element={<RoomShowPage />} />
                                        <Route path="settings" element={<SettingsPage />} />
                                    </Route>

                                    <Route path="playlists/:id" element={<PlaylistShowPage />} />
                                </Route>
                            </Routes>
                        </RoomProvider>
                    </PlayerProvider>
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    );
}
