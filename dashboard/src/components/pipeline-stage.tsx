const stageConfig: Record<string, { label: string; color: string; bg: string }> = {
  queued: { label: 'Queued', color: 'text-blue-400', bg: 'bg-blue-500' },
  assets_ready: { label: 'Assets Ready', color: 'text-cyan-400', bg: 'bg-cyan-500' },
  assets_failed: { label: 'Assets Failed', color: 'text-rose-400', bg: 'bg-rose-500' },
  script_ready: { label: 'Script Ready', color: 'text-purple-400', bg: 'bg-purple-500' },
  video_ready: { label: 'Video Ready', color: 'text-amber-400', bg: 'bg-amber-500' },
  post_ready: { label: 'Post Ready', color: 'text-emerald-400', bg: 'bg-emerald-500' },
  posted: { label: 'Posted', color: 'text-green-400', bg: 'bg-green-500' },
};

export function PipelineStages({ counts }: { counts: Record<string, number> }) {
  const stages = ['queued', 'assets_ready', 'script_ready', 'video_ready', 'post_ready', 'posted'];
  const total = Object.values(counts).reduce((s, c) => s + c, 0) || 1;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-200">Pipeline Stages</h2>
      <div className="flex gap-1 mb-4 h-3 rounded-full overflow-hidden bg-gray-800">
        {stages.map((stage) => {
          const count = counts[stage] ?? 0;
          if (count === 0) return null;
          const cfg = stageConfig[stage]!;
          return (
            <div
              key={stage}
              className={`${cfg.bg} transition-all`}
              style={{ width: `${(count / total) * 100}%` }}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {stages.map((stage) => {
          const cfg = stageConfig[stage]!;
          const count = counts[stage] ?? 0;
          return (
            <div key={stage} className="text-center">
              <p className={`text-2xl font-bold ${cfg.color}`}>{count}</p>
              <p className="text-xs text-gray-500">{cfg.label}</p>
            </div>
          );
        })}
      </div>
      {(counts['assets_failed'] ?? 0) > 0 && (
        <div className="mt-3 text-center">
          <span className="text-sm text-rose-400">
            {counts['assets_failed']} failed
          </span>
        </div>
      )}
    </div>
  );
}
