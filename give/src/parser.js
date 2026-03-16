const API_BASE = 'https://api.dotgg.gg/cgfw/getuserdata?game=riftbound';
const API_DEV  = '/api-proxy/cgfw/getuserdata?game=riftbound';

async function fetchCollection(username) {
  const encoded = encodeURIComponent(`${API_BASE}&username=${encodeURIComponent(username)}`);
  if (import.meta.env.DEV) {
    return fetch(`${API_DEV}&username=${encodeURIComponent(username)}`);
  }
  const proxies = [
    `https://api.codetabs.com/v1/proxy/?quest=${encoded}`,
    `https://corsproxy.io/?${encoded}`,
    `https://corsproxy.org/?url=${encoded}`,
  ];
  for (const url of proxies) {
    try { const r = await fetch(url); if (r.ok) return r; } catch (_) {}
  }
  throw new Error('Could not reach the collection API. All proxies failed.');
}

/**
 * Fetches a user's full collection from the dotgg API via a CORS proxy.
 * The response includes a `collection` array with per-card trade/wish quantities.
 *
 * @param {string} username - e.g. "Kyle Grech"
 * @returns {Promise<{ tradeMap: Map, wishlistMap: Map }>}
 *   Each Map is keyed by card ID (e.g. "OGN-001") with { quantity, imageUrl, cardUrl }
 */
export async function fetchUserList(username) {
  let res;
  try {
    res = await fetchCollection(username);
  } catch (err) {
    throw new Error(`Network error fetching data for "${username}": ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`API returned HTTP ${res.status} for "${username}"`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Invalid JSON response for "${username}"`);
  }

  if (!data.collection || !Array.isArray(data.collection)) {
    throw new Error(`No collection data found for "${username}". Check the username is correct.`);
  }

  return buildMaps(data.collection, username);
}

/**
 * Splits the flat collection array into two Maps:
 *  - tradeMap: cards with trade > 0
 *  - wishlistMap: cards with wish > 0
 *
 * Skips promo variants (IDs ending in "-P").
 */
function buildMaps(collection, username) {
  const tradeMap = new Map();
  const wishlistMap = new Map();

  for (const entry of collection) {
    const cardId = entry.card;
    if (!cardId || cardId.endsWith('-P')) continue; // skip promos

    const tradeQty = parseInt(entry.trade, 10) || 0;
    const wishQty = parseInt(entry.wish, 10) || 0;

    const meta = {
      quantity: 0, // set per map below
      imageUrl: `https://static.dotgg.gg/riftbound/cards/${cardId}.webp`,
      cardUrl: `https://riftbound.gg/cards/${cardId.toLowerCase()}`,
    };

    if (tradeQty > 0) {
      tradeMap.set(cardId, { ...meta, quantity: tradeQty });
    }
    if (wishQty > 0) {
      wishlistMap.set(cardId, { ...meta, quantity: wishQty });
    }
  }

  return { tradeMap, wishlistMap };
}

