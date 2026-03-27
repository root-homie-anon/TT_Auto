import { loadConfig } from '../shared/config.js';
import {
  readPosted,
  writePosted,
  readResearchLog,
  writeAnalystSignals,
} from '../shared/state.js';
import type {
  PostedVideo,
  VideoPerformance,
  AnalystSignals,
  ProductCategory,
} from '../shared/types.js';

interface VideoMetrics {
  engagementRate: number;
  clickThroughRate: number;
  conversionRate: number;
  revenuePerView: number;
}

function calculateMetrics(perf: VideoPerformance): VideoMetrics {
  const views = perf.views || 1; // avoid division by zero
  const clicks = perf.clicks || 1;

  return {
    engagementRate: (perf.likes + perf.comments + perf.shares) / views,
    clickThroughRate: perf.clicks / views,
    conversionRate: perf.conversions / clicks,
    revenuePerView: perf.commissionEarned / views,
  };
}

export function updatePerformance(
  productId: string,
  performance: Partial<VideoPerformance>,
): void {
  const posted = readPosted();
  const idx = posted.findIndex((p) => p.productId === productId);
  if (idx === -1) {
    console.error(`[analyst] Product ${productId} not found in posted log`);
    return;
  }

  const existing = posted[idx]!;
  existing.performance = {
    ...existing.performance,
    ...performance,
  };
  writePosted(posted);
  console.log(`[analyst] Updated performance for: ${existing.productName.slice(0, 50)}`);
}

export function analyzePerformance(): void {
  const posted = readPosted();
  const withData = posted.filter((p) => p.performance.views > 0);

  if (withData.length === 0) {
    console.log('[analyst] No performance data available yet');
    return;
  }

  console.log('\n--- Performance Analysis ---\n');

  // Calculate metrics for each video
  const analyzed = withData.map((video) => ({
    video,
    metrics: calculateMetrics(video.performance),
  }));

  // Sort by engagement rate
  analyzed.sort((a, b) => b.metrics.engagementRate - a.metrics.engagementRate);

  // Top performer
  const top = analyzed[0]!;
  console.log(`Best performer: ${top.video.productName.slice(0, 50)}`);
  console.log(`  Views: ${top.video.performance.views.toLocaleString()}`);
  console.log(`  Engagement: ${(top.metrics.engagementRate * 100).toFixed(2)}%`);
  console.log(`  CTR: ${(top.metrics.clickThroughRate * 100).toFixed(2)}%`);
  console.log(`  Revenue: $${top.video.performance.commissionEarned.toFixed(2)}`);

  // Worst performer
  if (analyzed.length > 1) {
    const worst = analyzed[analyzed.length - 1]!;
    console.log(`\nWorst performer: ${worst.video.productName.slice(0, 50)}`);
    console.log(`  Views: ${worst.video.performance.views.toLocaleString()}`);
    console.log(`  Engagement: ${(worst.metrics.engagementRate * 100).toFixed(2)}%`);
  }

  // Totals
  const totalViews = withData.reduce((s, v) => s + v.performance.views, 0);
  const totalRevenue = withData.reduce((s, v) => s + v.performance.commissionEarned, 0);
  console.log(`\nTotal views: ${totalViews.toLocaleString()}`);
  console.log(`Total revenue: $${totalRevenue.toFixed(2)}`);
  console.log(`Avg revenue/view: $${(totalRevenue / totalViews).toFixed(4)}`);
}

