// main.js — Collection Dashboard (no auth required)
import m from 'https://esm.sh/mithril@2.2.2';
import { getCardCatalog } from '../shared/cardCatalog.js';
import { addUser, getUsers } from '../shared/savedUsers.js';

// -- Constants --
const DOTGG_ENDPOINT = 'https://api.dotgg.gg/cgfw/getuserdata?game=riftbound';
const DOTGG_API = `https://corsproxy.io/?url=${encodeURIComponent(DOTGG_ENDPOINT)}`;
const USER_TTL = 30 * 60 * 1000; // 30 min

const SETS = [
  { id: 'OGN', label: 'Origins',         code: 'OGN' },
  { id: 'SFD', label: 'Spiritforged',    code: 'SFD' },
  { id: 'OGS', label: 'Proving Grounds', code: 'OGS' },
];

// Maps Cardmarket expansion names to set codes
const EXPANSION_TO_CODE = {
  'Origins':         'OGN',
  'Spiritforged':    'SFD',
  'Proving Grounds': 'OGS',
};

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic'];
const RARITY_COLOR = {
  common:       '#9ca3af',
  uncommon:     '#34d399',
  rare:         '#60a5fa',
  epic:         '#c084fc',
  overnumbered: '#f59e0b',
};

// -- Card helpers --
// True for any card whose collector number exceeds the set size
// (the overnumbered showcase range, both regular and signed versions)
const isAboveSet = c => {
  if (!c.id) return false;
  const parts = c.id.split('-');
  // ID format: {set}-{num}-{setSize}  or  {set}-{num}-star-{setSize}
  const setSize = parseInt(parts[parts.length - 1]);
  return !isNaN(setSize) && setSize > 100 && c.collectorNumber > setSize;
};
const isOvernumbered = c => c.rarity?.value?.id === 'overnumbered';
const isExtraCard    = c => isAboveSet(c) || isOvernumbered(c);
const isType = (c, t) => (c.cardType?.type || []).some(ct =>
  ct.id?.toLowerCase() === t || ct.label?.toLowerCase() === t);
const isRune        = c => isType(c, 'rune');
const isLegend      = c => isType(c, 'legend');
const isBattlefield = c => isType(c, 'battlefield');

// Normalize Firebase ID to DotGG format
// Regular: "ogn-001-298" → "OGN-001"
// Signed:  "ogn-302-star-298" → "OGN-302*"
const normId = id => {
  if (!id) return id;
  const parts = id.split('-');
  const base  = `${parts[0]}-${parts[1]}`.toUpperCase();
  return parts.includes('star') ? `${base}*` : base;
};
const isSigned = c => c.id?.includes('-star-');

function masterTarget(card) {
  if (isExtraCard(card)) return null;
  if (isRune(card))      return null;
  if (isLegend(card))       return 1;
  if (isBattlefield(card))  return 1;
  return 3;
}

// -- State --
const state = {
  phase:         'setup',   // 'setup' | 'loading' | 'main'
  username:      localStorage.getItem('rb_username') || '',
  cards:         [],
  userCards:     {},        // { cardId: { normal, foil, trade, wish } }
  selectedSet:   'all',
  selectedCard:  null,
  loadError:     null,
  userError:     null,
  filtersOpen:   false,
  filterRarity:  '',
  filterDomain:  '',
  filterType:    '',
  filterMissing: false,
  filterTrade:   false,
  filterWish:    false,
  showExtras:    false,   // when false, overnumbered & signed cards are hidden
  copyDone:      false,
  chipRarity:    '',
  chipType:      '',
  chipDomain:    '',
  showImport:    false,
  transitOrders: JSON.parse(localStorage.getItem('rb_transit_orders') || '[]'),
  // ImportDialog working state
  importHtml:    '',
  importParsed:  null,  // { items, unmatched } after parse
  importLabel:   '',
  importError:   '',
};

if (state.username) state.phase = 'loading';

// -- Transit helpers --
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

function saveTransitOrder(label, items) {
  const order = {
    id:    crypto.randomUUID(),
    label: label.trim() || new Date().toLocaleDateString(),
    date:  new Date().toISOString(),
    items,
  };
  state.transitOrders = [order, ...state.transitOrders];
  localStorage.setItem('rb_transit_orders', JSON.stringify(state.transitOrders));
}

