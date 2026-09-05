<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\DiscoveryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class DiscoveryController extends Controller
{
    public function __construct(private DiscoveryService $discovery) {}

    public function feed(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'limit' => ['sometimes', 'integer', 'min:4', 'max:24'],
        ]);

        $cards = $this->discovery->feed(
            $request->user(),
            (int) ($validated['limit'] ?? 12),
        );

        return response()->json([
            'data' => $cards,
        ]);
    }

    public function swipe(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'direction' => ['required', 'string', Rule::in(['like', 'dislike'])],
            'song_id' => ['nullable', 'uuid', 'required_without:provider_track_id'],
            'provider' => ['nullable', 'string', 'max:32'],
            'provider_track_id' => ['nullable', 'string', 'max:255', 'required_without:song_id'],
            'provider_uri' => ['nullable', 'string', 'max:255'],
            'title' => ['nullable', 'string', 'max:255'],
            'artist' => ['nullable', 'string', 'max:255'],
            'album_art_url' => ['nullable', 'string', 'max:4096'],
            'duration_ms' => ['nullable', 'integer', 'min:0', 'max:3600000'],
        ]);

        $result = $this->discovery->swipe($request->user(), $validated);

        return response()->json([
            'data' => [
                'direction' => $result['swipe']->direction,
                'song' => $result['song'],
                'created' => $result['created'],
            ],
        ]);
    }
}
