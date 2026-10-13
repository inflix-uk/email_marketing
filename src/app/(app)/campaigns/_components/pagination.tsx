import { ButtonLink } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";

/** "Showing 51-100 of 234" with previous / next links. Renders nothing for a single page. */
export function Pagination({
  page,
  pageCount,
  pageSize,
  total,
  hrefFor,
  preserveScroll = false,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
  preserveScroll?: boolean;
}) {
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 border-t border-slate-200 px-4 py-3">
      <p className="text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{formatNumber(from)}</span>–
        <span className="font-medium text-slate-700">{formatNumber(to)}</span> of{" "}
        <span className="font-medium text-slate-700">{formatNumber(total)}</span>
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <ButtonLink href={hrefFor(page - 1)} variant="secondary" size="sm" scroll={!preserveScroll} rel="prev">
            Previous
          </ButtonLink>
        ) : null}
        {page < pageCount ? (
          <ButtonLink href={hrefFor(page + 1)} variant="secondary" size="sm" scroll={!preserveScroll} rel="next">
            Next
          </ButtonLink>
        ) : null}
      </div>
    </nav>
  );
}
