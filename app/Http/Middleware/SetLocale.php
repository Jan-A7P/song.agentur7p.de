<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SetLocale
{
    /** @var list<string> */
    private array $supported = ['en', 'de'];

    public function handle(Request $request, Closure $next): Response
    {
        app()->setLocale($this->negotiate($request));

        return $next($request);
    }

    private function negotiate(Request $request): string
    {
        $header = (string) $request->header('Accept-Language', '');
        if ($header === '') {
            return config('app.fallback_locale', 'en');
        }

        $candidates = [];
        foreach (explode(',', $header) as $part) {
            $piece = trim($part);
            if ($piece === '') {
                continue;
            }
            [$tag, $q] = array_pad(explode(';q=', $piece, 2), 2, '1');
            $lang = strtolower(explode('-', trim($tag))[0] ?? '');
            $quality = is_numeric($q) ? (float) $q : 1.0;
            if ($lang !== '') {
                $candidates[$lang] = max($candidates[$lang] ?? 0, $quality);
            }
        }

        arsort($candidates);
        foreach (array_keys($candidates) as $lang) {
            if (in_array($lang, $this->supported, true)) {
                return $lang;
            }
        }

        return config('app.fallback_locale', 'en');
    }
}
