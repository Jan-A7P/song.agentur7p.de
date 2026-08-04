import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { providerLabel } from '@/lib/music';
import type { SongDailyStat, SongPlayHistoryItem, SongStats } from '@/types';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

function formatListenTime(ms: number): string {
    if (!Number.isFinite(ms) || ms < 1000) {
        return '0:00';
    }

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatListenDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 1000) {
        return 'unter 1 Min.';
    }

    const minutes = Math.round(ms / 60000);
    if (minutes < 60) {
        return `${minutes} Min.`;
    }

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

function formatPlayedAt(value: string | null): string {
    if (!value) {
        return 'noch nie';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    const now = Date.now();
    const diffMs = now - date.getTime();
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diffMs < minute) {
        return 'gerade eben';
    }
    if (diffMs < hour) {
        const mins = Math.floor(diffMs / minute);
        return `vor ${mins} Min.`;
    }
    if (diffMs < day) {
        const hours = Math.floor(diffMs / hour);
        return `vor ${hours} Std.`;
    }
    if (diffMs < 7 * day) {
        const days = Math.floor(diffMs / day);
        return `vor ${days} Tag${days === 1 ? '' : 'en'}`;
    }

    return date.toLocaleDateString('de-DE', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
}

function formatDayLabel(date: string): string {
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

type Metric = 'plays' | 'listen_ms';

type SongPlayStatsProps = {
    stats: SongStats;
    className?: string;
};

export function SongPlayStats({ stats, className }: SongPlayStatsProps) {
    const my = stats.my;
    const daily = stats.daily ?? [];
    const songDurationMs = stats.duration_ms && stats.duration_ms > 0 ? stats.duration_ms : null;
    const [metric, setMetric] = useState<Metric>('plays');
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);

    const periodTotals = useMemo(() => {
        const plays = daily.reduce((sum, day) => sum + day.plays, 0);
        const listenMs = daily.reduce((sum, day) => sum + day.listen_ms, 0);
        const avgListenMs = plays > 0 ? Math.round(listenMs / plays) : 0;
        return { plays, listen_ms: listenMs, avg_listen_ms: avgListenMs };
    }, [daily]);

    return (
        <section className={cn('space-y-5', className)}>
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="font-display text-xl font-semibold tracking-tight">Statistik</h2>
                    <p className="text-sm text-muted">
                        Verlauf der letzten 30 Tage
                        {songDurationMs ? ` · Songlänge ${formatListenTime(songDurationMs)}` : ''}.
                    </p>
                </div>

                <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
                    <button
                        type="button"
                        onClick={() => setMetric('plays')}
                        className={cn(
                            'rounded-full px-3 py-1 text-xs transition',
                            metric === 'plays' ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
                        )}
                    >
                        Wiedergaben
                    </button>
                    <button
                        type="button"
                        onClick={() => setMetric('listen_ms')}
                        className={cn(
                            'rounded-full px-3 py-1 text-xs transition',
                            metric === 'listen_ms' ? 'bg-ink text-paper' : 'text-muted hover:text-ink',
                        )}
                    >
                        Hörzeit / Play
                    </button>
                </div>
            </div>

            <PlayActivityChart
                daily={daily}
                metric={metric}
                songDurationMs={songDurationMs}
                hoverIndex={hoverIndex}
                onHover={setHoverIndex}
            />

            <dl className="grid grid-cols-3 gap-4 border-y border-line py-4">
                <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">30 Tage</dt>
                    <dd className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight">
                        {metric === 'plays'
                            ? periodTotals.plays
                            : formatListenTime(periodTotals.avg_listen_ms)}
                    </dd>
                    <p className="mt-0.5 text-xs text-muted">
                        {metric === 'plays'
                            ? 'Wiedergaben'
                            : songDurationMs
                              ? `Ø von ${formatListenTime(songDurationMs)}`
                              : 'Ø pro Wiedergabe'}
                    </p>
                </div>
                <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Gesamt</dt>
                    <dd className="mt-1 font-display text-2xl font-semibold tabular-nums tracking-tight">
                        {stats.play_count}
                    </dd>
                    {stats.completed_count > 0 && (
                        <p className="mt-0.5 text-xs text-muted">{stats.completed_count}× durchgehört</p>
                    )}
                </div>
                <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Zuletzt</dt>
                    <dd className="mt-1 font-display text-lg font-semibold tracking-tight sm:text-2xl">
                        {formatPlayedAt(stats.last_played_at)}
                    </dd>
                </div>
            </dl>

            {my && my.play_count > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted">
                        Von dir:{' '}
                        <span className="text-ink tabular-nums">{my.play_count}×</span>
                        {' · '}
                        <span className="text-ink tabular-nums">{formatListenDuration(my.total_listen_ms)}</span>
                        {my.completed_count > 0 && (
                            <>
                                {' · '}
                                <span className="text-ink tabular-nums">{my.completed_count}×</span> durchgehört
                            </>
                        )}
                        {my.last_played_at && (
                            <>
                                {' · '}
                                zuletzt {formatPlayedAt(my.last_played_at)}
                            </>
                        )}
                    </p>

                    {stats.recent_plays.length > 0 && (
                        <Dialog>
                            <DialogTrigger asChild>
                                <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted">
                                    Letzte Plays
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Letzte Plays</DialogTitle>
                                    <DialogDescription>
                                        Deine letzten Wiedergaben dieses Songs.
                                    </DialogDescription>
                                </DialogHeader>
                                <DialogBody className="max-h-[min(60vh,28rem)]">
                                    <ul className="divide-y divide-line">
                                        {stats.recent_plays.map((play) => (
                                            <PlayHistoryRow
                                                key={play.id}
                                                play={play}
                                                songDurationMs={songDurationMs}
                                            />
                                        ))}
                                    </ul>
                                </DialogBody>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
            )}

            {stats.play_count === 0 && (
                <p className="text-sm text-muted">Noch keine Wiedergaben für diesen Song.</p>
            )}
        </section>
    );
}

function PlayActivityChart({
    daily,
    metric,
    songDurationMs,
    hoverIndex,
    onHover,
}: {
    daily: SongDailyStat[];
    metric: Metric;
    songDurationMs: number | null;
    hoverIndex: number | null;
    onHover: (index: number | null) => void;
}) {
    const width = 640;
    const height = 180;
    const padX = 8;
    const padTop = 16;
    const padBottom = 28;
    const chartW = width - padX * 2;
    const chartH = height - padTop - padBottom;

    const values = daily.map((d) =>
        metric === 'plays' ? d.plays : d.avg_listen_ms ?? (d.plays > 0 ? Math.round(d.listen_ms / d.plays) : 0),
    );

    const observedMax = Math.max(...values, 0);
    const maxValue =
        metric === 'listen_ms' && songDurationMs
            ? Math.max(songDurationMs, observedMax, 1)
            : Math.max(observedMax, 1);

    const hasActivity = values.some((v) => v > 0);

    const points = daily.map((day, index) => {
        const x = daily.length <= 1 ? padX + chartW / 2 : padX + (index / (daily.length - 1)) * chartW;
        const clamped = Math.min(values[index], maxValue);
        const ratio = clamped / maxValue;
        const y = padTop + chartH - ratio * chartH;
        return { x, y, day, value: values[index] };
    });

    const linePath = points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
        .join(' ');

    const areaPath =
        points.length > 0
            ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${(padTop + chartH).toFixed(2)} L ${points[0].x.toFixed(2)} ${(padTop + chartH).toFixed(2)} Z`
            : '';

    const active = hoverIndex != null ? points[hoverIndex] : null;
    const tickIndexes = [0, Math.floor((daily.length - 1) / 2), daily.length - 1].filter(
        (v, i, arr) => arr.indexOf(v) === i && v >= 0 && v < daily.length,
    );

    const yLabels =
        metric === 'listen_ms' && songDurationMs
            ? [
                  { ratio: 1, label: formatListenTime(songDurationMs) },
                  { ratio: 0.5, label: formatListenTime(Math.round(songDurationMs / 2)) },
                  { ratio: 0, label: '0:00' },
              ]
            : metric === 'plays'
              ? [
                    { ratio: 1, label: String(maxValue) },
                    { ratio: 0.5, label: String(Math.round(maxValue / 2)) },
                    { ratio: 0, label: '0' },
                ]
              : [
                    { ratio: 1, label: formatListenTime(maxValue) },
                    { ratio: 0.5, label: formatListenTime(Math.round(maxValue / 2)) },
                    { ratio: 0, label: '0:00' },
                ];

    return (
        <div className="relative">
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="h-44 w-full overflow-visible sm:h-48"
                role="img"
                aria-label={
                    metric === 'plays'
                        ? 'Wiedergaben der letzten 30 Tage'
                        : 'Durchschnittliche Hörzeit pro Wiedergabe der letzten 30 Tage'
                }
                onMouseLeave={() => onHover(null)}
            >
                <defs>
                    <linearGradient id="song-play-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
                    </linearGradient>
                </defs>

                {[0.25, 0.5, 0.75, 1].map((ratio) => {
                    const y = padTop + chartH * (1 - ratio);
                    return (
                        <line
                            key={ratio}
                            x1={padX}
                            x2={width - padX}
                            y1={y}
                            y2={y}
                            stroke="var(--line)"
                            strokeOpacity="0.7"
                            strokeWidth="1"
                        />
                    );
                })}

                {metric === 'listen_ms' && songDurationMs && (
                    <line
                        x1={padX}
                        x2={width - padX}
                        y1={padTop}
                        y2={padTop}
                        stroke="var(--accent)"
                        strokeOpacity="0.45"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                    />
                )}

                {hasActivity && areaPath && (
                    <path d={areaPath} fill="url(#song-play-fill)" className="transition-opacity duration-300" />
                )}
                {hasActivity && (
                    <path
                        d={linePath}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        className="transition-[d] duration-300"
                    />
                )}

                {points.map((point, index) => (
                    <g key={point.day.date}>
                        <rect
                            x={index === 0 ? padX : point.x - chartW / daily.length / 2}
                            y={padTop}
                            width={chartW / Math.max(daily.length, 1)}
                            height={chartH}
                            fill="transparent"
                            onMouseEnter={() => onHover(index)}
                        />
                        {point.value > 0 && (
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r={hoverIndex === index ? 4.5 : 2.5}
                                fill="var(--accent)"
                                className="transition-all duration-150"
                            />
                        )}
                    </g>
                ))}

                {yLabels.map((item) => {
                    const y = padTop + chartH * (1 - item.ratio);
                    return (
                        <text
                            key={`y-${item.ratio}`}
                            x={width - 2}
                            y={y + 3}
                            textAnchor="end"
                            className="fill-muted text-[10px]"
                        >
                            {item.label}
                        </text>
                    );
                })}

                {tickIndexes.map((index) => {
                    const point = points[index];
                    if (!point) {
                        return null;
                    }
                    return (
                        <text
                            key={`tick-${point.day.date}`}
                            x={point.x}
                            y={height - 6}
                            textAnchor={index === 0 ? 'start' : index === daily.length - 1 ? 'end' : 'middle'}
                            className="fill-muted text-[11px]"
                        >
                            {formatDayLabel(point.day.date)}
                        </text>
                    );
                })}

                {active && (
                    <>
                        <line
                            x1={active.x}
                            x2={active.x}
                            y1={padTop}
                            y2={padTop + chartH}
                            stroke="var(--ink)"
                            strokeOpacity="0.2"
                            strokeDasharray="3 3"
                        />
                        <circle cx={active.x} cy={active.y} r="5" fill="var(--accent)" />
                    </>
                )}
            </svg>

            <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
                {active ? (
                    <div className="rounded-full border border-line bg-paper/95 px-3 py-1 text-xs shadow-sm backdrop-blur">
                        <span className="text-muted">{formatDayLabel(active.day.date)}</span>
                        <span className="mx-1.5 text-line">·</span>
                        <span className="font-medium tabular-nums">
                            {metric === 'plays' ? (
                                `${active.value}×`
                            ) : songDurationMs ? (
                                <>
                                    Ø {formatListenTime(active.value)} / {formatListenTime(songDurationMs)}
                                    {active.value > 0
                                        ? ` (${Math.min(100, Math.round((active.value / songDurationMs) * 100))}%)`
                                        : ''}
                                </>
                            ) : (
                                `Ø ${formatListenTime(active.value)}`
                            )}
                        </span>
                        {metric === 'listen_ms' && active.day.plays > 0 && (
                            <>
                                <span className="mx-1.5 text-line">·</span>
                                <span className="text-muted">{active.day.plays}×</span>
                            </>
                        )}
                    </div>
                ) : !hasActivity ? (
                    <p className="text-xs text-muted">In den letzten 30 Tagen keine Aktivität.</p>
                ) : null}
            </div>
        </div>
    );
}

function PlayHistoryRow({
    play,
    songDurationMs,
}: {
    play: SongPlayHistoryItem;
    songDurationMs: number | null;
}) {
    return (
        <li className="flex items-center gap-3 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
                <p className="truncate">{formatPlayedAt(play.created_at)}</p>
                <p className="truncate text-xs text-muted">
                    {play.provider ? providerLabel(play.provider) : 'Unbekannter Dienst'}
                    {' · '}
                    {songDurationMs
                        ? `${formatListenTime(play.listened_ms)} / ${formatListenTime(songDurationMs)}`
                        : `${formatListenTime(play.listened_ms)} gehört`}
                </p>
            </div>
            {play.completed ? (
                <span className="inline-flex items-center gap-1 text-xs text-accent">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    fertig
                </span>
            ) : (
                <span className="text-xs text-muted">teilweise</span>
            )}
        </li>
    );
}
