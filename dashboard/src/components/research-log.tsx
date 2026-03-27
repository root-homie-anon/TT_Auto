import type { ResearchLogEntry } from '@/lib/state-reader';

export function ResearchLog({ entries }: { entries: ResearchLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center text-gray-500">
        No research history. Run the researcher to start discovering products.
      </div>
    );
  }

  const accepted = entries.filter((e) => e.accepted);
  const rejected = entries.filter((e) => !e.accepted);
  const avgScore = Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-200">Research Log</h2>
        <div className="flex gap-4 text-sm">
          <span className="text-emerald-400">{accepted.length} accepted</span>
          <span className="text-rose-400">{rejected.length} rejected</span>
          <span className="text-gray-400">avg score: {avgScore}</span>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-gray-800/50">
        {[...entries].reverse().map((e, i) => (
          <div
            key={`${e.tiktokShopId}-${i}`}
            className={`px-4 py-3 flex items-center justify-between gap-3 ${
              e.accepted ? '' : 'opacity-50'
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm text-gray-300 truncate">{e.productName}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(e.researchedAt).toLocaleString()}
                {e.rejectReason && (
                  <span className="text-rose-400 ml-2">{e.rejectReason}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={`text-lg font-bold ${e.accepted ? 'text-emerald-400' : 'text-gray-600'}`}>
                {e.score}
              </span>
              <span className={`w-2 h-2 rounded-full ${e.accepted ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