function removeTransitOrder(id) {
  state.transitOrders = state.transitOrders.filter(o => o.id !== id);
  localStorage.setItem('rb_transit_orders', JSON.stringify(state.transitOrders));
}

function parseCMOrderHtml(html) {
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('tr[data-amount]'));
  if (!rows.length) return { items: [], unmatched: ['No table rows found — make sure you copied the order table.'] };

  // Build a normId → card name lookup from the loaded catalog
  const nameByNormId = new Map();
  for (const c of state.cards) nameByNormId.set(normId(c.id), c.name || normId(c.id));

  const itemMap  = new Map(); // normId → { normId, name, normal, foil }
  const unmatched = [];

  for (const row of rows) {
    const amount       = parseInt(row.dataset.amount) || 1;
    const expansionName = row.dataset.expansionName || '';
    const numStr       = row.dataset.number || '';
    const setCode      = EXPANSION_TO_CODE[expansionName];
    if (!setCode) { unmatched.push(`Unknown expansion: "${expansionName}"`); continue; }
    const num    = parseInt(numStr, 10);
    if (isNaN(num)) { unmatched.push(`Bad number: "${numStr}"`); continue; }
    const nId    = `${setCode}-${String(num).padStart(3, '0')}`;
    const foil   = !!row.querySelector('[aria-label="Foil"]');
    const name   = nameByNormId.get(nId) || null;
    if (!name) { unmatched.push(`${nId} (${row.dataset.name || '?'}) — not in catalog`); continue; }

    const existing = itemMap.get(nId) || { normId: nId, name, normal: 0, foil: 0 };
    if (foil) existing.foil   += amount;
    else      existing.normal += amount;
    itemMap.set(nId, existing);
  }

  return { items: Array.from(itemMap.values()), unmatched };
}

// -- Data helpers --
function ownedTotal(id) {
  const nid    = normId(id);
  const u      = state.userCards[nid];
  const base   = u ? (u.normal || 0) + (u.foil || 0) : 0;
  // Also count in-transit copies from saved orders
  const tt     = transitTotals().get(nid) || { normal: 0, foil: 0 };
  return base + tt.normal + tt.foil;
}
function isOwned(id) { return ownedTotal(id) > 0; }

function resetChips() {
  state.chipRarity = '';
  state.chipType   = '';
  state.chipDomain = '';
}

function clearFilters() {
  state.filterRarity  = '';
  state.filterDomain  = '';
  state.filterType    = '';
  state.filterMissing = false;
  state.filterTrade   = false;
  state.filterWish    = false;
  resetChips();
}

// -- Data loading --
async function loadCards() {
  state.cards = await getCardCatalog();
}

async function loadUserCollection(username, bust = false) {
  const key   = `rb_user_v2_${username}`;
  const tsKey = `rb_user_v2_ts_${username}`;
  if (!bust) {
    const raw = localStorage.getItem(key);
    const ts  = localStorage.getItem(tsKey);
    if (raw && ts && Date.now() - +ts < USER_TTL) {
      const cached = JSON.parse(raw);
      if (Object.keys(cached).length > 0) {
        state.userCards = cached;
        return;
      }
      // cached empty — refetch
    }
  }
  const res = await fetch(DOTGG_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  if (!data.collection || !Array.isArray(data.collection))
    throw new Error(`No collection found for "${username}". Check the username.`);
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
    localStorage.setItem(key, JSON.stringify(state.userCards));
    localStorage.setItem(tsKey, String(Date.now()));
  }
}

async function init(bust = false) {
  state.phase     = 'loading';
  state.loadError = null;
  state.userError = null;
  m.redraw();
  try {
    await loadCards();
  } catch (e) {
    state.loadError = e.message;
    state.phase = 'main';
    m.redraw();
    return;
  }
  if (state.username) {
    try {
      await loadUserCollection(state.username, bust);
    } catch (e) {
      state.userError = e.message;
    }
  }
  state.phase = 'main';
  m.redraw();
}

