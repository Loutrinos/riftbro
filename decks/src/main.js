import m from 'mithril';
import { getCardCatalog } from '../../shared/cardCatalog.js';

// -- Constants ---------------------------------------------------
const DOTGG_BASE    = 'https://api.dotgg.gg/cgfw/getuserdata?game=riftbound';
const DOTGG_DEV     = '/api-proxy/cgfw/getuserdata?game=riftbound';

const POST_OPTS = username => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username }),
});

async function fetchCollection(username) {
  if (import.meta.env.DEV) {
    return fetch(DOTGG_DEV, POST_OPTS(username));
  }
  const encoded = encodeURIComponent(DOTGG_BASE);
  const proxies = [
    `https://corsproxy.io/?${encoded}`,
    `https://corsproxy.org/?url=${encoded}`,
  ];
  for (const url of proxies) {
    try { const r = await fetch(url); if (r.ok) return r; } catch (_) {}
  }
  throw new Error('Could not reach the collection API. All proxies failed.');
}
const USER_TTL      = 15 * 60 * 1000; // 15 min
const DECKS_KEY     = 'rb_decks';
const SECTION_ORDER = ['LEGEND','CHAMPION','UNIT','GEAR','SPELL','BATTLEFIELDS','RUNES','SIDEBOARD'];

// Fetch a URL through CORS proxy with automatic fallback
async function proxyFetch(url) {
  if (import.meta.env.DEV) {
    return fetch(`/api-proxy/riftdecks${new URL(url).pathname}`);
  }
  const candidates = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://thingproxy.freeboard.io/fetch/${url}`,
  ];
  for (const proxyUrl of candidates) {
    try {
      const res = await fetch(proxyUrl);
      if (res.ok) return res;
    } catch (_) { /* try next */ }
  }
  throw new Error('Could not fetch deck page — all proxies failed. Try again later.');
}

// -- State -------------------------------------------------------
const state = {
  phase:         'loading',  // 'loading' | 'ready'
  catalog:       [],
  nameMap:       new Map(),  // lower-case name → normId
  nameSlugMap:   new Map(),  // slugified name → normId
  userCards:     {},
  transitOrders: JSON.parse(localStorage.getItem('rb_transit_orders') || '[]'),
  wantOrders:    JSON.parse(localStorage.getItem('rb_want_orders')    || '[]'),
  username:      localStorage.getItem('rb_username') || '',
  savedDecks:    JSON.parse(localStorage.getItem(DECKS_KEY) || '[]'),
  expandedDeck:  null,   // deck id
  // AddDeckDialog
  showAdd:       false,
  addUrl:        '',
  addLoading:    false,
  addError:      '',
  copyDone:      null,   // deck id
};

// -- Transit / want helpers (same pattern as /app/) --------------
function transitTotals() {
  const map = new Map();
  for (const order of state.transitOrders) {
    for (const item of order.items) {
      const cur = map.get(item.normId) || { normal: 0, foil: 0 };
      cur.normal += item.normal || 0;
      cur.foil   += item.foil   || 0;
      map.set(item.normId, cur);
    }
  }
  return map;
}

function wantTotals() {
  const map = new Map();
  for (const order of state.wantOrders) {
    for (const item of order.items) {
      map.set(item.normId, (map.get(item.normId) || 0) + item.qty);
    }
  }
  return map;
}

function ownedOf(normId) {
  const u  = state.userCards[normId] || {};
  const tt = transitTotals().get(normId) || { normal: 0, foil: 0 };
  const wt = wantTotals().get(normId) || 0;
  return (u.normal || 0) + (u.foil || 0) + tt.normal + tt.foil + wt;
}

