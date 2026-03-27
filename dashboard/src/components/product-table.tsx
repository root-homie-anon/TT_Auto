import type { QueuedProduct } from '@/lib/state-reader';

const statusBadge: Record<string, string> = {
  queued: 'bg-blue-500/20 text-blue-300',
  assets_ready: 'bg-cyan-500/20 text-cyan-300',
  assets_failed: 'bg-rose-500/20 text-rose-300',
  script_ready: 'bg-purple-500/20 text-purple-300',
  video_ready: 'bg-amber-500/20 text-amber-300',
  post_ready: 'bg-emerald-500/20 text-emerald-300',
  posted: 'bg-green-500/20 text-green-300',
};

function ScoreBar({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-gray-500 shrink-0">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-gray-800">
        <div
          className="h-full rounded-full bg-emerald-500/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 text-right text-gray-400">{value}</span>
    </div>
  );
}

export function ProductTable({ products }: { products: QueuedProduct[] }) {
  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center text-gray-500">
        No products in queue. Run the researcher to discover products.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold text-gray-200">Product Queue</h2>
      </div>
      <div className="divide-y divide-gray-800/50">
        {products.map((p) => (
          <div key={p.id} className="p-4 hover:bg-gray-800/30 transition-colors">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3 min-w-0">
                {p.imageUrl && (
                  <img
                    src={p.imageUrl}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover shrink-0 bg-gray-800"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium text-gray-200 truncate">{p.productName}</p>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                    <span>{p.price}</span>
                    <span className="text-gray-600">|</span>
                    <span>{p.soldCount.toLocaleString()} sold</span>
                    <span className="text-gray-600">|</span>
                    <span>{p.category}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500">{p.sellerName}</span>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${statusBadge[p.status] ?? 'bg-gray-700 text-gray-300'}`}>
                      {p.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-bold text-emerald-400">{p.score}</p>
                <p className="text-xs text-gray-500">score</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              <ScoreBar label="Sales" value={p.scoreBreakdown.salesVelocity} />
              <ScoreBar label="Shop" value={p.scoreBreakdown.shopPerformance} />
              <ScoreBar label="Video" value={p.scoreBreakdown.videoEngagement} />
              <ScoreBar label="Assets" value={p.scoreBreakdown.assetAvailability} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