async function refresh() {
  if (!state.username) return;
  state.userError = null;
  state.phase = 'loading';
  m.redraw();
  try {
    await loadUserCollection(state.username, true);
  } catch (e) {
    state.userError = e.message;
  }
  state.phase = 'main';
  m.redraw();
}

// -- Computed --
function cardsForSet(setId) {
  if (!setId || setId === 'all') return state.cards;
  return state.cards.filter(c => c.set?.value?.id === setId);
}

function computeStats(setId) {
  const base = cardsForSet(setId).filter(c => state.showExtras || !isExtraCard(c));
  let uniqueTotal = 0, uniqueHave = 0;
  let masterTotal = 0, masterHave = 0;
  const rarityMiss = {};
  const typeMiss   = {};
  const domainMiss = {};

  for (const card of base) {
    const owned = ownedTotal(card.id);
    uniqueTotal++;
    if (owned > 0) {
      uniqueHave++;
    } else {
      const rId    = card.rarity?.value?.id    || 'unknown';
      const rLabel = card.rarity?.value?.label || rId;
      if (!rarityMiss[rId]) rarityMiss[rId] = { label: rLabel, count: 0 };
      rarityMiss[rId].count++;
      for (const ct of card.cardType?.type || []) {
        if (!ct.id) continue;
        if (!typeMiss[ct.id]) typeMiss[ct.id] = { label: ct.label || ct.id, count: 0 };
        typeMiss[ct.id].count++;
      }
      for (const d of card.domain?.values || []) {
        if (!d.id) continue;
        if (!domainMiss[d.id]) domainMiss[d.id] = { label: d.label || d.id, count: 0 };
        domainMiss[d.id].count++;
      }
    }
    const target = masterTarget(card);
    if (target !== null) {
      masterTotal += target;
      masterHave  += Math.min(owned, target);
    }
  }

  return {
    uniqueTotal, uniqueHave,
    masterTotal, masterHave,
    rarityMiss: Object.entries(rarityMiss)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => {
        const ai = RARITY_ORDER.indexOf(a.id);
        const bi = RARITY_ORDER.indexOf(b.id);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      }),
    typeMiss: Object.entries(typeMiss)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count),
    domainMiss: Object.entries(domainMiss)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count),
  };
}

function copyList() {
  const cards = filteredCards();
  if (!cards.length) return;
  const lines = cards.map(c => {
    const qty = state.userCards[normId(c.id)]?.wish || 1;
    return `${qty}x ${c.name || normId(c.id)}`;
  });
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    state.copyDone = true;
    m.redraw();
    setTimeout(() => { state.copyDone = false; m.redraw(); }, 1800);
  });
}

function filteredCards() {
  let cards = cardsForSet(state.selectedSet).filter(c => state.showExtras || !isExtraCard(c));
  const rF = state.chipRarity || state.filterRarity;
  const tF = state.chipType   || state.filterType;
  const dF = state.chipDomain || state.filterDomain;
  if (rF) cards = cards.filter(c => c.rarity?.value?.id === rF);
  if (tF) cards = cards.filter(c => (c.cardType?.type || []).some(ct => ct.id === tF));
  if (dF) cards = cards.filter(c => (c.domain?.values || []).some(d => d.id === dF));
  // Chip filters come from "Missing by …" sections — always show only unowned cards
  if (state.chipRarity || state.chipType || state.chipDomain) cards = cards.filter(c => !isOwned(c.id));
  if (state.filterMissing) cards = cards.filter(c => !isOwned(c.id));
  if (state.filterTrade)   cards = cards.filter(c => (state.userCards[normId(c.id)]?.trade || 0) > 0);
  if (state.filterWish)    cards = cards.filter(c => (state.userCards[normId(c.id)]?.wish  || 0) > 0);
  return cards;
}

