<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csrf-token" content="{{ csrf_token() }}">
        <title>{{ config('app.name', 'Songs') }}</title>
        <script>
            (() => {
                try {
                    const stored = localStorage.getItem('songtexte.theme');
                    const dark =
                        stored === 'dark' ||
                        (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                    if (dark) document.documentElement.classList.add('dark');
                } catch (_) {}
                try {
                    const stored = localStorage.getItem('songtexte.locale');
                    const supported = ['de', 'en'];
                    let locale = stored && supported.includes(stored) ? stored : null;
                    if (!locale) {
                        const langs = [...(navigator.languages || []), navigator.language].filter(Boolean);
                        for (const item of langs) {
                            const base = String(item).toLowerCase().split('-')[0];
                            if (supported.includes(base)) {
                                locale = base;
                                break;
                            }
                        }
                    }
                    document.documentElement.lang = locale || 'en';
                } catch (_) {
                    document.documentElement.lang = 'en';
                }
            })();
        </script>
        @vite(['resources/css/app.css', 'resources/js/main.tsx'])
    </head>
    <body class="min-h-screen antialiased">
        <div id="root"></div>
    </body>
</html>
