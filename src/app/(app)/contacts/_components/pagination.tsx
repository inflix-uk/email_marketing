import { ButtonLink } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";

/** "Showing 51-100 of 1,234" with Previous / Next links. Renders nothing for a single page. */
export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const disabled = "pointer-events-none opacity-50";

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
      <p className="text-slate-500">
        Showing <span className="font-medium text-slate-700">{formatNumber(from)}</span>–
        <span className="font-medium text-slate-700">{formatNumber(to)}</span> of{" "}
        <span className="font-medium text-slate-700">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-2">
        <ButtonLink
          href={hrefFor(page - 1)}
          variant="secondary"
          size="sm"
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={page <= 1 ? disabled : undefined}
        >
          Previous
        </ButtonLink>
        <span className="text-slate-500">
          Page {page} of {formatNumber(pageCount)}
        </span>
        <ButtonLink
          href={hrefFor(page + 1)}
          variant="secondary"
          size="sm"
          aria-disabled={page >= pageCount}
          tabIndex={page >= pageCount ? -1 : undefined}
          className={page >= pageCount ? disabled : undefined}
        >
          Next
        </ButtonLink>
      </div>
    </nav>
  );
}