// -- Components --
const SetupScreen = {
  view() {
    return m('.setup-page', [
      m('img.setup-logo', { src: import.meta.env.BASE_URL + 'logo.png', alt: 'Riftbro' }),
      m('h1.setup-title', 'Card Collection'),
      m('p.setup-sub', 'Enter your riftbound.gg username to load your collection'),
      m('form.setup-form', {
        onsubmit(e) {
          e.preventDefault();
          const val = state.username.trim();
          if (!val) return;
          localStorage.setItem('rb_username', val);
          addUser(val);
          init();
        },
      }, [
        m('input.setup-input', {
          list: 'rb-users',
          placeholder: 'riftbound.gg username',
          value: state.username,
          oninput: e => state.username = e.target.value,
          spellcheck: false,
        }),
        m('datalist', { id: 'rb-users' },
          getUsers().map(u => m('option', { value: u }))
        ),
        m('button.start-btn[type=submit]', 'View Collection'),
      ]),
      m('a.setup-home', { href: '../' }, '← Back to Hub'),
    ]);
  },
};

const LoadingScreen = {
  view() {
    return m('.loading-screen', [
      m('img.setup-logo', { src: import.meta.env.BASE_URL + 'logo.png' }),
      m('.loading-dots', [m('span'), m('span'), m('span')]),
      m('p.loading-text', 'Loading collection\u2026'),
    ]);
  },
};

const ProgressBar = {
  view({ attrs: { label, have, total, accent } }) {
    const pct = total > 0 ? Math.round(have / total * 100) : 0;
    return m('.progress-wrap', [
      m('.progress-label-row', [
        m('span.progress-label', label),
        m('span.progress-frac', `${have} / ${total}`),
        m('span.progress-pct', { class: pct === 100 ? 'complete' : '' }, `${pct}%`),
      ]),
      m('.progress-track', m('.progress-fill', {
        style: { width: `${pct}%`, background: accent || 'var(--accent)' },
      })),
    ]);
  },
};

const StatsPanel = {
  view() {
    const stats = computeStats(state.selectedSet);
    return m('.stats-panel', [
      m('.progress-group', [
        m(ProgressBar, { label: 'Unique', have: stats.uniqueHave, total: stats.uniqueTotal }),
        m(ProgressBar, { label: 'Master Set', have: stats.masterHave, total: stats.masterTotal, accent: '#8b7fce' }),
      ]),
      stats.rarityMiss.length ? m('.chip-group', [
        m('.chip-group-label', 'Missing by Rarity'),
        m('.chip-row', stats.rarityMiss.map(r =>
          m('.miss-chip', {
            key: r.id,
            class: state.chipRarity === r.id ? 'active' : '',
            style: { '--chip-c': RARITY_COLOR[r.id] || '#888' },
            onclick() {
              state.chipRarity = state.chipRarity === r.id ? '' : r.id;
              state.chipType   = '';
              state.chipDomain = '';
            },
          }, [m('span.chip-dot'), m('span.chip-label', r.label), m('span.chip-count', r.count)])
        )),
      ]) : null,
      stats.typeMiss.length ? m('.chip-group', [
        m('.chip-group-label', 'Missing by Type'),
        m('.chip-row', stats.typeMiss.map(t =>
          m('.miss-chip', {
            key: t.id,
            class: state.chipType === t.id ? 'active' : '',
            onclick() {
              state.chipType   = state.chipType === t.id ? '' : t.id;
              state.chipRarity = '';
              state.chipDomain = '';
            },
          }, [m('span.chip-label', t.label), m('span.chip-count', t.count)])
        )),
      ]) : null,
      stats.domainMiss.length ? m('.chip-group', [
        m('.chip-group-label', 'Missing by Color'),
        m('.chip-row', stats.domainMiss.map(d =>
          m('.miss-chip', {
            key: d.id,
            class: state.chipDomain === d.id ? 'active' : '',
            onclick() {
              state.chipDomain = state.chipDomain === d.id ? '' : d.id;
              state.chipRarity = '';
              state.chipType   = '';
            },
          }, [m('span.chip-label', d.label), m('span.chip-count', d.count)])
        )),
      ]) : null,
      state.transitOrders.length ? m('.transit-section', [
        m('.transit-header', 'In Transit Orders'),
        ...state.transitOrders.map(order => {
          const totalQty = order.items.reduce((s, it) => s + it.normal + it.foil, 0);
          return m('.transit-order-row', { key: order.id }, [
            m('.transit-order-info', [
              m('span.transit-order-label', order.label),
              m('span.transit-order-meta', `${totalQty} card${totalQty !== 1 ? 's' : ''} · ${new Date(order.date).toLocaleDateString()}`),
            ]),
            m('button.transit-remove-btn', {
              title: 'Remove this order',
              onclick: () => { removeTransitOrder(order.id); m.redraw(); },
            }, '\u2715'),
          ]);
        }),
      ]) : null,
    ]);
  },
};

