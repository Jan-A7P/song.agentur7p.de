export type LrcLine = {
    timeMs: number;
    text: string;
};

export type EditableLyricLine = {
    timeMs: number | null;
    text: string;
};

export type ParsedLrc = {
    isLrc: boolean;
    meta: {
        artist?: string;
        title?: string;
        album?: string;
        offsetMs: number;
        lengthMs?: number;
    };
    lines: LrcLine[];
    plainText: string;
};

const META_RE = /^\[(ar|ti|al|offset|by|length):\s*(.*?)\s*\]$/i;
const TIMED_LINE_RE = /^((?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])+)\s*(.*)$/;
const TIME_TAG_RE = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

export function durationFromLyrics(lyrics: string | null | undefined): number | null {
    if (!lyrics) {
        return null;
    }
    const parsed = parseLrc(lyrics);
    const lengthTag = parsed.meta.lengthMs;
    if (lengthTag && lengthTag > 1000) {
        return lengthTag;
    }
    if (!parsed.isLrc || parsed.lines.length === 0) {
        return null;
    }
    const last = parsed.lines[parsed.lines.length - 1]?.timeMs ?? 0;
    if (last < 30_000) {
        return null;
    }
    // LRC usually ends before the audio outro.
    return last + 8_000;
}

function parseTimeTag(minutes: string, seconds: string, fraction?: string): number {
    let ms = 0;
    if (fraction) {
        const padded = fraction.padEnd(3, '0').slice(0, 3);
        ms = Number(padded);
    }

    return (Number(minutes) * 60 + Number(seconds)) * 1000 + ms;
}

function parseLengthTag(value: string): number | null {
    const trimmed = value.trim();
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && asNumber > 0) {
        // Seconds if small, already ms if large.
        return asNumber < 10_000 ? Math.round(asNumber * 1000) : Math.round(asNumber);
    }
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!match) {
        return null;
    }
    return parseTimeTag(match[1], match[2], match[3]);
}

export function formatLrcTimestamp(ms: number): string {
    const safe = Math.max(0, Math.floor(ms));
    const minutes = Math.floor(safe / 60000);
    const seconds = Math.floor((safe % 60000) / 1000);
    const centiseconds = Math.floor((safe % 1000) / 10);

    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
}

export function parseLrc(input: string): ParsedLrc {
    const raw = input.replace(/^\uFEFF/, '');
    const rows = raw.split(/\r?\n/);
    const meta: ParsedLrc['meta'] = { offsetMs: 0 };
    const timed: LrcLine[] = [];
    const plainParts: string[] = [];
    let timedCount = 0;

    for (const row of rows) {
        const line = row.trimEnd();
        if (!line.trim()) {
            plainParts.push('');
            continue;
        }

        const metaMatch = line.trim().match(META_RE);
        if (metaMatch) {
            const key = metaMatch[1].toLowerCase();
            const value = metaMatch[2];
            if (key === 'ar') meta.artist = value;
            if (key === 'ti') meta.title = value;
            if (key === 'al') meta.album = value;
            if (key === 'offset') {
                const offset = Number(value);
                meta.offsetMs = Number.isFinite(offset) ? offset : 0;
            }
            if (key === 'length') {
                const lengthMs = parseLengthTag(value);
                if (lengthMs) {
                    meta.lengthMs = lengthMs;
                }
            }
            continue;
        }

        const timedMatch = line.match(TIMED_LINE_RE);
        if (timedMatch) {
            timedCount += 1;
            const tags = timedMatch[1];
            const text = timedMatch[2].trim();
            plainParts.push(text);

            TIME_TAG_RE.lastIndex = 0;
            let tagMatch: RegExpExecArray | null;
            while ((tagMatch = TIME_TAG_RE.exec(tags)) !== null) {
                timed.push({
                    timeMs: parseTimeTag(tagMatch[1], tagMatch[2], tagMatch[3]),
                    text,
                });
            }
            continue;
        }

        plainParts.push(line);
    }

    timed.sort((a, b) => a.timeMs - b.timeMs || a.text.localeCompare(b.text));

    return {
        isLrc: timedCount >= 2,
        meta,
        lines: timed.map((line) => ({
            ...line,
            timeMs: Math.max(0, line.timeMs + meta.offsetMs),
        })),
        plainText: plainParts.join('\n').trim(),
    };
}

/** Preserve original line order for editing (no sort by time). */
export function lyricsToEditableLines(lyrics: string): EditableLyricLine[] {
    const raw = lyrics.replace(/^\uFEFF/, '');
    if (!raw.trim()) {
        return [{ timeMs: null, text: '' }];
    }

    const rows = raw.split(/\r?\n/);
    const lines: EditableLyricLine[] = [];

    for (const row of rows) {
        const line = row.trimEnd();
        if (!line.trim()) {
            lines.push({ timeMs: null, text: '' });
            continue;
        }

        if (META_RE.test(line.trim())) {
            continue;
        }

        const timedMatch = line.match(TIMED_LINE_RE);
        if (timedMatch) {
            TIME_TAG_RE.lastIndex = 0;
            const first = TIME_TAG_RE.exec(timedMatch[1]);
            const timeMs = first ? parseTimeTag(first[1], first[2], first[3]) : null;
            lines.push({ timeMs, text: timedMatch[2].trim() });
            continue;
        }

        lines.push({ timeMs: null, text: line });
    }

    return lines.length > 0 ? lines : [{ timeMs: null, text: '' }];
}

export function serializeEditableLines(lines: EditableLyricLine[]): string {
    const hasTimestamps = lines.filter((line) => line.text.trim()).filter((line) => line.timeMs != null).length >= 2;

    return lines
        .map((line) => {
            if (!line.text.trim() && line.timeMs == null) {
                return '';
            }
            if (hasTimestamps && line.timeMs != null) {
                return `${formatLrcTimestamp(line.timeMs)}${line.text}`;
            }
            return line.text;
        })
        .join('\n');
}

export function findActiveLrcIndex(lines: LrcLine[], positionMs: number): number {
    if (lines.length === 0) {
        return -1;
    }

    let active = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].timeMs <= positionMs) {
            active = i;
        } else {
            break;
        }
    }

    return active;
}

export function looksLikeLrc(input: string): boolean {
    return parseLrc(input).isLrc;
}
