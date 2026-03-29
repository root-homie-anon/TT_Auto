import type { LastRun } from '@/lib/state-reader';

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function LastRunPanel({ lastRun }: { lastRun: LastRun | null }) {
  if (!lastRun) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
        <h2 className="text-lg font-semibold text-gray-200">Last Pipeline Run</h2>
        <p className="mt-2 text-sm text-gray-500">No runs yet</p>
      </div>
    );
  }

  const hasErrors = lastRun.errors.length > 0;
  const borderColor = hasErrors ? 'border-rose-500/30' : 'border-emerald-500/30';
  const statusColor = hasErrors ? 'text-rose-400' : 'text-emerald-400';
  const statusBg = hasErrors ? 'bg-rose-500/10' : 'bg-emerald-500/10';
  const statusText = hasErrors ? 'Completed with errors' : 'Success';

  return (
    <div className={`rounded-xl border ${borderColor} bg-gray-900/50 overflow-hidden`}>
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-200">Last Pipeline Run</h2>
        <span className={`px-2.5 py-1 text-xs rounded-full ${statusBg} ${statusColor}`}>
          {statusText}
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-blue-400">{lastRun.productsFound}</p>
            <p className="text-xs text-gray-500 mt-0.5">Products Found</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-400">{lastRun.videosProduced}</p>
            <p className="text-xs text-gray-500 mt-0.5">Videos Produced</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${hasErrors ? 'text-rose-400' : 'text-gray-500'}`}>
              {lastRun.errors.length}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">Errors</p>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-800/50 text-xs text-gray-500 flex justify-between">
          <span>{new Date(lastRun.timestamp).toLocaleString()}</span>
          <span>{timeAgo(lastRun.timestamp)}</span>
        </div>

        {hasErrors && (
          <div className="space-y-1.5">
            {lastRun.errors.map((err, i) => (
              <div key={i} className="px-3 py-2 rounded-lg bg-rose-500/5 text-sm text-rose-300">
                {err}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