// -- Deck stats --------------------------------------------------
function deckStats(deck) {
  let totalNeeded = 0, totalOwned = 0;
  let uniqueNeeded = 0, uniqueOwned = 0;
  const missing = [];   // { qty, name } pairs where more copies are needed

  for (const section of deck.sections) {
    if (section.type === 'RUNES') continue;   // runes are always owned
    for (const card of section.cards) {
      if (!card.normId) {
        // unmatched — treat as 0 owned, qty needed
        totalNeeded  += card.qty;
        uniqueNeeded++;
        missing.push({ qty: card.qty, name: card.name });
        continue;
      }
      const owned = ownedOf(card.normId);
      totalNeeded  += card.qty;
      totalOwned   += Math.min(owned, card.qty);
      uniqueNeeded++;
      if (owned >= 1) uniqueOwned++;
      const need = card.qty - owned;
      if (need > 0) missing.push({ qty: need, name: card.name });
    }
  }

  return { totalNeeded, totalOwned, uniqueNeeded, uniqueOwned, missing };
}

// -- Deck parsing ------------------------------------------------
// Normalize a card name for fuzzy matching: lowercase, strip spaces/commas/apostrophes/hyphens
function slugify(name) {
  return name.toLowerCase().replace(/[\s,'.\-]/g, '');
}

function buildNameMap(catalog) {
  const map    = new Map();  // exact lowercase name → normId
  const slugMap = new Map(); // slugified name → normId
  for (const c of catalog) {
    if (!c.name) continue;
    // normId: e.g. "ogn-001-298" → "OGN-001"
    const parts = c.id.split('-');
    const nId   = `${parts[0]}-${parts[1]}`.toUpperCase();
    map.set(c.name.trim().toLowerCase(), nId);
    slugMap.set(slugify(c.name), nId);
  }
  state.nameSlugMap = slugMap;
  return map;
}

function resolveNormId(name) {
  return state.nameMap.get(name.trim().toLowerCase())
      || state.nameSlugMap?.get(slugify(name))
      || null;
}

const SECTION_HEADER_RE = /^(LEGEND|CHAMPION|UNIT|GEAR|SPELL|BATTLEFIELDS|RUNES|SIDEBOARD)\s*\(/i;

function parseDeckHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Deck name + player from <h1> — "Deck Name By Player"
  const h1Text  = (doc.querySelector('h1')?.textContent || '').trim();
  const byMatch = h1Text.match(/^(.+?)\s+[Bb]y\s+(.+)$/);
  const name    = byMatch ? byMatch[1].trim() : h1Text || 'Unknown Deck';
  const player  = byMatch ? byMatch[2].trim() : '';

  // Event + date: look for a pattern like "N Players  YYYY-MM-DD" or date in text
  let event = '', date = '';
  const pageText = doc.body?.innerText || doc.body?.textContent || '';
  const dateMatch = pageText.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) date = dateMatch[1];
  // Try to find tournament name near the date
  const eventMatch = pageText.match(/(\d+)(?:st|nd|rd|th)\s+.+?\n(.+?)\s+\d{4}-\d{2}-\d{2}/);
  if (eventMatch) event = eventMatch[2].trim();

  // Legend name for subtitle
  let legend = '';

  // Find "Text Decklist" section — look for a heading or element containing that text
  // then walk tables to find sections
  const sections = {};
  SECTION_ORDER.forEach(s => sections[s] = []);

  let currentSection = null;
  const unmatched    = [];

  // Walk only rows inside #decklist — ignore everything outside that table
  const decklistEl = doc.querySelector('#decklist') || doc.body;
  const rows = Array.from(decklistEl.querySelectorAll('tr'));
  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll('td, th')).map(c => c.textContent.trim());
    if (!cells.length) continue;

    // Check if any cell is a section header
    const headerCell = cells.find(c => SECTION_HEADER_RE.test(c));
    if (headerCell) {
      const m  = headerCell.match(SECTION_HEADER_RE);
      if (m) currentSection = m[1].toUpperCase();
      continue;
    }

    if (!currentSection) continue;

    // Try to extract qty + name from row
    // Expected: [rarity?, qty (number), name, price?, domain?, ...]
    // Find first cell that is a plain integer (qty)
    let qty = 0, nameStr = '';
    for (let i = 0; i < cells.length; i++) {
      const n = parseInt(cells[i], 10);
      if (!isNaN(n) && n > 0 && String(n) === cells[i]) {
        qty     = n;
        nameStr = (cells[i + 1] || '').trim();
        break;
      }
    }
    if (!qty || !nameStr) continue;
    // Filter out price-like cells picked up as names (starts with $)
    if (nameStr.startsWith('$')) continue;

    const normId = resolveNormId(nameStr);
    if (!normId) unmatched.push(nameStr);

    const entry = { qty, name: nameStr, normId };
    sections[currentSection]?.push(entry);

    if (currentSection === 'LEGEND' && !legend) legend = nameStr;
  }

  return {
    name,
    player,
    legend,
    event,
    date,
    sections: SECTION_ORDER
      .filter(s => sections[s].length > 0)
      .map(s => ({ type: s, cards: sections[s] })),
    unmatched: [...new Set(unmatched)],
  };
}

