<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Artist;
use App\Models\Song;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ArtistController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Artist::query()
            ->withCount('songs')
            ->orderBy('name');

        if ($search = $request->string('q')->trim()->toString()) {
            $normalized = mb_strtolower($search);
            $query->where(function (Builder $builder) use ($search, $normalized) {
                $builder
                    ->where('name', 'like', "%{$search}%")
                    ->orWhere('normalized_name', 'like', "%{$normalized}%");
            });
        }

        return response()->json($query->paginate(20));
    }

    public function show(Request $request, Artist $artist): JsonResponse
    {
        $user = $request->user();

        $query = Song::query()
            ->with(['providers', 'artists'])
            ->whereHas('artists', fn (Builder $builder) => $builder->where('artists.id', $artist->id));

        $this->applyFavoriteExists($query, $user);

        $sort = $request->string('sort')->toString();
        if ($sort === 'plays') {
            $query->orderByDesc('play_count')->orderByDesc('id');
        } elseif ($sort === 'recently_played') {
            $query->orderByDesc('last_played_at')->orderByDesc('id');
        } else {
            $query->orderBy('title')->orderBy('id');
        }

        $songs = $query->paginate(20);

        return response()->json([
            'data' => [
                'id' => $artist->id,
                'name' => $artist->name,
                'slug' => $artist->slug,
                'songs_count' => (int) $artist->songs()->count(),
            ],
            'songs' => $songs,
        ]);
    }

    /**
     * @param  Builder<Song>  $query
     */
    private function applyFavoriteExists(Builder $query, ?User $user): void
    {
        if (! $user) {
            return;
        }

        $query->withExists([
            'favoritedBy as is_favorited' => fn (Builder $builder) => $builder->where('users.id', $user->id),
        ]);
    }
}
