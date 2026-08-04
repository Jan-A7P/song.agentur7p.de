<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\LyricsLookupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;
use Throwable;

class LyricsController extends Controller
{
    public function __construct(private LyricsLookupService $lyrics) {}

    public function lookup(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'artist' => ['required', 'string', 'max:255'],
            'duration_ms' => ['nullable', 'integer', 'min:1', 'max:3600000'],
        ]);

        try {
            $result = $this->lyrics->lookup(
                $validated['title'],
                $validated['artist'],
                isset($validated['duration_ms']) ? (int) $validated['duration_ms'] : null,
            );
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        } catch (Throwable $e) {
            return response()->json(['message' => 'Songtext-Suche fehlgeschlagen.'], 502);
        }

        if ($result === null) {
            return response()->json(['message' => 'Kein Songtext gefunden.'], 404);
        }

        return response()->json([
            'lyrics' => $result['lyrics'],
            'synced' => $result['synced'],
            'source' => $result['source'],
        ]);
    }
}