const CardGrid = {
  view() {
    const cards   = filteredCards();
    const hasUser = Object.keys(state.userCards).length > 0;
    const hasActive = state.chipRarity || state.chipType || state.chipDomain ||
                      state.filterRarity || state.filterDomain || state.filterType ||
                      state.filterMissing || state.filterTrade || state.filterWish;
    return m('.card-grid-section', [
      m('.grid-toolbar', [
        m('span.grid-count', `${cards.length} card${cards.length !== 1 ? 's' : ''}`),
        cards.length > 0 ? m('button.copy-list-btn', {
          class: state.copyDone ? 'done' : '',
          onclick: copyList,
          title: 'Copy list to clipboard',
        }, state.copyDone ? '✓ Copied!' : '⎘ Copy List') : null,
        m('.quick-filters', [
          hasUser ? m('label.qf-label', { class: state.filterMissing ? 'active' : '' }, [
            m('input[type=checkbox]', {
              checked: state.filterMissing,
              onchange: e => { state.filterMissing = e.target.checked; resetChips(); },
            }),
            ' Missing',
          ]) : null,
          hasUser ? m('label.qf-label', { class: state.filterTrade ? 'active' : '' }, [
            m('input[type=checkbox]', {
              checked: state.filterTrade,
              onchange: e => { state.filterTrade = e.target.checked; resetChips(); },
            }),
            ' For Trade',
          ]) : null,
          hasUser ? m('label.qf-label', { class: state.filterWish ? 'active' : '' }, [
            m('input[type=checkbox]', {
              checked: state.filterWish,
              onchange: e => { state.filterWish = e.target.checked; resetChips(); },
            }),
            ' Wishlist',
          ]) : null,
          m('button.filter-toggle', {
            class: state.filtersOpen ? 'open' : '',
            onclick: () => state.filtersOpen = !state.filtersOpen,
          }, state.filtersOpen ? '▲ Filters' : '▼ Filters'),
          hasActive ? m('button.clear-chip-btn', { onclick: clearFilters }, '✕ Clear') : null,
          m('button.qf-label', {
            class: state.showExtras ? 'active' : '',
            onclick: () => { state.showExtras = !state.showExtras; },
            title: 'Toggle above-set overnumbered cards (showcase + signed)',
          }, state.showExtras ? '✓ Extras On' : 'Show Extras'),
        ]),
      ]),
      state.filtersOpen ? m('.adv-filters', [
        m('select.adv-select', {
          value: state.filterRarity,
          onchange: e => { state.filterRarity = e.target.value; state.chipRarity = ''; },
        }, [
          m('option', { value: '' }, 'All Rarities'),
          ...RARITY_ORDER.map(id => m('option', { value: id }, id.charAt(0).toUpperCase() + id.slice(1))),
        ]),
        m('select.adv-select', {
          value: state.filterDomain,
          onchange: e => { state.filterDomain = e.target.value; state.chipDomain = ''; },
        }, [
          m('option', { value: '' }, 'All Colors'),
          ...['fury','body','mind','calm','chaos','order','colorless'].map(id =>
            m('option', { value: id }, id.charAt(0).toUpperCase() + id.slice(1))
          ),
        ]),
        m('button.adv-clear', { onclick: clearFilters }, 'Reset'),
      ]) : null,
      m('.card-grid', cards.map(card => {
        const u      = state.userCards[normId(card.id)] || {};
        const owned  = (u.normal || 0) + (u.foil || 0);
        const missing = hasUser && owned === 0;
        return m('.cg-card', {
          key: card.id,
          class: missing ? 'missing' : '',
          onclick: () => state.selectedCard = card,
        }, [
          m('.cg-img-wrap', [
            m('img.cg-img', {
              src: card.cardImage?.url || '',
              alt: card.name || card.id,
              loading: 'lazy',
            }),
            m('.cg-rarity-dot', {
              style: { background: RARITY_COLOR[card.rarity?.value?.id] || '#666' },
            }),
          ]),
          m('.cg-body', [
            m('.cg-name', [
              card.name || normId(card.id),
              isSigned(card) ? m('span.signed-badge', '✍ Signed') : null,
            ]),
            m('.cg-id', normId(card.id)),
            hasUser ? m('.cg-badges', [
              m('.badge.n', `N ${u.normal || 0}`),
              m('.badge.f', `F ${u.foil   || 0}`),
              (u.trade || 0) > 0 ? m('.badge.t', `T ${u.trade}`) : null,
              (u.wish  || 0) > 0 ? m('.badge.w', `W ${u.wish}`)  : null,
              (() => { const tt = transitTotals().get(normId(card.id)); return tt ? m('.badge.it', `\u231B ${tt.normal + tt.foil}`) : null; })(),
            ]) : null,
          ]),
        ]);
      })),
    ]);
  },
};

