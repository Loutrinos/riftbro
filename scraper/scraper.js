// scraper.js — Cardmarket price scraper for Riftbound cards
// Usage:  node scraper.js          (run once, no cron)
//         node scraper.js --cron   (run now + schedule daily at 3 AM)
//
// Phase 1: Scrapes index pages for each set to discover ground-truth card URLs
//          (handles special characters, variant names, promos automatically)
// Phase 2: Fetches each product page and extracts low / trend / 30-day avg
// Output:  prices.json — one entry per Cardmarket product, written after each card
// Resume:  entries younger than STALENESS_MS are skipped on re-run

import { chromium }                              from 'playwright';
import { load }                                  from 'cheerio';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname }                         from 'path';
import { fileURLToPath }                         from 'url';
import cron                                      from 'node-cron';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const BASE         = 'https://www.cardmarket.com';
const STALENESS_MS = 20 * 60 * 60 * 1000;   // skip entries fresher than 20 h
const URL_CACHE_MS = 24 * 60 * 60 * 1000;   // re-discover URLs every 24 h

// Riftbound sets present on Cardmarket
const SETS = [
  'Origins',
  'Spiritforged',
  'Proving-Grounds',
  'Origins-Promos',
];

const PRICES_FILE    = join(__dirname, 'prices.json');
const URL_CACHE_FILE = join(__dirname, 'card-urls.json');

// ── Utilities ─────────────────────────────────────────────────────────────────

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const jitter = ()  => sleep(2000 + Math.random() * 2000); // 2–4 s between requests

