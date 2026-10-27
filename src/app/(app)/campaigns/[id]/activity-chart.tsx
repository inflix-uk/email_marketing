import type { Activity } from "@/lib/reports/campaign";
import { formatNumber } from "@/lib/utils";

const OPENS = "#4f46e5";
const CLICKS = "#d97706";

const W = 800;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 40 };

function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s * 4 >= n) ?? pow * 10;
  return step * 4;
}

/** Opens and clicks per hour/day as grouped bars (plain SVG; hover a bar for its numbers). */
export function ActivityChart({ activity }: { activity: Activity }) {
  const { buckets } = activity;
  const max = niceMax(Math.max(1, ...buckets.map((b) => Math.max(b.opens, b.clicks))));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / buckets.length;
  const gap = slot > 6 ? 2 : 0;
  const barW = Math.max(1, (slot - gap * 3) / 2);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 6));
  const opensName = activity.opensKind === "all" ? "Opens" : "First opens";

  return (
    <figure className="break-inside-avoid">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OPENS }} aria-hidden />
          {opensName}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CLICKS }} aria-hidden />
          Clicks
        </span>
        <span className="text-slate-400">
          Per {activity.unit} · UK time ({activity.timeZone})
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${opensName} and clicks per ${activity.unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#64748b">
              {formatNumber(Math.round(t))}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x0 = PAD.left + i * slot + gap;
          return (
            <g key={b.key}>
              <title>{`${b.label}: ${formatNumber(b.opens)} ${opensName.toLowerCase()}, ${formatNumber(b.clicks)} clicks`}</title>
              {/* Bigger invisible hit target than the bars. */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {b.opens > 0 ? (
                <rect x={x0} y={y(b.opens)} width={barW} height={y(0) - y(b.opens)} rx={Math.min(2, barW / 2)} fill={OPENS} />
              ) : null}
              {b.clicks > 0 ? (
                <rect x={x0 + barW + gap} y={y(b.clicks)} width={barW} height={y(0) - y(b.clicks)} rx={Math.min(2, barW / 2)} fill={CLICKS} />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={PAD.left + i * slot} y={H - 8} fontSize={11} fill="#64748b">
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeWidth={1} />
      </svg>
      <details className="mt-2 text-xs text-slate-500 print:hidden">
        <summary className="cursor-pointer select-none">Show as table</summary>
        <table className="mt-2 w-full max-w-md text-left tabular-nums">
          <thead>
            <tr>
              <th className="py-1 font-medium">{activity.unit === "hour" ? "Hour" : "Day"}</th>
              <th className="py-1 font-medium">{opensName}</th>
              <th className="py-1 font-medium">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {buckets
              .filter((b) => b.opens || b.clicks)
              .map((b) => (
                <tr key={b.key}>
                  <td className="py-0.5">{b.label}</td>
                  <td className="py-0.5">{formatNumber(b.opens)}</td>
                  <td className="py-0.5">{formatNumber(b.clicks)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
