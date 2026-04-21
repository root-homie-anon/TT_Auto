import { getAllState } from '@/lib/state-reader';
import { StatCard } from '@/components/stat-card';
import { PipelineStages } from '@/components/pipeline-stage';
import { ProductTable } from '@/components/product-table';
import { PerformanceTable } from '@/components/performance-table';
import { ResearchLog } from '@/components/research-log';
import { AnalystPanel } from '@/components/analyst-panel';
import { ErrorLog } from '@/components/error-log';
import { LastRunPanel } from '@/components/last-run-panel';
import { RunHealthPanel } from '@/components/run-health';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  const data = getAllState();

  const statusCounts: Record<string, number> = {};
  for (const p of data.productQueue) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  }

  const totalViews = data.posted.reduce((s, v) => s + v.performance.views, 0);
  const totalRevenue = data.posted.reduce((s, v) => s + v.performance.commissionEarned, 0);
  const totalClicks = data.posted.reduce((s, v) => s + v.performance.clicks, 0);

  // Weekly stats
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const thisWeek = data.posted.filter((p) => new Date(p.postedAt) > weekAgo);
  const weeklyViews = thisWeek.reduce((s, v) => s + v.performance.views, 0);
  const weeklyRevenue = thisWeek.reduce((s, v) => s + v.performance.commissionEarned, 0);

  const config = data.config as Record<string, Record<string, unknown>>;
  const maxPerWeek = (config?.['channel'] as Record<string, unknown>)?.['maxVideosPerWeek'] as number ?? 5;
  const pilotActive = (config?.['channel'] as Record<string, unknown>)?.['pilotProgramActive'] as boolean ?? true;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4h6v6H4V4z" fill="white" opacity="0.9"/>
                <path d="M14 4h6v6h-6V4z" fill="white" opacity="0.7"/>
                <path d="M4 14h6v6H4v-6z" fill="white" opacity="0.7"/>
                <path d="M14 14h6v6h-6v-6z" fill="white" opacity="0.5"/>
                <path d="M8 8l8 8M16 8l-8 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-100">TT Auto</h1>
              <p className="text-sm text-gray-500">Health is Wealth Pipeline</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {pilotActive && (
              <span className="px-3 py-1 text-xs rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                Pilot Mode
              </span>
            )}
            {data.lastRun && (
              <span className="text-xs text-gray-500">
                Last run: {new Date(data.lastRun.timestamp).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Stats Overview */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            label="Products Queued"
            value={data.productQueue.length}
            sub={`${statusCounts['queued'] ?? 0} awaiting assets`}
            color="blue"
          />
          <StatCard
            label="Videos Ready"
            value={data.videoQueue.length}
            sub="ready to post"
            color="amber"
          />
          <StatCard
            label="Posted"
            value={data.posted.length}
            sub={`${thisWeek.length}/${maxPerWeek} this week`}
            color="emerald"
          />
          <StatCard
            label="Total Views"
            value={totalViews.toLocaleString()}
            sub={weeklyViews > 0 ? `${weeklyViews.toLocaleString()} this week` : undefined}
            color="cyan"
          />
          <StatCard
            label="Total Clicks"
            value={totalClicks.toLocaleString()}
            sub={totalViews > 0 ? `${(totalClicks / totalViews * 100).toFixed(2)}% CTR` : undefined}
            color="purple"
          />
          <StatCard
            label="Revenue"
            value={`$${totalRevenue.toFixed(2)}`}
            sub={weeklyRevenue > 0 ? `$${weeklyRevenue.toFixed(2)} this week` : undefined}
            color="emerald"
          />
        </section>

        {/* Pipeline Progress + Last Run + Run Health */}
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <PipelineStages counts={statusCounts} />
          </div>
          <LastRunPanel lastRun={data.lastRun} />
          <RunHealthPanel lastRun={data.lastRun} liveRunning={data.liveRunning} />
        </section>

        {/* Product Queue */}
        <section>
          <ProductTable products={data.productQueue} />
        </section>

        {/* Posted Videos Performance */}
        <section>
          <PerformanceTable posted={data.posted} />
        </section>

        {/* Analyst + Research in 2 columns */}
        <section className="grid gap-6 lg:grid-cols-2">
          <AnalystPanel signals={data.analystSignals} />
          <ResearchLog entries={data.researchLog} />
        </section>

        {/* Errors */}
        <section>
          <ErrorLog errors={data.errors} />
        </section>

        {/* Video Queue */}
        {data.videoQueue.length > 0 && (
          <section className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
            <div className="p-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold text-gray-200">Posting Queue</h2>
            </div>
            <div className="divide-y divide-gray-800/50">
              {data.videoQueue.map((v) => (
                <div key={v.productId} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-200">{v.productName}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Suggested: {new Date(v.suggestedPostTime).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {v.hashtags.map((h) => (
                      <span key={h} className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-400">
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6 text-center text-xs text-gray-600">
        Health is Wealth Pipeline Dashboard — Refresh page to update data
      </footer>
    </div>
  );
}