function loadJSON(file, fallback) {
  if (!existsSync(file)) return fallback;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function saveJSON(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// Parse EU price format: "1,87 €" → 1.87
function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/[€\s]/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

// ── Browser helper ────────────────────────────────────────────────────────────
// Navigates to url and returns the final rendered HTML.
// Retries on 429 / 503 with exponential backoff.

async function getHtml(page, url, attempt = 1) {
  const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  const status = res?.status() ?? 0;

  if ((status === 429 || status === 503) && attempt < 4) {
    const wait = attempt * 30_000;
    console.warn(`  ⚠  HTTP ${status} — retrying in ${wait / 1000}s…`);
    await sleep(wait);
    return getHtml(page, url, attempt + 1);
  }

  return { html: await page.content(), status };
}

// ── Phase 1: Discover card URLs ───────────────────────────────────────────────
// Fetches each set's index pages (paginated via ?site=N).
// Stops when a page yields no new card links, then moves to the next set.

async function discoverSetUrls(page, setSlug) {
  const setPath   = `/en/Riftbound/Products/Singles/${setSlug}`;
  const prefix    = `${BASE}/en/Riftbound/Products/Singles/${setSlug}/`;
  const seen      = new Set();
  let p           = 1;

  while (true) {
    const url = `${BASE}${setPath}?site=${p}`;
    console.log(`  [index] ${setSlug} page ${p}`);

    const { status } = await getHtml(page, url);
    if (status === 429 || status === 503) break;

    // Extract hrefs directly from the live DOM — catches JS-rendered links too
    const hrefs = await page.$$eval('a[href]', els => els.map(el => el.href));
    const cardLinks = hrefs.filter(h => h.startsWith(prefix) && !h.includes('?'));

    let added = 0;
    for (const href of cardLinks) {
      if (!seen.has(href)) { seen.add(href); added++; }
    }

    if (added === 0) break; // no new links — end of pagination
    p++;
    await jitter();
  }

  return [...seen];
}

async function discoverAllUrls(page) {
  const cache = loadJSON(URL_CACHE_FILE, null);
  if (cache?.fetchedAt && Date.now() - new Date(cache.fetchedAt).getTime() < URL_CACHE_MS) {
    console.log(`[discover] Cache hit — ${cache.urls.length} cards (fetched ${cache.fetchedAt})`);
    return cache.urls;
  }

  console.log('[discover] Scraping Cardmarket index pages…');
  const all = [];
  for (const setSlug of SETS) {
    const urls = await discoverSetUrls(page, setSlug);
    console.log(`  [index] ${setSlug}: ${urls.length} cards`);
    all.push(...urls);
  }

  saveJSON(URL_CACHE_FILE, { fetchedAt: new Date().toISOString(), urls: all });
  console.log(`[discover] Done — ${all.length} total card URLs\n`);
  return all;
}

// ── Phase 2: Extract prices from a product page ───────────────────────────────
// Cardmarket renders prices in a <dl> with <dt>/<dd> pairs:
//   <dt>From</dt>                    <dd>0,95 €</dd>
//   <dt>Price Trend</dt>             <dd>1,87 €</dd>
//   <dt>30-days average price</dt>   <dd>2,30 €</dd>

function extractPrices(html) {
  const $ = load(html);
  const result = {};

  $('dt').each((_, dtEl) => {
    const label = $(dtEl).text().trim().toLowerCase();
    const raw   = $(dtEl).next('dd').text().trim();
    if (label === 'from')              result.low   = parsePrice(raw);
    else if (label === 'price trend')  result.trend = parsePrice(raw);
    else if (label.includes('30-day')) result.avg30 = parsePrice(raw);
  });

  return Object.keys(result).length > 0 ? result : null;
}

// ── Phase 3: Main scrape loop ─────────────────────────────────────────────────

async function scrapeAll() {
  console.log(`\n[scraper] Starting run — ${new Date().toISOString()}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    const urls   = await discoverAllUrls(page);
    const prices = loadJSON(PRICES_FILE, {});

    let scraped = 0, skipped = 0, failed = 0;
    const total = urls.length;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      // Key: "Origins/Stacked-Deck" (set/card-slug — stable across runs)
      const key      = url.replace(`${BASE}/en/Riftbound/Products/Singles/`, '');
      const existing = prices[key];

      if (existing?.fetchedAt && Date.now() - new Date(existing.fetchedAt).getTime() < STALENESS_MS) {
        skipped++;
        continue;
      }

      const priceUrl = `${url}?language=1`;
      process.stdout.write(`[${i + 1}/${total}] ${key}… `);

      try {
        const { html, status } = await getHtml(page, priceUrl);

        const isInvalid = status === 404
          || html.includes('Invalid product')
          || html.includes('invalid product');

        if (isInvalid) {
          console.log('not found');
          prices[key] = { url: priceUrl, notFound: true, fetchedAt: new Date().toISOString() };
          failed++;
        } else {
          const p = extractPrices(html);
          if (p) {
            const parts = [];
            if (p.low   != null) parts.push(`low=${p.low}`);
            if (p.trend != null) parts.push(`trend=${p.trend}`);
            if (p.avg30 != null) parts.push(`avg30=${p.avg30}`);
            console.log(parts.join('  '));
            prices[key] = { url: priceUrl, ...p, fetchedAt: new Date().toISOString() };
            scraped++;
          } else {
            console.log('⚠ price block not found');
            prices[key] = { url: priceUrl, notFound: true, fetchedAt: new Date().toISOString() };
            failed++;
          }
        }
      } catch (err) {
        console.log(`✗ ${err.message}`);
        failed++;
      }

      // Write after every card — safe to kill and restart at any point
      saveJSON(PRICES_FILE, prices);
      await jitter();
    }

    console.log(`\n[scraper] Done — scraped: ${scraped}  skipped: ${skipped}  failed: ${failed}\n`);
  } finally {
    await browser.close();
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

const withCron = process.argv.includes('--cron');

if (withCron) {
  // Schedule daily at 3:00 AM, then also run immediately
  cron.schedule('0 3 * * *', () => {
    scrapeAll().catch(err => console.error('[scraper] Cron run failed:', err.message));
  });
  console.log('[scraper] Cron scheduled — daily at 03:00. Running now…');
}

scrapeAll().catch(err => {
  console.error('[scraper] Fatal:', err.message);
  process.exit(1);
});