const CardModal = {
  view() {
    if (!state.selectedCard) return null;
    const card = state.selectedCard;
    const u    = state.userCards[normId(card.id)] || {};
    return m('.modal', { onclick: () => state.selectedCard = null }, [
      m('.modal-content', { onclick: e => e.stopPropagation() }, [
        m('.modal-img-wrap',
          m('img.modal-img', { src: card.cardImage?.url || '', alt: card.name || card.id })
        ),
        m('.modal-info', [
          m('h2.modal-name', [
              card.name || normId(card.id),
              isSigned(card) ? m('span.signed-badge', '✍ Signed') : null,
            ]),
          m('.modal-id', normId(card.id)),
          card.rarity?.value ? m('.modal-rarity', {
            style: { color: RARITY_COLOR[card.rarity.value.id] || '#888' },
          }, card.rarity.value.label) : null,
          card.set?.value ? m('.modal-set', card.set.value.label) : null,
          (card.domain?.values || []).length
            ? m('.modal-meta', card.domain.values.map(d => d.label).join(' · '))
            : null,
          (card.cardType?.type || []).length
            ? m('.modal-meta', card.cardType.type.map(t => t.label).join(' · '))
            : null,
          Object.keys(state.userCards).length ? m('.modal-counts', [
            m('.modal-badge.n', [m('span.mb-val', u.normal || 0), m('span.mb-lab', 'Normal')]),
            m('.modal-badge.f', [m('span.mb-val', u.foil   || 0), m('span.mb-lab', 'Foil')]),
            m('.modal-badge.t', [m('span.mb-val', u.trade  || 0), m('span.mb-lab', 'Trade')]),
            m('.modal-badge.w', [m('span.mb-val', u.wish   || 0), m('span.mb-lab', 'Wish')]),
            (() => { const tt = transitTotals().get(normId(card.id)); return tt ? m('.modal-badge.it', [m('span.mb-val', tt.normal + tt.foil), m('span.mb-lab', 'In Transit')]) : null; })(),
          ]) : null,
        ]),
      ]),
    ]);
  },
};

