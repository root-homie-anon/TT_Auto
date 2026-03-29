import { v4 as uuidv4 } from 'uuid';
import { ScrapeCreatorsClient, getSoldCount, getRating, getReviewCount, getImageUrl } from '../shared/scrape-creators-client.js';
import { loadConfig } from '../shared/config.js';
import {
  readProductQueue,
  writeProductQueue,
  readPosted,
  readResearchLog,
  writeResearchLog,
  readAnalystSignals,
  appendError,
} from '../shared/state.js';
import { scoreProduct, meetsMinimumCriteria } from './scorer.js';
import { HEALTH_SEARCH_KEYWORDS, getCategoryForKeyword } from './search-keywords.js';
import type { QueuedProduct, ProductCategory, ResearchLogEntry } from '../shared/types.js';
import type { SCSearchProduct } from '../shared/scrape-creators-client.js';

const DEDUP_WINDOW_DAYS = 30;

function isRecentlyProcessed(productId: string, queue: QueuedProduct[], postedIds: Set<string>): boolean {
  if (postedIds.has(productId)) return true;
  return queue.some((p) => p.tiktokShopId === productId);
}

function buildProductUrl(productId: string): string {
  return `https://www.tiktok.com/shop/pdp/${productId}`;
}

/**
 * Select a subset of keywords to search this run.
 * Rotates through categories, biased toward analyst-recommended ones.
 */
function selectKeywordsForRun(): string[] {
  const signals = readAnalystSignals();
  const allCategories = Object.keys(HEALTH_SEARCH_KEYWORDS);

  let prioritizedCategories: string[];
  if (signals && signals.highPerformingCategories.length > 0) {
    const highPerf = signals.highPerformingCategories as string[];
    const avoid = new Set(signals.avoidCategories as string[]);
    const remaining = allCategories.filter((c) => !highPerf.includes(c) && !avoid.has(c));
    prioritizedCategories = [...highPerf, ...remaining];
  } else {
    prioritizedCategories = allCategories;
  }

  const selected: string[] = [];
  for (const category of prioritizedCategories) {
    const keywords = HEALTH_SEARCH_KEYWORDS[category];
    if (!keywords) continue;
    const shuffled = [...keywords].sort(() => Math.random() - 0.5);
    selected.push(...shuffled.slice(0, 2));
    if (selected.length >= 10) break;
  }

  return selected.slice(0, 10);
}

