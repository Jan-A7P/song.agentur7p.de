# Songtexte

Laravel-API mit Sanctum-Auth und React-SPA (TypeScript, Tailwind, shadcn-ähnliche UI-Komponenten) zum Verwalten von Songtexten und Abspielen über Spotify oder TIDAL.

## Voraussetzungen

- PHP 8.3+
- Composer
- Node.js 20+
- MySQL oder SQLite
- Spotify und/oder TIDAL Developer App (für Suche & Playback)

## Setup

```bash
composer install
cp .env.example .env   # falls noch nicht vorhanden
php artisan key:generate
php artisan migrate
npm install
npm run build
```

Lokal starten:

```bash
composer run dev
# oder getrennt:
php artisan serve
npm run dev
```

App öffnen: `http://127.0.0.1:8000`

## Sanctum (SPA-Auth)

Die React-App läuft same-origin über Laravel und nutzt Cookie-Sessions:

1. `GET /sanctum/csrf-cookie`
2. `POST /api/login` bzw. `/api/register`
3. geschützte Requests mit `credentials: 'include'` und `X-XSRF-TOKEN`

Relevant in `.env`:

```
SANCTUM_STATEFUL_DOMAINS=localhost,localhost:8000,127.0.0.1,127.0.0.1:8000
```

Für Production die echte Domain ergänzen (ohne Protokoll).

## Musikdienste (Spotify & TIDAL)

Die App spricht eine generische Music-API (`/api/music/{provider}/…`). Implementiert sind **Spotify** und **TIDAL**.

### Spotify

1. App unter https://developer.spotify.com/dashboard anlegen
2. Redirect URI: `http://127.0.0.1:8000/music/spotify/callback` (Legacy-Alias `/spotify/callback` bleibt aktiv)
3. In `.env` setzen:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI="${APP_URL}/music/spotify/callback"
```

**Hinweis:** Browser-Playback benötigt Spotify Premium.

### TIDAL

1. App unter https://developer.tidal.com anlegen
2. Redirect URI: `http://127.0.0.1:8000/music/tidal/callback`
3. In `.env` setzen:

```
TIDAL_CLIENT_ID=...
TIDAL_CLIENT_SECRET=...
TIDAL_REDIRECT_URI="${APP_URL}/music/tidal/callback"
TIDAL_COUNTRY_CODE=DE
```

**Hinweis:** Die Wiedergabe läuft über das offizielle TIDAL Web Player SDK. Für Drittanbieter-Apps ist das oft auf Previews beschränkt, je nach Freischaltung der TIDAL Developer App.

## Hörräume (Jam)

Gemeinsames Hören: Host steuert Song/Play/Pause/Seek; Teilnehmer spielen synchron über den verbundenen Musikdienst.

1. `BROADCAST_CONNECTION=reverb` und Reverb-Keys in `.env` (siehe `.env.example`)
2. Reverb mitstarten: `composer run dev` (inkl. `php artisan reverb:start`) oder separat
3. In der App unter **Hörräume** einen Raum erstellen und Code/Link teilen

Alle Teilnehmer müssen eingeloggt und mit demselben Musikdienst (Spotify oder TIDAL) verbunden sein.

## API-Überblick

| Methode | Pfad | Auth |
|--------|------|------|
| POST | `/api/register`, `/api/login` | nein |
| POST | `/api/logout` | ja |
| GET | `/api/user` | ja |
| GET | `/api/songs`, `/api/songs/{id}` | nein |
| POST/PUT/DELETE | `/api/songs` | ja |
| GET | `/api/music/providers` | ja |
| GET | `/api/music/{provider}/search`, `/token`, `/status`, `/playlists` | ja |
| POST | `/api/music/{provider}/play`, `/disconnect`, `/playlists/import` | ja |
| GET/POST | `/api/rooms…` | ja |
| GET | `/music/spotify/redirect`, `/music/spotify/callback` | Session |
| GET | `/music/tidal/redirect`, `/music/tidal/callback` | Session |

## Frontend

- Entry: `resources/js/main.tsx`
- Music providers: `resources/js/music/`
- Pages: `resources/js/pages/`
- UI: `resources/js/components/ui/`
