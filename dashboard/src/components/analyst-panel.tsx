import type { AnalystSignals } from '@/lib/state-reader';

export function AnalystPanel({ signals }: { signals: AnalystSignals | null }) {
  if (!signals) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-2">Analyst Signals</h2>
        <p className="text-sm text-gray-500">
          No analyst data yet. Signals generate after videos are posted with performance data.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-200">Analyst Signals</h2>
        <span className="text-xs text-gray-500">
          Updated {new Date(signals.updatedAt).toLocaleString()}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">High Performing</p>
          {signals.highPerformingCategories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {signals.highPerformingCategories.map((cat) => (
                <span
                  key={cat}
                  className="px-2.5 py-1 text-xs rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                >
                  {cat}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600">Insufficient data</p>
          )}
        </div>

        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Avoid</p>
          {signals.avoidCategories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {signals.avoidCategories.map((cat) => (
                <span
                  key={cat}
                  className="px-2.5 py-1 text-xs rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/20"
                >
                  {cat}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-600">None flagged</p>
          )}
        </div>
      </div>

      {signals.notes && (
        <div className="mt-4 p-3 rounded-lg bg-gray-800/50 text-sm text-gray-400">
          {signals.notes}
        </div>
      )}
    </div>
  );
}