const ImportDialog = {
  view() {
    const p = state.importParsed;
    return m('.import-overlay', { onclick: () => { state.showImport = false; state.importParsed = null; state.importHtml = ''; state.importError = ''; } }, [
      m('.import-dialog', { onclick: e => e.stopPropagation() }, [
        m('h3.import-title', '\u2709 Import Cardmarket Order'),
        m('p.import-hint', 'Paste the order table HTML from Cardmarket (right-click the table → Inspect, copy outer HTML, or select the whole table and paste here).'),
        m('textarea.import-textarea', {
          placeholder: 'Paste HTML here…',
          value: state.importHtml,
          oninput: e => { state.importHtml = e.target.value; state.importParsed = null; state.importError = ''; },
        }),
        state.importError ? m('.import-error', state.importError) : null,
        !p ? m('button.import-parse-btn', {
          disabled: !state.importHtml.trim(),
          onclick() {
            try {
              state.importParsed = parseCMOrderHtml(state.importHtml);
              if (!state.importParsed.items.length) state.importError = 'No matching cards found. Check that you copied the correct table HTML.';
              state.importLabel = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
            } catch(e) {
              state.importError = 'Parse error: ' + e.message;
            }
          },
        }, 'Parse') : null,
        p && p.items.length ? [
          m('.import-preview-header', `Found ${p.items.length} card${p.items.length !== 1 ? 's' : ''}:`),
          m('.import-preview-list',
            p.items.map(it => m('.import-preview-row', { key: it.normId }, [
              m('span.import-card-name', it.name),
              m('span.import-card-id', it.normId),
              it.normal ? m('span.badge.n.sm', `N ${it.normal}`) : null,
              it.foil   ? m('span.badge.f.sm', `F ${it.foil}`)   : null,
            ]))
          ),
          p.unmatched.length ? m('.import-unmatched', [
            m('p.import-unmatched-title', `${p.unmatched.length} row${p.unmatched.length !== 1 ? 's' : ''} not matched:`),
            ...p.unmatched.map(s => m('p.import-unmatched-row', s)),
          ]) : null,
          m('.import-label-row', [
            m('label', 'Order label:'),
            m('input.import-label-input', {
              value: state.importLabel,
              oninput: e => state.importLabel = e.target.value,
            }),
          ]),
          m('.import-actions', [
            m('button.import-save-btn', {
              onclick() {
                saveTransitOrder(state.importLabel, p.items);
                state.showImport  = false;
                state.importParsed = null;
                state.importHtml  = '';
                state.importError = '';
                m.redraw();
              },
            }, '\u2714 Save Order'),
            m('button.import-cancel-btn', {
              onclick: () => { state.showImport = false; state.importParsed = null; state.importHtml = ''; state.importError = ''; },
            }, 'Cancel'),
          ]),
        ] : null,
        !p ? m('.import-actions', [
          m('button.import-cancel-btn', {
            onclick: () => { state.showImport = false; state.importHtml = ''; state.importError = ''; },
          }, 'Cancel'),
        ]) : null,
      ]),
    ]);
  },
};

const MainScreen = {
  view() {
    return m('.main-screen', [
      m('header.app-header', [
        m('img.header-logo', { src: import.meta.env.BASE_URL + 'logo.png', alt: 'Riftbro' }),
        m('a.header-home', { href: '../' }, '← Home'),
        m('.header-right', [
          m('span.header-username', state.username),
          m('button.change-btn', {
            title: 'Change user',
            onclick() {
              localStorage.removeItem('rb_username');
              state.username  = '';
              state.userCards = {};
              state.phase     = 'setup';
            },
          }, 'Change'),
          m('button.refresh-btn', { onclick: refresh, title: 'Refresh collection' }, '↻'),
          m('button.import-btn', {
            title: 'Import Cardmarket order',
            onclick: () => { state.showImport = true; },
          }, '\u2709 Import'),
        ]),
      ]),
      state.showImport ? m(ImportDialog) : null,
      m('.set-tabs', [
        m('.set-tab', {
          key: 'all',
          class: state.selectedSet === 'all' ? 'active' : '',
          onclick() { state.selectedSet = 'all'; resetChips(); },
        }, 'All Sets'),
        ...SETS.map(s => m('.set-tab', {
          key: s.id,
          class: state.selectedSet === s.id ? 'active' : '',
          onclick() { state.selectedSet = s.id; resetChips(); },
        }, `${s.code} \u2013 ${s.label}`)),
      ]),
      m('.main-body', [
        state.userError  ? m('.user-error', `\u26A0 ${state.userError}`) : null,
        state.loadError  ? m('.user-error', `\u26A0 Cards failed to load: ${state.loadError}`) : null,
        Object.keys(state.userCards).length > 0 ? m(StatsPanel) : null,
        m(CardGrid),
      ]),
      m(CardModal),
    ]);
  },
};

const App = {
  view() {
    if (state.phase === 'setup')   return m(SetupScreen);
    if (state.phase === 'loading') return m(LoadingScreen);
    return m(MainScreen);
  },
};

// -- Boot --
if (state.username) init();

// Mount app
m.mount(document.getElementById('app'), App);
