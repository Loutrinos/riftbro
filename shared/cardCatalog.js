// shared/cardCatalog.js
// Single source-of-truth for the card catalog.
// Fetches https://riftboundindex.com/api/cards?pageSize=10000 once per 24 h,
// then serves every subsequent call from localStorage (rb_cards).
// All apps (app, scan, give, match) should import from here instead of
// hitting the API themselves.

const CATALOG_URL = 'https://riftboundindex.com/api/cards?pageSize=10000';
const STORAGE_KEY = 'rb_cards';
const STORAGE_TS  = 'rb_cards_ts';
const TTL_MS      = 24 * 60 * 60 * 1000; // 24 hours

// Sort cards by set code (alphabetical) then collector number (ascending)
// so every set — including newly added ones like UNL — appears in order.
function sortCards(cards) {
  cards.sort((a, b) => {
    const setA = a.set?.value?.id ?? '';
    const setB = b.set?.value?.id ?? '';
    if (setA < setB) return -1;
    if (setA > setB) return  1;
    return (a.collectorNumber ?? 0) - (b.collectorNumber ?? 0);
  });
}

/**
 * Returns the full card catalog array.
 * Reads from localStorage when the cache is fresh (< 24 h old);
 * otherwise fetches from the API, saves the result, then returns it.
 *
 * @param {{ bust?: boolean }} [options]
 *   bust – set to true to skip the cache and force a fresh fetch.
 * @returns {Promise<Array>} array of card objects from riftboundindex.com
 */
export async function getCardCatalog({ bust = false } = {}) {
  if (!bust) {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ts  = localStorage.getItem(STORAGE_TS);
    if (raw && ts && Date.now() - Number(ts) < TTL_MS) {
      try {
        const cards = JSON.parse(raw);
        if (Array.isArray(cards) && cards.length > 0) {
          sortCards(cards);
          return cards;
        }
      } catch (_) { /* corrupt cache — fall through to fetch */ }
    }
  }

  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`Card catalog fetch failed: HTTP ${res.status}`);

  const data  = await res.json();
  const cards = data.cards ?? (Array.isArray(data) ? data : []);

  if (cards.length === 0) throw new Error('Card catalog returned 0 cards');

  sortCards(cards);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  localStorage.setItem(STORAGE_TS,  String(Date.now()));

  return cards;
}

/**
 * Clears the cached card catalog so that the next getCardCatalog() call
 * triggers a fresh fetch.  Useful for a manual "refresh" button.
 */
export function clearCardCatalogCache() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_TS);
}
