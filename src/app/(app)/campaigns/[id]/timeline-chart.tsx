"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatNumber } from "@/lib/utils";
import type { TimelinePoint } from "../_lib/timeline";

// Categorical slots 1 and 2 of the chart palette (validated for colour-blind
// separation and contrast on a white surface). Text never uses these colours.
const SERIES = [
  { key: "opens", label: "Opens", color: "#2a78d6" },
  { key: "clicks", label: "Clicks", color: "#eb6834" },
] as const;

const HEIGHT = 220;
const MARGIN = { top: 12, right: 16, bottom: 26, left: 40 };
const X_STEPS = [1, 2, 3, 6, 12, 24];

/** Round axis maximum and step: 0 / 5 / 10, 0 / 250 / 500 ... (whole numbers only). */
function niceScale(max: number): { max: number; step: number } {
  if (max <= 4) return { max: Math.max(1, max), step: 1 };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  return { max: Math.ceil(max / step) * step, step };
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
}

/**
 * Opens and clicks per hour as two thin lines on one axis. Hover (or focus
 * and use the arrow keys) for the exact numbers; the table underneath holds
 * the same data.
 */
export function TimelineChart({ points }: { points: TimelinePoint[] }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState<number | null>(null);

  // The SVG is drawn at the frame's real pixel width, so text never scales.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const count = points.length;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const scale = niceScale(Math.max(...points.map((p) => Math.max(p.opens, p.clicks)), 0));
  const x = (i: number) => MARGIN.left + (count > 1 ? (i / (count - 1)) * plotW : plotW / 2);
  const y = (value: number) => MARGIN.top + plotH - (value / scale.max) * plotH;

  const yTicks: number[] = [];
  for (let v = 0; v <= scale.max; v += scale.step) yTicks.push(v);
  const maxXTicks = Math.max(2, Math.floor(plotW / 56));
  const xStep = X_STEPS.find((s) => (count - 1) / s + 1 <= maxXTicks) ?? 24;
  const xTicks = points.filter((p) => p.hour % xStep === 0);

  const totals = { opens: 0, clicks: 0 };
  for (const p of points) {
    totals.opens += p.opens;
    totals.clicks += p.clicks;
  }

  function indexAt(event: PointerEvent<SVGRectElement>): number {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = box.width ? (event.clientX - box.left) / box.width : 0;
    return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = active ?? count - 1;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "ArrowRight") next = Math.min(count - 1, current + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else if (event.key === "Escape") setActive(null);
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  }

  const hovered = active !== null ? points[active] : null;
  const tooltipOnLeft = active !== null && x(active) > width / 2;

  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ backgroundColor: series.color }} />
            {series.label}
            <span className="font-semibold text-slate-900">{formatNumber(totals[series.key])}</span>
          </li>
        ))}
      </ul>

      <div
        ref={frameRef}
        tabIndex={0}
        role="group"
        aria-label="Opens and clicks per hour. Use the left and right arrow keys to read each hour."
        onKeyDown={handleKeyDown}
        onFocus={() => setActive((current) => current ?? count - 1)}
        onBlur={() => setActive(null)}
        className="relative rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label="Line chart of opens and clicks per hour" className="block max-w-full">
          {/* Grid and axes: solid hairlines, one step off the surface. */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
                strokeWidth={1}
                className={tick === 0 ? "stroke-slate-300" : "stroke-slate-100"}
              />
              <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[11px] tabular-nums">
                {compact(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((p) => (
            <text key={p.hour} x={x(p.hour)} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-500 text-[11px] tabular-nums">
              {p.hour}h
            </text>
          ))}

          {hovered && active !== null ? (
            <line x1={x(active)} x2={x(active)} y1={MARGIN.top} y2={MARGIN.top + plotH} strokeWidth={1} className="stroke-slate-400" />
          ) : null}

          {SERIES.map((series) =>
            count > 1 ? (
              <polyline
                key={series.key}
                points={points.map((p, i) => `${x(i)},${y(p[series.key])}`).join(" ")}
                fill="none"
                stroke={series.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : (
              <circle key={series.key} cx={x(0)} cy={y(points[0][series.key])} r={5} fill={series.color} stroke="#fff" strokeWidth={2} />
            ),
          )}

          {hovered && active !== null
            ? SERIES.map((series) => (
                <circle key={series.key} cx={x(active)} cy={y(hovered[series.key])} r={5} fill={series.color} stroke="#fff" strokeWidth={2} />
              ))
            : null}

          {/* The whole plot is the hover target: aim at an hour, not at a 2px line. */}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={Math.max(0, plotW)}
            height={plotH}
            fill="transparent"
            onPointerMove={(event) => setActive(indexAt(event))}
            onPointerDown={(event) => setActive(indexAt(event))}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {hovered && active !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200"
            style={tooltipOnLeft ? { right: width - x(active) + 12 } : { left: x(active) + 12 }}
          >
            <p className="mb-1 whitespace-nowrap text-slate-500">
              {hovered.label} · hour {hovered.hour}
            </p>
            {SERIES.map((series) => (
              <p key={series.key} className="flex items-center gap-2 whitespace-nowrap text-slate-600">
                <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: series.color }} />
                <span className="font-semibold tabular-nums text-slate-900">{formatNumber(hovered[series.key])}</span>
                {series.label.toLowerCase()}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md ring-1 ring-inset ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2">Hour</th>
                <th scope="col" className="px-3 py-2">Time</th>
                <th scope="col" className="px-3 py-2 text-right">Opens</th>
                <th scope="col" className="px-3 py-2 text-right">Clicks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {points
                .filter((p) => p.opens || p.clicks)
                .map((p) => (
                  <tr key={p.hour}>
                    <td className="px-3 py-1.5 tabular-nums">{p.hour}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">{p.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(p.opens)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(p.clicks)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
