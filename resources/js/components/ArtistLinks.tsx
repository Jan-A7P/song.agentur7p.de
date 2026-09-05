import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import type { Artist } from '@/types';

type ArtistRef = Pick<Artist, 'id' | 'name' | 'slug'> | { name: string; id?: string; slug?: string };

type Props = {
    artists?: ArtistRef[] | null;
    /** Fallback denormalized string, e.g. "Said The Sky, NÉONHÈART" */
    artist?: string | null;
    className?: string;
    linkClassName?: string;
};

/** Approximate Laravel Str::slug for artist URL fallbacks. */
export function artistSlugFromName(name: string): string {
    const slug = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug || 'artist';
}

/** Split common multi-artist separators when no structured artists are available. */
export function splitArtistNames(artist: string): string[] {
    const normalized = artist
        .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+/gi, ', ')
        .replace(/\s+&\s+/g, ', ')
        .replace(/\s+x\s+/gi, ', ');

    const seen = new Set<string>();
    const names: string[] = [];

    for (const part of normalized.split(/\s*[,;/]\s*/)) {
        const name = part.trim().replace(/^[-–—\s]+|[-–—\s]+$/g, '');
        if (!name) {
            continue;
        }
        const key = name.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        names.push(name);
    }

    return names;
}

function resolveItems(artists?: ArtistRef[] | null, artist?: string | null): ArtistRef[] {
    if (artists && artists.length > 0) {
        return artists.map((item) =>
            item.slug
                ? item
                : {
                      ...item,
                      slug: artistSlugFromName(item.name),
                  },
        );
    }

    if (artist?.trim()) {
        return splitArtistNames(artist).map((name) => ({
            name,
            slug: artistSlugFromName(name),
        }));
    }

    return [];
}

export function ArtistLinks({ artists, artist, className, linkClassName }: Props) {
    const items = resolveItems(artists, artist);

    if (items.length === 0) {
        return null;
    }

    return (
        <span className={cn('inline', className)}>
            {items.map((item, index) => {
                const slug = item.slug || artistSlugFromName(item.name);
                const content = (
                    <Link
                        to={`/artists/${slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className={cn('hover:text-accent hover:underline', linkClassName)}
                    >
                        {item.name}
                    </Link>
                );

                return (
                    <Fragment key={item.id ?? slug ?? `${item.name}-${index}`}>
                        {index > 0 ? <span>, </span> : null}
                        {content}
                    </Fragment>
                );
            })}
        </span>
    );
}
