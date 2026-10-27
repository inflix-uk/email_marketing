import { formatMetric, metricValue, type MetricDef, type ReportRow } from "@/lib/reports/rollup";

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

/** A round axis maximum: 1, 2, 2.5, 5 x 10^n. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * pow) return step * pow;
  return 10 * pow;
}

/**
 * One metric over the report's rows (periods, or campaigns oldest first), as
 * a plain SVG line. One metric per chart: two metrics get two charts, never
 * a second y-axis. N/A values leave a gap. Hover a point for its value.
 */
export function TrendChart({ metric, rows }: { metric: MetricDef; rows: ReportRow[] }) {
  const values = rows.map((r) => metricValue(r.counts, metric.key));
  const known = values.filter((v): v is number => v !== null);
  const max = niceMax(Math.max(0, ...known));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (rows.length <= 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  // Line segments between consecutive known values.
  const segments: string[] = [];
  let current = "";
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (current) segments.push(current);

  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));

  return (
    <figure className="min-w-0 break-inside-avoid">
      <figcaption className="mb-2 text-sm font-medium text-slate-700">{metric.label}</figcaption>
      {known.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No data for these dates.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${metric.label} over time`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-slate-200" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px]">
                {formatMetric(t, metric.kind)}
              </text>
            </g>
          ))}
          {rows.map((r, i) =>
            i % labelEvery === 0 || i === rows.length - 1 ? (
              <text key={r.key} x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                {r.label.length > 18 ? `${r.label.slice(0, 17)}…` : r.label}
              </text>
            ) : null,
          )}
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" className="stroke-indigo-600" strokeWidth={2} strokeLinejoin="round" />
          ))}
          {values.map((v, i) =>
            v === null ? null : (
              <g key={rows[i].key}>
                <circle cx={x(i)} cy={y(v)} r={4} className="fill-indigo-600 stroke-white" strokeWidth={2} />
                {/* Bigger invisible hit target with a native tooltip. */}
                <circle cx={x(i)} cy={y(v)} r={12} fill="transparent">
                  <title>{`${rows[i].label}: ${formatMetric(v, metric.kind)}`}</title>
                </circle>
              </g>
            ),
          )}
        </svg>
      )}
    </figure>
  );
}