// -- Data loading ------------------------------------------------
async function loadCatalog() {
  state.catalog = await getCardCatalog();
  state.nameMap  = buildNameMap(state.catalog);
}

async function loadUserCollection() {
  const username = state.username;
  if (!username) return;

  const key   = `rb_user_v2_${username}`;
  const tsKey = `rb_user_v2_ts_${username}`;
  const raw   = localStorage.getItem(key);
  const ts    = localStorage.getItem(tsKey);
  if (raw && ts && Date.now() - +ts < USER_TTL) {
    try {
      const cached = JSON.parse(raw);
      if (Object.keys(cached).length > 0) { state.userCards = cached; return; }
    } catch (_) { /* fall through */ }
  }

  const res  = await fetchCollection(username);
  if (!res.ok) return;
  const data = await res.json();
  if (!data.collection || !Array.isArray(data.collection)) return;
  state.userCards = {};
  for (const e of data.collection) {
    if (!e.card) continue;
    state.userCards[e.card] = {
      normal: +e.standard || 0,
      foil:   +e.foil     || 0,
      trade:  +e.trade    || 0,
      wish:   +e.wish     || 0,
    };
  }
  if (Object.keys(state.userCards).length > 0) {
    localStorage.setItem(key,   JSON.stringify(state.userCards));
    localStorage.setItem(tsKey, String(Date.now()));
  }
}

async function init() {
  try {
    await Promise.all([loadCatalog(), loadUserCollection()]);
  } catch (e) {
    console.error('Init error:', e);
  }
  state.phase = 'ready';
  m.redraw();
}

// -- Persist decks -----------------------------------------------
function saveDecks() {
  localStorage.setItem(DECKS_KEY, JSON.stringify(state.savedDecks));
}

function removeDeck(id) {
  state.savedDecks = state.savedDecks.filter(d => d.id !== id);
  saveDecks();
}