export function generateSignals(): AnalystSignals {
  const posted = readPosted();
  const withData = posted.filter((p) => p.performance.views > 0);

  const signals: AnalystSignals = {
    updatedAt: new Date().toISOString(),
    highPerformingCategories: [],
    avoidCategories: [],
    winningFormats: [],
    winningHookPatterns: [],
    minCommissionRateThreshold: 0,
    notes: '',
  };

  if (withData.length < 3) {
    signals.notes = 'Insufficient data — need at least 3 videos with performance data';
    writeAnalystSignals(signals);
    return signals;
  }

  // Analyze by inferring category from product name keywords
  const categoryPerformance = new Map<string, { totalEngagement: number; count: number }>();

  for (const video of withData) {
    const metrics = calculateMetrics(video.performance);
    // Simple category inference from product name
    const name = video.productName.toLowerCase();
    let category: ProductCategory = 'general-health';
    if (name.match(/vitamin|supplement|collagen|protein|probiotic|magnesium/)) {
      category = 'supplements';
    } else if (name.match(/band|tracker|mat|roller|kettlebell|grip/)) {
      category = 'fitness-tools';
    } else if (name.match(/massag|compress|brace|tens|stretch|posture/)) {
      category = 'recovery';
    } else if (name.match(/sleep|melatonin|blanket|mask|noise|pillow/)) {
      category = 'sleep-wellness';
    } else if (name.match(/weight|fat|meal|scale|waist|fiber|detox/)) {
      category = 'weight-management';
    }

    const existing = categoryPerformance.get(category) ?? { totalEngagement: 0, count: 0 };
    existing.totalEngagement += metrics.engagementRate;
    existing.count += 1;
    categoryPerformance.set(category, existing);
  }

  // Find high and low performing categories
  const categoryScores = [...categoryPerformance.entries()]
    .map(([cat, data]) => ({
      category: cat as ProductCategory,
      avgEngagement: data.totalEngagement / data.count,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  if (categoryScores.length > 0) {
    const median = categoryScores[Math.floor(categoryScores.length / 2)]!.avgEngagement;
    signals.highPerformingCategories = categoryScores
      .filter((c) => c.avgEngagement > median * 1.2)
      .map((c) => c.category);
    signals.avoidCategories = categoryScores
      .filter((c) => c.avgEngagement < median * 0.5)
      .map((c) => c.category);
  }

  // Revenue threshold
  const revenues = withData.map((v) => v.performance.commissionEarned).sort((a, b) => a - b);
  if (revenues.length > 0) {
    const p25 = revenues[Math.floor(revenues.length * 0.25)] ?? 0;
    signals.notes = `Bottom quartile revenue: $${p25.toFixed(2)}. Consider filtering products with lower commission potential.`;
  }

  writeAnalystSignals(signals);
  console.log('[analyst] ✓ Signals updated for researcher feedback loop');
  return signals;
}

export function getWeeklyReport(): string {
  const config = loadConfig();
  const posted = readPosted();

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const thisWeek = posted.filter((p) => new Date(p.postedAt) > weekAgo);

  const totalViews = thisWeek.reduce((s, v) => s + v.performance.views, 0);
  const totalRevenue = thisWeek.reduce((s, v) => s + v.performance.commissionEarned, 0);

  const withViews = thisWeek.filter((v) => v.performance.views > 0);
  const best = withViews.length > 0
    ? withViews.sort((a, b) => b.performance.views - a.performance.views)[0]!
    : null;

  const lines = [
    '=============================',
    '  WEEKLY REPORT — Health is Wealth',
    '=============================',
    '',
    `Videos posted: ${thisWeek.length}/${config.channel.maxVideosPerWeek}`,
    `Total views: ${totalViews.toLocaleString()}`,
    `Total commission: $${totalRevenue.toFixed(2)}`,
    '',
  ];

  if (best) {
    lines.push(`Best video: ${best.productName.slice(0, 50)}`);
    lines.push(`  Views: ${best.performance.views.toLocaleString()}`);
    lines.push(`  Commission: $${best.performance.commissionEarned.toFixed(2)}`);
  }

  // Pilot program status
  if (config.channel.pilotProgramActive) {
    lines.push('');
    lines.push('Pilot program: ACTIVE');
    lines.push(`Total videos posted (all time): ${posted.length}`);
  }

  return lines.join('\n');
}
