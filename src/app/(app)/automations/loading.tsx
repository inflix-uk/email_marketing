/** Skeleton shown while an automations page loads. */
export default function AutomationsLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <div className="h-4 w-24 rounded bg-slate-200" />
        <div className="h-7 w-64 rounded bg-slate-200" />
        <div className="h-4 w-96 max-w-full rounded bg-slate-100" />
      </div>
      <div className="space-y-4 rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-5 rounded bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
