# Songtexte

Laravel-API mit Sanctum-Auth und React-SPA (TypeScript, Tailwind, shadcn-ähnliche UI-Komponenten) zum Verwalten von Songtexten und Abspielen über Spotify.

## Voraussetzungen

- PHP 8.3+
- Composer
- Node.js 20+
- MySQL oder SQLite
- Spotify Developer App (für Suche & Playback)

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

## Spotify

1. App unter https://developer.spotify.com/dashboard anlegen
2. Redirect URI eintragen, z. B. `http://127.0.0.1:8000/spotify/callback`
3. In `.env` setzen:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI="${APP_URL}/spotify/callback"
```

**Hinweis:** Browser-Playback benötigt Spotify Premium. Ohne Premium funktionieren Songtexte und Track-Verknüpfung weiterhin.

## Hörräume (Jam)

Gemeinsames Hören: Host steuert Song/Play/Pause/Seek; Teilnehmer spielen synchron auf dem eigenen Spotify Premium.

1. `BROADCAST_CONNECTION=reverb` und Reverb-Keys in `.env` (siehe `.env.example`)
2. Reverb mitstarten: `composer run dev` (inkl. `php artisan reverb:start`) oder separat
3. In der App unter **Hörräume** einen Raum erstellen und Code/Link teilen

Alle Teilnehmer müssen eingeloggt und mit Spotify verbunden sein.

## API-Überblick

| Methode | Pfad | Auth |
|--------|------|------|
| POST | `/api/register`, `/api/login` | nein |
| POST | `/api/logout` | ja |
| GET | `/api/user` | ja |
| GET | `/api/songs`, `/api/songs/{id}` | nein |
| POST/PUT/DELETE | `/api/songs` | ja |
| GET | `/api/spotify/search`, `/api/spotify/token` | ja |
| POST | `/api/spotify/play`, `/api/spotify/disconnect` | ja |
| GET/POST | `/api/rooms…` | ja |
| GET | `/spotify/redirect`, `/spotify/callback` | Session |

## Frontend

- Entry: `resources/js/main.tsx`
- Pages: `resources/js/pages/`
- UI: `resources/js/components/ui/`