// -- Add deck action ---------------------------------------------
async function fetchAndAddDeck(url) {
  state.addLoading = true;
  state.addError   = '';
  m.redraw();

  try {
    const res  = await proxyFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching deck page`);
    const html  = await res.text();
    const parsed = parseDeckHtml(html);

    if (!parsed.sections.length) throw new Error('No card sections found — check the URL is a valid riftdecks.com deck page.');

    const deck = {
      id:      crypto.randomUUID(),
      url,
      addedAt: new Date().toISOString(),
      ...parsed,
    };

    state.savedDecks = [deck, ...state.savedDecks];
    saveDecks();
    state.showAdd    = false;
    state.addUrl     = '';
    state.addLoading = false;
    m.redraw();
  } catch (e) {
    state.addError   = e.message || 'Failed to fetch or parse the deck.';
    state.addLoading = false;
    m.redraw();
  }
}

// -- Copy missing ------------------------------------------------
function copyMissing(deck) {
  const stats = deckStats(deck);
  if (!stats.missing.length) return;
  const text = stats.missing.map(m => `${m.qty}x ${m.name}`).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    state.copyDone = deck.id;
    m.redraw();
    setTimeout(() => { state.copyDone = null; m.redraw(); }, 1800);
  });
}

// -- Components --------------------------------------------------

const AddDeckDialog = {
  view() {
    const { addUrl, addLoading, addError } = state;
    const close = () => {
      if (addLoading) return;
      state.showAdd  = false;
      state.addUrl   = '';
      state.addError = '';
    };
    return m('.dialog-overlay', { onclick: close }, [
      m('.dialog-box', { onclick: e => e.stopPropagation() }, [
        m('h3.dialog-title', '📋 Add Deck'),
        m('p.dialog-hint',
          'Paste a riftdecks.com deck URL, e.g. ',
          m('span', { style: 'opacity:0.7; word-break:break-all' },
            'https://riftdecks.com/riftbound-metagame/deck-xiong-96405'
          )
        ),
        m('input.dialog-input', {
          type: 'url',
          placeholder: 'https://riftdecks.com/riftbound-metagame/deck-…',
          value: addUrl,
          disabled: addLoading,
          oninput: e => { state.addUrl = e.target.value; state.addError = ''; },
          onkeydown: e => { if (e.key === 'Enter' && addUrl.trim() && !addLoading) fetchAndAddDeck(addUrl.trim()); },
        }),
        addError ? m('.dialog-error', addError) : null,
        addLoading
          ? m('.dialog-loading', [m('.spinner'), 'Fetching deck…'])
          : m('.dialog-actions', [
              m('button.dialog-fetch-btn', {
                disabled: !addUrl.trim(),
                onclick: () => fetchAndAddDeck(addUrl.trim()),
              }, '⬇ Fetch & Save'),
              m('button.dialog-cancel-btn', { onclick: close }, 'Cancel'),
            ]),
      ]),
    ]);
  },
};

const SectionRow = {
  view({ attrs: { card } }) {
    const owned   = card.normId ? ownedOf(card.normId) : 0;
    const have    = Math.min(owned, card.qty);
    const cls     = !card.normId ? 'none'
                  : owned >= card.qty ? 'ok'
                  : owned > 0        ? 'partial'
                  : 'none';
    return m('.deck-card-row', [
      m('span.dcr-qty', `${card.qty}×`),
      m('span.dcr-name', { class: !card.normId ? 'unmatched' : '' }, card.name),
      m('span.dcr-owned', { class: cls }, `${have}/${card.qty}`),
    ]);
  },
};

const DeckCard = {
  view({ attrs: { deck } }) {
    const isOpen  = state.expandedDeck === deck.id;
    const stats   = deckStats(deck);
    const pct     = stats.totalNeeded ? Math.round(100 * stats.totalOwned / stats.totalNeeded) : 0;
    const isCopied = state.copyDone === deck.id;
    const complete = pct === 100;

    return m('.deck-card', { class: isOpen ? 'open' : '' }, [
      // -- Header row (click to expand) --
      m('.deck-header', {
        onclick: () => { state.expandedDeck = isOpen ? null : deck.id; },
      }, [
        m('span.deck-chevron', '▶'),
        m('.deck-meta', [
          m('.deck-name', deck.name || 'Unnamed Deck'),
          m('.deck-sub', [
            deck.legend ? `⚡ ${deck.legend}` : '',
            deck.player ? ` · ${deck.player}` : '',
            deck.event  ? ` · ${deck.event}`  : '',
            deck.date   ? ` · ${deck.date}`   : '',
          ].filter(Boolean).join('')),
        ]),
        m('.deck-progress', [
          m('.mini-bar', m('.mini-bar-fill', {
            class: complete ? 'complete' : '',
            style: { width: `${pct}%` },
          })),
          m('span.deck-pct', `${pct}%`),
        ]),
        m('.deck-actions', [
          m('a.open-btn', {
            href: deck.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: 'Open deck on riftdecks.com',
            onclick: e => e.stopPropagation(),
          }, '↗'),
          stats.missing.length > 0
            ? m('button.copy-btn', {
                class: isCopied ? 'done' : '',
                title: 'Copy missing cards to clipboard',
                onclick: e => { e.stopPropagation(); copyMissing(deck); },
              }, isCopied ? '✓ Copied!' : `⎘ Copy ${stats.missing.reduce((s, c) => s + c.qty, 0)} Missing`)
            : m('span.copy-btn.done', '✓ Complete!'),
          m('button.remove-btn', {
            title: 'Remove deck',
            onclick: e => { e.stopPropagation(); removeDeck(deck.id); m.redraw(); },
          }, '✕'),
        ]),
      ]),

      // -- Expanded body --
      isOpen ? m('.deck-body', [
        // Summary stats
        m('.deck-summary', [
          m('.deck-stat', [
            m('span.deck-stat-val', `${stats.totalOwned}/${stats.totalNeeded}`),
            m('span.deck-stat-lab', 'Cards Owned'),
          ]),
          m('.deck-stat', [
            m('span.deck-stat-val', { class: stats.missing.reduce((s,c) => s+c.qty,0) === 0 ? 'ok' : 'danger' },
              stats.missing.reduce((s, c) => s + c.qty, 0)),
            m('span.deck-stat-lab', 'Missing Copies'),
          ]),
          m('.deck-stat', [
            m('span.deck-stat-val', `${stats.uniqueOwned}/${stats.uniqueNeeded}`),
            m('span.deck-stat-lab', 'Unique Cards'),
          ]),
          m('.deck-stat', [
            m('span.deck-stat-val', `${pct}%`),
            m('span.deck-stat-lab', 'Complete'),
          ]),
        ]),
        // Unmatched warning
        deck.unmatched?.length ? m('.deck-unmatched',
          `⚠ ${deck.unmatched.length} card name${deck.unmatched.length !== 1 ? 's' : ''} not found in catalog: ` +
          deck.unmatched.join(', ')
        ) : null,
        // Per-section card lists
        ...deck.sections.map(section => {
          const secOwn  = section.cards.reduce((s, c) => s + (c.normId ? Math.min(ownedOf(c.normId), c.qty) : 0), 0);
          const secNeed = section.cards.reduce((s, c) => s + c.qty, 0);
          return m('.deck-section', [  // no key — avoids mixed-key fragment error
            m('.section-head', [
              m('span.section-type', section.type),
              m('span.section-count', `(${secNeed})`),
              m('span.section-progress', `${secOwn}/${secNeed}`),
            ]),
            ...section.cards.map(card => m(SectionRow, { card })),
          ]);
        }),
      ]) : null,
    ]);
  },
};

const App = {
  view() {
    const hasUser    = state.username && Object.keys(state.userCards).length > 0;
    const hasDecks   = state.savedDecks.length > 0;

    return m('.app-shell', [
      m('header.app-header', [
        m('img.header-logo', { src: import.meta.env.BASE_URL + 'logo.png', alt: 'Riftbro' }),
        m('a.header-home', { href: '../' }, '← Home'),
        m('span.header-title', 'Deck Tracker'),
        state.username ? m('span.header-username', state.username) : null,
      ]),

      state.showAdd ? m(AddDeckDialog) : null,

      state.phase === 'loading'
        ? m('.loading-screen', [m('.spinner'), 'Loading catalog…'])
        : m('.page-body', [
            !hasUser ? m('.no-collection-banner',
              'No collection loaded. ',
              m('a', { href: `${import.meta.env.BASE_URL}../app/` }, 'Open the Collection app'),
              ' and enter your riftbound.gg username first — your collection is then shared across all tools via localStorage.'
            ) : null,

            m('.page-header', [
              m('h1.page-title', 'Tracked Decks'),
              m('button.add-deck-btn', { onclick: () => { state.showAdd = true; } }, '+ Add Deck'),
            ]),

            !hasDecks
              ? m('.empty-state', [
                  m('strong', 'No decks tracked yet'),
                  'Click + Add Deck and paste a riftdecks.com URL to get started.',
                ])
              : m('.deck-list',
                  state.savedDecks.map(deck => m(DeckCard, { key: deck.id, deck }))
                ),
          ]),
    ]);
  },
};

// -- Mount -------------------------------------------------------
m.mount(document.getElementById('app'), {
  view: () => m(App),
});

init();
