import type { PipelineError } from '@/lib/state-reader';

export function ErrorLog({ errors }: { errors: PipelineError[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 overflow-hidden">
      <div className="p-4 border-b border-rose-500/10">
        <h2 className="text-lg font-semibold text-rose-400">
          Errors ({errors.length})
        </h2>
      </div>
      <div className="max-h-64 overflow-y-auto divide-y divide-rose-500/10">
        {[...errors].reverse().map((e, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-mono">
                {e.agent}
              </span>
              <span>{new Date(e.timestamp).toLocaleString()}</span>
              {e.productId && (
                <span className="text-gray-600 font-mono">{e.productId.slice(0, 12)}...</span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-400">{e.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
