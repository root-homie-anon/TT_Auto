import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, getProjectRoot } from '../shared/config.js';
import {
  readProductQueue,
  writeProductQueue,
  readVideoQueue,
  writeVideoQueue,
  readPosted,
  writePosted,
} from '../shared/state.js';
import type { QueuedProduct, VideoQueueItem, PostedVideo } from '../shared/types.js';

function readyDir(productId: string): string {
  const dir = resolve(getProjectRoot(), 'output', 'ready', productId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getPostsThisWeek(): PostedVideo[] {
  const posted = readPosted();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  return posted.filter((p) => new Date(p.postedAt) > weekAgo);
}

function isAtPostingLimit(): boolean {
  const config = loadConfig();
  const postsThisWeek = getPostsThisWeek();
  return postsThisWeek.length >= config.channel.maxVideosPerWeek;
}

function getNextPostingTime(): string {
  const config = loadConfig();
  const now = new Date();

  // Find the next optimal time that's at least minHoursBetweenPosts after last post
  const posted = readPosted();
  const lastPost = posted.length > 0
    ? new Date(posted[posted.length - 1]!.postedAt)
    : new Date(0);

  const minGap = config.posting.minHoursBetweenPosts * 60 * 60 * 1000;
  const earliestNext = new Date(lastPost.getTime() + minGap);
  const effectiveStart = earliestNext > now ? earliestNext : now;

  // Find next optimal time slot
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    for (const timeStr of config.posting.optimalTimes) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      const candidate = new Date(effectiveStart);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setHours(hours!, minutes!, 0, 0);

      if (candidate > effectiveStart) {
        return candidate.toISOString();
      }
    }
  }

  // Fallback: tomorrow at first optimal time
  const fallback = new Date(effectiveStart);
  fallback.setDate(fallback.getDate() + 1);
  const [h, m] = (config.posting.optimalTimes[0] ?? '07:00').split(':').map(Number);
  fallback.setHours(h!, m!, 0, 0);
  return fallback.toISOString();
}

export function buildPostingPackage(product: QueuedProduct, videoPath: string): VideoQueueItem | null {
  if (isAtPostingLimit()) {
    console.log('[content-manager] Weekly posting limit reached — holding in queue');
    return null;
  }

  const dir = readyDir(product.tiktokShopId);

  // Copy video to ready folder
  const destVideo = resolve(dir, 'video.mp4');
  if (existsSync(videoPath)) {
    copyFileSync(videoPath, destVideo);
  }

  // Generate caption
  const hashtags = [
    '#tiktokshop',
    '#healthiswealth',
    `#${product.category.replace(/-/g, '')}`,
    '#healthfinds',
    '#tiktokmademebuyit',
    '#wellness',
  ];

  const caption = `${product.productName}\n\n🔗 Link in bio or search TikTok Shop\n\n${hashtags.join(' ')}`;

  // Write caption file
  writeFileSync(resolve(dir, 'caption.txt'), caption, 'utf-8');

  // Write product link
  writeFileSync(resolve(dir, 'product-link.txt'), product.productUrl, 'utf-8');

  // Write posting notes
  const suggestedTime = getNextPostingTime();
  const notes = [
    `Product: ${product.productName}`,
    `Category: ${product.category}`,
    `Score: ${product.score}`,
    `Suggested post time: ${new Date(suggestedTime).toLocaleString()}`,
    `Shop performance: ${product.shopPerformanceScore}%`,
    '',
    'Posting checklist:',
    '- [ ] Add TikTok Shop product link',
    '- [ ] Verify video plays correctly',
    '- [ ] Copy caption from caption.txt',
    '- [ ] Post at suggested time for best reach',
  ].join('\n');
  writeFileSync(resolve(dir, 'posting-notes.txt'), notes, 'utf-8');

  const item: VideoQueueItem = {
    productId: product.tiktokShopId,
    productName: product.productName,
    videoPath: destVideo,
    caption,
    hashtags,
    productLink: product.productUrl,
    suggestedPostTime: suggestedTime,
    status: 'post_ready',
    queuedAt: new Date().toISOString(),
  };

  // Add to video queue
  const videoQueue = readVideoQueue();
  videoQueue.push(item);
  writeVideoQueue(videoQueue);

  // Update product status
  const queue = readProductQueue();
  const idx = queue.findIndex((p) => p.id === product.id);
  if (idx !== -1) {
    queue[idx]!.status = 'post_ready';
    writeProductQueue(queue);
  }

  console.log(`[content-manager] ✓ Posting package ready: ${product.productName.slice(0, 50)}`);
  return item;
}

export function markAsPosted(productId: string, tiktokVideoUrl: string): void {
  const videoQueue = readVideoQueue();
  const item = videoQueue.find((v) => v.productId === productId);
  if (!item) {
    console.error(`[content-manager] Product ${productId} not found in video queue`);
    return;
  }

  // Add to posted log
  const posted = readPosted();
  const entry: PostedVideo = {
    productId: item.productId,
    productName: item.productName,
    postedAt: new Date().toISOString(),
    tiktokVideoUrl,
    caption: item.caption,
    performance: {
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      clicks: 0,
      conversions: 0,
      commissionEarned: 0,
    },
  };
  posted.push(entry);
  writePosted(posted);

  // Remove from video queue
  const updated = videoQueue.filter((v) => v.productId !== productId);
  writeVideoQueue(updated);

  // Update product status
  const queue = readProductQueue();
  const idx = queue.findIndex((p) => p.tiktokShopId === productId);
  if (idx !== -1) {
    queue[idx]!.status = 'posted';
    writeProductQueue(queue);
  }

  console.log(`[content-manager] ✓ Marked as posted: ${item.productName.slice(0, 50)}`);
}

export function getDailyBriefing(): string {
  const config = loadConfig();
  const videoQueue = readVideoQueue();
  const postsThisWeek = getPostsThisWeek();
  const remaining = config.channel.maxVideosPerWeek - postsThisWeek.length;

  const lines: string[] = [
    '--- Daily Briefing ---',
    `Videos ready to post: ${videoQueue.length}`,
    `Posted this week: ${postsThisWeek.length}/${config.channel.maxVideosPerWeek}`,
    `Remaining slots: ${remaining}`,
  ];

  if (videoQueue.length > 0) {
    const next = videoQueue[0]!;
    lines.push(`Next up: ${next.productName.slice(0, 50)}`);
    lines.push(`Suggested time: ${new Date(next.suggestedPostTime).toLocaleString()}`);
  }

  if (remaining === 0) {
    const resetDate = new Date();
    resetDate.setDate(resetDate.getDate() + (7 - resetDate.getDay()));
    lines.push(`Limit resets: ${resetDate.toLocaleDateString()}`);
  }

  return lines.join('\n');
}
