import type { LastRun, PipelineStage } from '@/lib/state-reader';

// ─── Stage config ────────────────────────────────────────────────────────────

const STAGE_CONFIG: Record<
  PipelineStage,
  { label: string; textColor: string; bgColor: string; borderColor: string }
> = {
  research: {
    label: 'Research',
    textColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
  },
  assets: {
    label: 'Assets',
    textColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
  },
  script: {
    label: 'Script',
    textColor: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
  },
  video: {
    label: 'Video',
    textColor: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
  },
  package: {
    label: 'Package',
    textColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
  },
  analyst: {
    label: 'Analyst',
    textColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
  },
  done: {
    label: 'Done',
    textColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
  },
  failed: {
    label: 'Failed',
    textColor: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Formats a millisecond duration into "Xh Ym Zs" — omitting leading zero
 * segments unless the duration is under a minute.
 */
function formatElapsed(ms: number): string {
  if (ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function computeElapsed(lastRun: LastRun, liveRunning: boolean): string {
  if (liveRunning && lastRun.stageStartedAt) {
    // Live: measure from when the current stage started
    return formatElapsed(Date.now() - new Date(lastRun.stageStartedAt).getTime());
  }
  // Final: measure full run duration if we have start + stage-started-at
  // Use timestamp (run start) to stageStartedAt as a proxy for "last stage ended"
  // If stageStartedAt is present and the run isn't live, we know the run finished
  if (lastRun.stageStartedAt) {
    return formatElapsed(
      new Date(lastRun.stageStartedAt).getTime() - new Date(lastRun.timestamp).getTime(),
    );
  }
  return '—';
}

// ─── Component ───────────────────────────────────────────────────────────────

interface RunHealthProps {
  lastRun: LastRun | null;
  liveRunning: boolean;
}

export function RunHealthPanel({ lastRun, liveRunning }: RunHealthProps) {
  // ── Empty state ────────────────────────────────────────────────────────────
  if (!lastRun) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
        <h2 className="text-lg font-semibold text-gray-200">Run Health</h2>
        <p className="mt-2 text-sm text-gray-500">No runs recorded yet.</p>
      </div>
    );
  }

  const stage = lastRun.currentStage ?? 'done';
  const stageCfg = STAGE_CONFIG[stage];
  const elapsed = computeElapsed(lastRun, liveRunning);

  const successCount = lastRun.successCount ?? lastRun.videosProduced ?? 0;
  const failCount = lastRun.failCount ?? lastRun.errors.length;

  // Panel border reflects live vs final vs failed state
  const panelBorder = liveRunning
    ? 'border-emerald-500/30'
    : stage === 'failed'
      ? 'border-rose-500/30'
      : 'border-gray-800';

  return (
    <div className={`rounded-xl border ${panelBorder} bg-gray-900/50 overflow-hidden`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-200">Run Health</h2>

        {liveRunning ? (
          /* Live indicator — single pulsing dot, respects prefers-reduced-motion */
          <span className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-xs text-emerald-400 font-medium">Live</span>
          </span>
        ) : (
          <span
            className={`px-2.5 py-1 text-xs rounded-full border ${stageCfg.bgColor} ${stageCfg.textColor} ${stageCfg.borderColor}`}
          >
            {stage === 'failed' ? 'Failed' : 'Completed'}
          </span>
        )}
      </div>

      {/* ── Metrics row ─────────────────────────────────────────────────── */}
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          {/* Last run timestamp */}
          <div>
            <p className="text-xl font-bold text-gray-200 tabular-nums">
              {new Date(lastRun.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {timeAgo(lastRun.timestamp)}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">started</p>
          </div>

          {/* Elapsed */}
          <div>
            <p className="text-xl font-bold text-cyan-400 tabular-nums">{elapsed}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {liveRunning ? 'in stage' : 'run time'}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">elapsed</p>
          </div>

          {/* Current stage badge */}
          <div className="flex flex-col items-center justify-center gap-1">
            <span
              className={`px-2.5 py-1 text-xs font-medium rounded-full border ${stageCfg.bgColor} ${stageCfg.textColor} ${stageCfg.borderColor}`}
            >
              {stageCfg.label}
            </span>
            <p className="text-xs text-gray-600">
              {liveRunning ? 'active stage' : 'last stage'}
            </p>
          </div>
        </div>

        {/* ── Success / Fail counts ─────────────────────────────────────── */}
        <div className="pt-3 border-t border-gray-800/60 grid grid-cols-2 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-emerald-400">{successCount}</p>
            <p className="text-xs text-gray-500 mt-0.5">successful</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${failCount > 0 ? 'text-rose-400' : 'text-gray-600'}`}>
              {failCount}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">failed</p>
          </div>
        </div>

        {/* ── Timestamp footer ──────────────────────────────────────────── */}
        <div className="pt-2 border-t border-gray-800/50 text-xs text-gray-600 flex justify-between">
          <span>{new Date(lastRun.timestamp).toLocaleDateString()}</span>
          {lastRun.stageStartedAt && (
            <span>
              stage at {new Date(lastRun.stageStartedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
