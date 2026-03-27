import type { PostedVideo } from '@/lib/state-reader';

export function PerformanceTable({ posted }: { posted: PostedVideo[] }) {
  if (posted.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center text-gray-500">
        No posted videos yet.
      </div>
    );
  }

  const totalViews = posted.reduce((s, v) => s + v.performance.views, 0);
  const totalRevenue = posted.reduce((s, v) => s + v.performance.commissionEarned, 0);
  const totalClicks = posted.reduce((s, v) => s + v.performance.clicks, 0);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-200">Posted Videos</h2>
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">
            {totalViews.toLocaleString()} views
          </span>
          <span className="text-emerald-400 font-medium">
            ${totalRevenue.toFixed(2)} earned
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium text-right">Views</th>
              <th className="px-4 py-3 font-medium text-right">Likes</th>
              <th className="px-4 py-3 font-medium text-right">Comments</th>
              <th className="px-4 py-3 font-medium text-right">Shares</th>
              <th className="px-4 py-3 font-medium text-right">Clicks</th>
              <th className="px-4 py-3 font-medium text-right">Conv.</th>
              <th className="px-4 py-3 font-medium text-right">Revenue</th>
              <th className="px-4 py-3 font-medium text-right">Posted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {posted.map((v) => {
              const engRate = v.performance.views > 0
                ? ((v.performance.likes + v.performance.comments + v.performance.shares) / v.performance.views * 100)
                : 0;
              const ctr = v.performance.views > 0
                ? (v.performance.clicks / v.performance.views * 100)
                : 0;

              return (
                <tr key={v.productId} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-200 truncate max-w-[250px]">
                      {v.productName}
                    </p>
                    <div className="flex gap-2 mt-0.5 text-xs text-gray-500">
                      <span>Eng: {engRate.toFixed(1)}%</span>
                      <span>CTR: {ctr.toFixed(2)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {v.performance.views.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    {v.performance.likes.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    {v.performance.comments.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">
                    {v.performance.shares.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-blue-400">
                    {v.performance.clicks.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-purple-400">
                    {v.performance.conversions}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-medium">
                    ${v.performance.commissionEarned.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs">
                    {new Date(v.postedAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-700 text-gray-300 font-medium">
              <td className="px-4 py-3">Totals ({posted.length} videos)</td>
              <td className="px-4 py-3 text-right">{totalViews.toLocaleString()}</td>
              <td className="px-4 py-3 text-right">
                {posted.reduce((s, v) => s + v.performance.likes, 0).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                {posted.reduce((s, v) => s + v.performance.comments, 0).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right">
                {posted.reduce((s, v) => s + v.performance.shares, 0).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right text-blue-400">
                {totalClicks.toLocaleString()}
              </td>
              <td className="px-4 py-3 text-right text-purple-400">
                {posted.reduce((s, v) => s + v.performance.conversions, 0)}
              </td>
              <td className="px-4 py-3 text-right text-emerald-400">
                ${totalRevenue.toFixed(2)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