export async function runResearcher(): Promise<QueuedProduct[]> {
  const config = loadConfig();
  const client = new ScrapeCreatorsClient();
  const existingQueue = readProductQueue();
  const posted = readPosted();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DEDUP_WINDOW_DAYS);
  const recentPostedIds = new Set(
    posted
      .filter((p) => new Date(p.postedAt) > cutoff)
      .map((p) => p.productId),
  );

  const keywords = selectKeywordsForRun();
  const candidates: Array<{
    searchProduct: SCSearchProduct;
    keyword: string;
  }> = [];

  console.log(`[researcher] Searching ${keywords.length} keywords...`);

  // Phase 1: Search for products across keywords
  for (const keyword of keywords) {
    try {
      console.log(`[researcher] Searching: "${keyword}"`);
      const results = await client.searchProducts(keyword);

      if (!results.success || !results.products || results.products.length === 0) {
        console.log(`[researcher] No results for "${keyword}"`);
        continue;
      }

      // Take top products by sold count from each search
      const sorted = [...results.products].sort(
        (a, b) => getSoldCount(b) - getSoldCount(a),
      );

      for (const product of sorted.slice(0, 5)) {
        if (getSoldCount(product) > 0 && !isRecentlyProcessed(product.product_id, existingQueue, recentPostedIds)) {
          candidates.push({ searchProduct: product, keyword });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[researcher] Error searching "${keyword}": ${message}`);
      appendError({
        timestamp: new Date().toISOString(),
        agent: 'researcher',
        message: `Search failed for "${keyword}": ${message}`,
      });
    }
  }

  console.log(`[researcher] Found ${candidates.length} candidates`);

  // Deduplicate by product_id
  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((c) => {
    if (seen.has(c.searchProduct.product_id)) return false;
    seen.add(c.searchProduct.product_id);
    return true;
  });

  console.log(`[researcher] ${uniqueCandidates.length} unique candidates after dedup`);

  // Phase 2: Sort by sold count, fetch details for top candidates
  uniqueCandidates.sort(
    (a, b) => getSoldCount(b.searchProduct) - getSoldCount(a.searchProduct),
  );

  const detailLimit = Math.min(uniqueCandidates.length, config.pipeline.productsPerRun * 3);
  const scoredProducts: Array<{
    product: QueuedProduct;
    logEntry: ResearchLogEntry;
  }> = [];

  const researchLog = readResearchLog();

  for (const candidate of uniqueCandidates.slice(0, detailLimit)) {
    try {
      const productUrl = buildProductUrl(candidate.searchProduct.product_id);
      console.log(`[researcher] Fetching details: ${candidate.searchProduct.title.slice(0, 60)}...`);

      const details = await client.getProductDetails(productUrl, true);

      if (!details.success) {
        console.log(`[researcher] Failed to get details for ${candidate.searchProduct.product_id}`);
        continue;
      }

      const { score, breakdown } = scoreProduct({
        searchProduct: candidate.searchProduct,
        details,
      });

      // Use the shopPerformance breakdown score (rating-based proxy)
      const shopPerf = breakdown.shopPerformance;

      const category = getCategoryForKeyword(candidate.keyword) as ProductCategory;
      const accepted = meetsMinimumCriteria(shopPerf, score);

      const logEntry: ResearchLogEntry = {
        productName: candidate.searchProduct.title,
        tiktokShopId: candidate.searchProduct.product_id,
        score,
        scoreBreakdown: breakdown,
        accepted,
        rejectReason: !accepted
          ? score < config.scoring.minScoreToQueue
            ? `Score ${score} below minimum ${config.scoring.minScoreToQueue}`
            : `Shop quality ${shopPerf} below minimum 80`
          : undefined,
        researchedAt: new Date().toISOString(),
      };

      researchLog.push(logEntry);

      if (accepted) {
        const soldCount = getSoldCount(candidate.searchProduct);
        const product: QueuedProduct = {
          id: uuidv4(),
          productName: candidate.searchProduct.title,
          productUrl: productUrl,
          tiktokShopId: candidate.searchProduct.product_id,
          category,
          commissionRate: null,
          shopPerformanceScore: shopPerf,
          score,
          scoreBreakdown: breakdown,
          researchedAt: new Date().toISOString(),
          status: 'queued',
          soldCount,
          price: `${candidate.searchProduct.product_price_info.currency_symbol}${candidate.searchProduct.product_price_info.sale_price_decimal}`,
          rating: getRating(candidate.searchProduct),
          reviewCount: getReviewCount(candidate.searchProduct),
          sellerName: candidate.searchProduct.seller_info.shop_name,
          imageUrl: getImageUrl(candidate.searchProduct),
        };

        scoredProducts.push({ product, logEntry });
        console.log(`[researcher] Accepted: ${product.productName.slice(0, 50)} (score: ${score})`);
      } else {
        console.log(`[researcher] Rejected: ${candidate.searchProduct.title.slice(0, 50)} (${logEntry.rejectReason})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[researcher] Error fetching details: ${message}`);
      appendError({
        timestamp: new Date().toISOString(),
        agent: 'researcher',
        message: `Detail fetch failed: ${message}`,
        productId: candidate.searchProduct.product_id,
      });
    }
  }

  // Sort by score descending, take top N
  scoredProducts.sort((a, b) => b.product.score - a.product.score);
  const topProducts = scoredProducts
    .slice(0, config.pipeline.productsPerRun)
    .map((sp) => sp.product);

  // Write results
  if (topProducts.length > 0) {
    const updatedQueue = [...existingQueue, ...topProducts];
    writeProductQueue(updatedQueue);
    console.log(`[researcher] Queued ${topProducts.length} products`);
  } else {
    console.log('[researcher] No products met criteria this run');
  }

  writeResearchLog(researchLog);

  return topProducts;
}
