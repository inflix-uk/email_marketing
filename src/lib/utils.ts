export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Pragmatic check: something@something.tld, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(d: Date | null | undefined): string {
  return d ? dateFmt.format(d) : "—";
}

export function formatDateTime(d: Date | null | undefined): string {
  return d ? dateTimeFmt.format(d) : "—";
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

/** "42.5%" - safe when the denominator is 0; never rounds to 0% or 100% unless exact. */
export function formatPercent(part: number, whole: number): string {
  if (!whole || !part) return "0%";
  const pct = (part / whole) * 100;
  if (pct < 0.1) return "<0.1%";
  if (pct < 100 && pct >= 99.5) return `${Math.min(pct, 99.9).toFixed(1)}%`;
  return `${pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}
