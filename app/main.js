// main.js — RiftBro Collection Dashboard
import m from 'mithril';
import { getCardCatalog } from '../shared/cardCatalog.js';
import { addUser, getUsers, removeUser } from '../shared/savedUsers.js';

// ── Collection API (dotgg) ─────────────────────────────────────────
const DOTGG_BASE = 'https://api.dotgg.gg/cgfw/getuserdata?game=riftbound';
const DOTGG_DEV  = '/api-proxy/cgfw/getuserdata?game=riftbound';
const USER_TTL   = 30 * 60 * 1000; // 30 min

const postOpts = (username, simple = false) => ({
  method: 'POST',
  headers: { 'Content-Type': simple ? 'text/plain' : 'application/json' },
  body: JSON.stringify({ username }),
});

async function fetchCollection(username) {
  if (import.meta.env.DEV) return fetch(DOTGG_DEV, postOpts(username));
  const encoded = encodeURIComponent(DOTGG_BASE);
  const proxies = [
    `https://corsproxy.io/?${encoded}`,
    `https://corsproxy.org/?url=${encoded}`,
  ];
  for (const url of proxies) {
    try {
      const r = await fetch(url, postOpts(username, true));
      if (r.ok) return r;
    } catch (_) { /* try next */ }
  }
  throw new Error('Could not reach the collection API. All proxies failed.');
}

// ── Static maps ────────────────────────────────────────────────────
const SETS = [
  { id: 'OGN', label: 'Origins',         code: 'OGN' },
  { id: 'SFD', label: 'Spiritforged',    code: 'SFD' },
  { id: 'OGS', label: 'Proving Grounds', code: 'OGS' },
  { id: 'UNL', label: 'Unleashed',       code: 'UNL' },
];
const EXPANSION_TO_CODE = {
  'Origins': 'OGN', 'Spiritforged': 'SFD', 'Proving Grounds': 'OGS', 'Unleashed': 'UNL',
};
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic'];
const RARITY_COLOR = {
  common: '#8A92A0', uncommon: '#15A56A', rare: '#2F77E6', epic: '#8B5CF6', overnumbered: '#E0930B',
};
const DOMAIN_COLOR = {
  fury: '#E5484D', body: '#2BA84A', mind: '#5750D8', calm: '#0C8CE0',
  chaos: '#9B51E0', order: '#E0930B', colorless: '#8A92A0',
};
const TYPE_ICON = {
  unit: '\u2694', spell: '\u26A1', gear: '\u2699', rune: '\u25C6', battlefield: '\u25C9', legend: '\u2605',
};
const LOGO_SVG = `<img class="brand-logo" src="/riftbro/app/rb-icon.png" alt="" height="30" />`;

// ── Card helpers ───────────────────────────────────────────────────
const isAboveSet = c => {
  if (!c.id) return false;
  const parts = c.id.split('-');
  const setSize = parseInt(parts[parts.length - 1]);
  return !isNaN(setSize) && setSize > 100 && c.collectorNumber > setSize;
};
const isOvernumbered = c => c.rarity?.value?.id === 'overnumbered';
const isShowcase     = c => /[a-zA-Z]$/.test(c.id?.split('-')[1] || '');
const isExtraCard    = c => isAboveSet(c) || isOvernumbered(c) || isShowcase(c);
const isType = (c, t) => (c.cardType?.type || []).some(ct =>
  ct.id?.toLowerCase() === t || ct.label?.toLowerCase() === t);
const isRune        = c => isType(c, 'rune');
const isLegend      = c => isType(c, 'legend');
const isBattlefield = c => isType(c, 'battlefield');

const normId = id => {
  if (!id) return id;
  const parts = id.split('-');
  const base  = `${parts[0]}-${parts[1]}`.toUpperCase();
  return parts.includes('star') ? `${base}*` : base;
};
const isSigned    = c => c.id?.includes('-star-');
const baseNormId  = nId => nId.replace(/^([A-Z]+-\d+)[A-Za-z]+(\*?)$/, '$1$2');

function masterTarget(card) {
  if (isExtraCard(card)) return null;
  if (isRune(card))      return null;
  if (isLegend(card))       return 1;
  if (isBattlefield(card))  return 1;
  return 3;
}

const domainOf = c => c.domain?.values?.[0]?.id || 'colorless';
const domainColor = c => DOMAIN_COLOR[domainOf(c)] || DOMAIN_COLOR.colorless;
const rarityColor = c => RARITY_COLOR[c.rarity?.value?.id] || '#8A92A0';
const typeGlyph = c => TYPE_ICON[c.cardType?.type?.[0]?.id] || '\u25C6';
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const today = () => new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

// ── State ──────────────────────────────────────────────────────────
const state = {
  phase:        'setup',   // 'setup' | 'loading' | 'main'
  username:     localStorage.getItem('rb_username') || '',
  cards:        [],
  userCards:    {},
  selectedSet:  'all',
  viewMode:     'unique',  // 'unique' = Master Collection · 'master' = Play Set
  density:      localStorage.getItem('rb_density') || 'comfortable',
  theme:        localStorage.getItem('rb_theme') || 'light',
  selectedCard: null,
  loadError:    null,
  userError:    null,  showExtras:   false,
  // filters
  facet:        null,      // { kind:'rarity'|'type'|'domain', id }
  missingOnly:  false,
  forTrade:     false,
  wishlist:     false,
  copyDone:     false,
  // orders
  transitOrders:   JSON.parse(localStorage.getItem('rb_transit_orders') || '[]'),
  wantOrders:      JSON.parse(localStorage.getItem('rb_want_orders') || '[]'),
  expandedTransit: new Set(),
  skippedSets:     new Set(JSON.parse(localStorage.getItem('rb_skipped_sets') || '[]')),
  // dialogs
  userOpen:  false,
  userInput: '',
  addOpen:   false,
  addKind:   'transit',    // 'transit' | 'want'
  addText:   '',
  addLabel:  '',
  // mobile layout
  mobileSets:     false,    // set-tiles strip expanded
  mobileFilters:  false,    // filters/orders drawer open
  headerMenuOpen: false,    // mobile header dropdown
};
if (state.username) state.phase = 'loading';

// ── Transit / Want helpers ─────────────────────────────────────────
function transitTotals() {
  const map = new Map();
  for (const order of state.transitOrders) {
    if (order.enabled === false) continue;
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
    for (const it of order.items) map.set(it.normId, (map.get(it.normId) || 0) + it.qty);
  }
  return map;
}
function saveTransitOrder(label, items) {
  state.transitOrders = [{
    id: crypto.randomUUID(), label: label.trim() || new Date().toLocaleDateString(),
    date: new Date().toISOString(), enabled: true, items,
  }, ...state.transitOrders];
  localStorage.setItem('rb_transit_orders', JSON.stringify(state.transitOrders));
}
function removeTransitOrder(id) {
  state.transitOrders = state.transitOrders.filter(o => o.id !== id);
  state.expandedTransit.delete(id);
  localStorage.setItem('rb_transit_orders', JSON.stringify(state.transitOrders));
}
function toggleTransitOrder(id) {
  state.transitOrders = state.transitOrders.map(o =>
    o.id === id ? { ...o, enabled: o.enabled === false } : o);
  localStorage.setItem('rb_transit_orders', JSON.stringify(state.transitOrders));
}
function removeTransitItem(orderId, nId) {
  state.transitOrders = state.transitOrders
    .map(o => o.id === orderId ? { ...o, items: o.items.filter(it => it.normId !== nId) } : o)
    .filter(o => o.items.length > 0);
  localStorage.setItem('rb_transit_orders', JSON.stringify(state.transitOrders));
}
function saveWantOrder(label, items) {
  state.wantOrders = [{
    id: crypto.randomUUID(), label: label.trim() || new Date().toLocaleDateString(),
    date: new Date().toISOString(), items,
  }, ...state.wantOrders];
  localStorage.setItem('rb_want_orders', JSON.stringify(state.wantOrders));
}
function removeWantOrder(id) {
  state.wantOrders = state.wantOrders.filter(o => o.id !== id);
  localStorage.setItem('rb_want_orders', JSON.stringify(state.wantOrders));
}

// ── Parsing (add dialog) ───────────────────────────────────────────
function parseWantText(text) {
  const nameByNormId = new Map();
  for (const c of state.cards) nameByNormId.set(normId(c.id), c.name || normId(c.id));
  const itemMap = new Map(), unmatched = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s*[xX]\s*([A-Za-z]+-\d+\*?)$/);
    if (!match) { unmatched.push(`Cannot parse: "${line}"`); continue; }
    const qty = parseInt(match[1]);
    const nId = match[2].toUpperCase();
    const name = nameByNormId.get(nId);
    if (!name) { unmatched.push(`${nId} — not in catalog`); continue; }
    const ex = itemMap.get(nId) || { normId: nId, name, qty: 0 };
    ex.qty += qty;
    itemMap.set(nId, ex);
  }
  return { items: [...itemMap.values()], unmatched };
}
function parseTransitText(text) {
  const nameByNormId = new Map();
  for (const c of state.cards) nameByNormId.set(normId(c.id), c.name || normId(c.id));
  const setIds = SETS.map(s => s.id);
  const itemMap = new Map(), unmatched = [];
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(?:(\d+)\s*[xX]?\s*)?([A-Za-z]{2,4})[-\s]?0*(\d{1,3})(\*?)$/);
    if (!match) { unmatched.push(line); continue; }
    const qty = parseInt(match[1] || '1');
    const code = match[2].toUpperCase();
    if (setIds.indexOf(code) < 0) { unmatched.push(`${line} — unknown set`); continue; }
    const nId  = `${code}-${String(parseInt(match[3])).padStart(3, '0')}${match[4] || ''}`;
    const name = nameByNormId.get(nId);
    if (!name) { unmatched.push(`${line} — not in catalog`); continue; }
    const ex = itemMap.get(nId) || { normId: nId, name, normal: 0, foil: 0 };
    ex.normal += qty;
    itemMap.set(nId, ex);
  }
  return { items: [...itemMap.values()], unmatched };
}
function parseCMOrderHtml(html) {
  const doc  = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('tr[data-amount]'));
  if (!rows.length) return { items: [], unmatched: ['No table rows found.'] };
  const nameByNormId = new Map();
  for (const c of state.cards) nameByNormId.set(normId(c.id), c.name || normId(c.id));
  const itemMap = new Map(), unmatched = [];
  for (const row of rows) {
    const amount  = parseInt(row.dataset.amount) || 1;
    const setCode = EXPANSION_TO_CODE[row.dataset.expansionName || ''];
    if (!setCode) { unmatched.push(`Unknown expansion: "${row.dataset.expansionName}"`); continue; }
    const num = parseInt(row.dataset.number || '', 10);
    if (isNaN(num)) { unmatched.push(`Bad number: "${row.dataset.number}"`); continue; }
    const nId  = `${setCode}-${String(num).padStart(3, '0')}`;
    const foil = !!row.querySelector('[aria-label="Foil"]');
    const name = nameByNormId.get(nId);
    if (!name) { unmatched.push(`${nId} — not in catalog`); continue; }
    const ex = itemMap.get(nId) || { normId: nId, name, normal: 0, foil: 0 };
    if (foil) ex.foil += amount; else ex.normal += amount;
    itemMap.set(nId, ex);
  }
  return { items: [...itemMap.values()], unmatched };
}
function parseAdd() {
  if (state.addKind === 'want') return parseWantText(state.addText);
  if (/<tr/i.test(state.addText)) return parseCMOrderHtml(state.addText);
  return parseTransitText(state.addText);
}

// ── Ownership / missing ────────────────────────────────────────────
function ownedTotal(id) {
  const nid = normId(id);
  const u   = state.userCards[nid];
  const base = u ? (u.normal || 0) + (u.foil || 0) : 0;
  const tt  = transitTotals().get(nid) || { normal: 0, foil: 0 };
  const transitCount = tt.normal + tt.foil;
  const wt  = wantTotals().get(nid) || 0;
  return base + transitCount + Math.max(0, wt - transitCount);
}
function isMissingForMode(card, pooled) {
  if (state.viewMode === 'master') {
    const t = masterTarget(card);
    if (t === null) return false;
    const count = pooled ? (pooled.get(baseNormId(normId(card.id))) || 0) : ownedTotal(card.id);
    return count < t;
  }
  return ownedTotal(card.id) === 0;
}
function buildPooledMap() {
  if (state.viewMode !== 'master') return null;
  const tt = transitTotals(), wt = wantTotals(), map = new Map();
  for (const c of state.cards) {
    const nId = normId(c.id), bId = baseNormId(nId), u = state.userCards[nId] || {};
    const trans = tt.get(nId) || { normal: 0, foil: 0 };
    const transitCount = trans.normal + trans.foil;
    const want = wt.get(nId) || 0;
    const owned = (u.normal || 0) + (u.foil || 0) + transitCount + Math.max(0, want - transitCount);
    map.set(bId, (map.get(bId) || 0) + owned);
  }
  return map;
}

// ── Filters ────────────────────────────────────────────────────────
function clearFilters() {
  state.missingOnly = false;
  state.forTrade    = false;
  state.wishlist    = false;
  state.facet       = null;
}
function cardsForSet(setId) {
  if (!setId || setId === 'all') return state.cards;
  return state.cards.filter(c => c.set?.value?.id === setId);
}
function filteredCards() {
  const pooled = buildPooledMap();
  let cards = cardsForSet(state.selectedSet).filter(c => state.showExtras || !isExtraCard(c));
  if (state.facet) {
    const { kind, id } = state.facet;
    cards = cards.filter(c => {
      if (kind === 'rarity') return c.rarity?.value?.id === id;
      if (kind === 'type')   return (c.cardType?.type || []).some(ct => ct.id === id);
      if (kind === 'domain') return (c.domain?.values || []).some(d => d.id === id);
      return true;
    }).filter(c => isMissingForMode(c, pooled));
  }
  if (state.missingOnly) cards = cards.filter(c => isMissingForMode(c, pooled));
  if (state.forTrade)    cards = cards.filter(c => (state.userCards[normId(c.id)]?.trade || 0) > 0);
  if (state.wishlist)    cards = cards.filter(c => (state.userCards[normId(c.id)]?.wish  || 0) > 0);
  return cards;
}
function copyList() {
  const cards = filteredCards();
  if (!cards.length) return;
  const lines = cards.map(c => `1x ${c.name || normId(c.id)} (${normId(c.id)})`);
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    state.copyDone = true; m.redraw();
    setTimeout(() => { state.copyDone = false; m.redraw(); }, 1600);
  }).catch(() => {});
}

// ── Stats ──────────────────────────────────────────────────────────
function computeStats(setId) {
  let base = cardsForSet(setId).filter(c => state.showExtras || !isExtraCard(c));
  if (!setId || setId === 'all') base = base.filter(c => !state.skippedSets.has(c.set?.value?.id));
  const pooled = buildPooledMap();
  let uniqueTotal = 0, uniqueHave = 0, masterTotal = 0, masterHave = 0;
  const rarityMiss = {}, typeMiss = {}, domainMiss = {};
  for (const card of base) {
    const owned = ownedTotal(card.id);
    uniqueTotal++;
    if (owned > 0) uniqueHave++;
    if (isMissingForMode(card, pooled)) {
      const rId = card.rarity?.value?.id || 'unknown';
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
      const count = pooled ? (pooled.get(baseNormId(normId(card.id))) || 0) : owned;
      masterHave += Math.min(count, target);
    }
  }
  return {
    uniqueTotal, uniqueHave, masterTotal, masterHave,
    rarityMiss: Object.entries(rarityMiss).map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => (RARITY_ORDER.indexOf(a.id) < 0 ? 99 : RARITY_ORDER.indexOf(a.id)) -
                      (RARITY_ORDER.indexOf(b.id) < 0 ? 99 : RARITY_ORDER.indexOf(b.id))),
    typeMiss: Object.entries(typeMiss).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count),
    domainMiss: Object.entries(domainMiss).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count),
  };
}
function setSummary(setId) {
  const s = computeStats(setId);
  const total = state.viewMode === 'unique' ? s.uniqueTotal : s.masterTotal;
  const have  = state.viewMode === 'unique' ? s.uniqueHave  : s.masterHave;
  const pct = total > 0 ? Math.floor(have / total * 10000) / 100 : 0;
  return { total, have, missing: total - have, pct, stats: s };
}

// ── Data loading ───────────────────────────────────────────────────
async function loadCards() { state.cards = await getCardCatalog(); }

async function loadUserCollection(username, bust = false) {
  const key = `rb_user_v2_${username}`, tsKey = `rb_user_v2_ts_${username}`;
  if (!bust) {
    const raw = localStorage.getItem(key), ts = localStorage.getItem(tsKey);
    if (raw && ts && Date.now() - +ts < USER_TTL) {
      const cached = JSON.parse(raw);
      if (Object.keys(cached).length > 0) { state.userCards = cached; return; }
    }
  }
  const res = await fetchCollection(username);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  if (!data.collection || !Array.isArray(data.collection))
    throw new Error(`No collection found for "${username}". Check the username.`);
  state.userCards = {};
  for (const e of data.collection) {
    if (!e.card) continue;
    state.userCards[e.card.toUpperCase()] = {
      normal: +e.standard || 0, foil: +e.foil || 0, trade: +e.trade || 0, wish: +e.wish || 0,
    };
  }
  if (Object.keys(state.userCards).length > 0) {
    localStorage.setItem(key, JSON.stringify(state.userCards));
    localStorage.setItem(tsKey, String(Date.now()));
  }
}
async function init(bust = false) {
  state.phase = 'loading'; state.loadError = null; state.userError = null; m.redraw();
  try { await loadCards(); }
  catch (e) { state.loadError = e.message; state.phase = 'main'; m.redraw(); return; }
  if (state.username) {
    try { await loadUserCollection(state.username, bust); }
    catch (e) { state.userError = e.message; }
  }
  state.phase = 'main'; m.redraw();
}
async function refresh() {
  if (!state.username) return;
  state.userError = null; state.phase = 'loading'; m.redraw();
  try { await loadUserCollection(state.username, true); }
  catch (e) { state.userError = e.message; }
  state.phase = 'main'; m.redraw();
}
function switchUser(name) {
  const u = (name || '').trim().replace(/^@/, '');
  if (!u) return;
  localStorage.setItem('rb_username', u);
  addUser(u);
  Object.assign(state, {
    username: u, userCards: {}, userOpen: false, userInput: '',
    facet: null, missingOnly: false, forTrade: false, wishlist: false, selectedCard: null,
  });
  init();
}

// ── Components ─────────────────────────────────────────────────────
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('rb_theme', state.theme);
  applyTheme();
}
const ThemeToggle = {
  view: () => m('button.theme-toggle', {
    class: state.theme === 'dark' ? 'dark' : '',
    title: state.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    'aria-label': 'Toggle theme',
    onclick: toggleTheme,
  }, m('span.theme-toggle-knob', state.theme === 'dark' ? '\u263E' : '\u2600')),
};

const Brand = { view: () => m('.brand', [m('span', m.trust(LOGO_SVG)), m('span.brand-name', ['Rift', m('b', 'Bro')])]) };

const SetupScreen = {
  view() {
    return m('.setup', [
      m('.setup-mark', [m('span', m.trust(LOGO_SVG)), m('span.brand-name.display', { style: { fontSize: '24px' } }, ['Rift', m('b', 'Bro')])]),
      m('h1.setup-title', 'Card Collection'),
      m('p.setup-sub', 'Enter your riftbound.gg username to load your collection.'),
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
        m('input.field', {
          list: 'rb-users', placeholder: 'riftbound.gg username', value: state.username,
          oninput: e => state.username = e.target.value, spellcheck: false,
        }),
        m('datalist', { id: 'rb-users' }, getUsers().map(u => m('option', { value: u }))),
        m('button.btn-solid[type=submit]', 'View'),
      ]),
    ]);
  },
};

const LoadingScreen = {
  view: () => m('.loading', [
    m('span', m.trust(LOGO_SVG)),
    m('.loading-dots', [m('span'), m('span'), m('span')]),
    m('p.loading-text', 'Loading collection\u2026'),
  ]),
};

const Header = {
  view() {
    const closeMenu = () => state.headerMenuOpen = false;
    return m('header.app-header', [
      m('.app-header-inner', [
        m('.brand-row', [m(Brand), m(ThemeToggle)]),
        m('.header-actions', [
          m('button.user-btn', { title: 'Switch collection', onclick: () => { state.userOpen = true; state.userInput = ''; } }, [
            m('span.dot'),
            m('span.name', state.username || 'No user'),
            m('span.caret', '\u25BE'),
          ]),
          m('button.icon-btn', { title: 'Refresh collection', onclick: refresh }, '\u21BB'),
          m('button.btn-primary', { onclick: () => openAdd('transit') }, '\uFF0B Add order'),
          m('button.btn-ghost', { onclick: () => openAdd('want') }, '\u2665 Want'),
        ]),
        m('button.header-burger', { class: state.headerMenuOpen ? 'on' : '', title: 'Menu', onclick: () => state.headerMenuOpen = !state.headerMenuOpen }, state.headerMenuOpen ? '\u2715' : '\u2630'),
      ]),
      state.headerMenuOpen ? m('.header-menu-backdrop', { onclick: closeMenu }) : null,
      state.headerMenuOpen ? m('.header-menu', [
        m('button.header-menu-item', { onclick: () => { closeMenu(); state.userOpen = true; state.userInput = ''; } }, [
          m('span.hmi-ic', '\uD83D\uDC64'),
          m('span.hmi-text', [m('b', state.username || 'No user'), m('span', 'Switch collection')]),
        ]),
        m('button.header-menu-item', { onclick: () => { closeMenu(); refresh(); } }, [
          m('span.hmi-ic', '\u21BB'), m('span.hmi-text', m('b', 'Refresh collection')),
        ]),
        m('button.header-menu-item', { onclick: () => { closeMenu(); openAdd('transit'); } }, [
          m('span.hmi-ic.brand', '\uFF0B'), m('span.hmi-text', m('b', 'Add order')),
        ]),
        m('button.header-menu-item', { onclick: () => { closeMenu(); openAdd('want'); } }, [
          m('span.hmi-ic.heart', '\u2665'), m('span.hmi-text', m('b', 'Want list')),
        ]),
      ]) : null,
    ]);
  },
};

const BottomNav = {
  view() {
    return m('nav.bottom-nav', [
      m('button.bnav-item', { class: state.viewMode === 'unique' ? 'active' : '', onclick: () => { state.viewMode = 'unique'; state.facet = null; } }, [
        m('span.bnav-ic', '\u25C8'), m('span.bnav-label', 'Master Collection'),
      ]),
      m('button.bnav-item', { class: state.viewMode === 'master' ? 'active' : '', onclick: () => { state.viewMode = 'master'; state.facet = null; } }, [
        m('span.bnav-ic', '\u2694'), m('span.bnav-label', 'Play Set'),
      ]),
    ]);
  },
};

const FilterFab = {
  view() {
    const anyFilter = state.missingOnly || state.forTrade || state.wishlist || !!state.facet;
    return m('button.filter-fab', { title: 'Filters & orders', onclick: () => state.mobileFilters = true }, [
      m('span.fab-ic', '\u2699'),
      anyFilter ? m('span.fab-dot') : null,
    ]);
  },
};

const SetTiles = {
  view() {
    const tiles = [{ id: 'all', code: 'ALL', name: 'All Sets' },
      ...SETS.map(s => ({ id: s.id, code: s.code, name: s.label }))];
    return m('.set-grid', tiles.map(t => {
      const { total, have, missing, pct } = setSummary(t.id);
      const sel = state.selectedSet === t.id;
      const done = total > 0 && missing === 0;
      return m('button.set-tile', {
        key: t.id, class: sel ? 'active' : '',
        onclick: () => { state.selectedSet = t.id; state.facet = null; },
      }, [
        m('.set-tile-top', [
          m('span.set-tile-code', { class: t.id === 'all' ? 'all' : '' }, t.code),
          m('span.set-tile-name', t.name),
        ]),
        m('.set-tile-mid', [
          m('span.set-tile-missing', { class: done ? 'complete' : '' }, missing),
          m('span.set-tile-misslabel', done ? 'complete' : 'missing'),
        ]),
        m('.set-tile-bar', m('.set-tile-bar-fill', { class: done ? 'complete' : '', style: { width: `${pct}%` } })),
        m('.set-tile-bot', [
          m('span.set-tile-have', `${have} / ${total}`),
          m('span.set-tile-pct', { class: done ? 'complete' : '' }, `${pct.toFixed(2)}%`),
        ]),
      ]);
    }));
  },
};

function facetRow(kind, item, color, max, isGem) {
  const active = state.facet && state.facet.kind === kind && state.facet.id === item.id;
  const pct = Math.round(item.count / max * 100);
  return m('button.facet-row', {
    key: item.id,
    style: active ? { background: hexA(color, 0.09) } : {},
    onclick: () => { state.facet = active ? null : { kind, id: item.id }; },
  }, [
    m('.facet-row-top', [
      kind === 'type'
        ? m('span.facet-icon', TYPE_ICON[item.id] || '\u25C6')
        : m(isGem ? 'span.facet-gem' : 'span.facet-dot', { style: { background: color, ...(isGem ? { boxShadow: `0 0 0 2px ${hexA(color, 0.18)}` } : {}) } }),
      m('span.facet-label', item.label),
      m('span.facet-count', item.count),
    ]),
    m('.facet-bar', m('.facet-bar-fill', { style: { width: `${pct}%`, background: kind === 'type' ? '#8B86E8' : color } })),
  ]);
}

const Breakdown = {
  view() {
    const s = computeStats(state.selectedSet);
    const hasAny = s.rarityMiss.length || s.typeMiss.length || s.domainMiss.length;
    const maxR = Math.max(1, ...s.rarityMiss.map(r => r.count));
    const maxT = Math.max(1, ...s.typeMiss.map(t => t.count));
    const maxD = Math.max(1, ...s.domainMiss.map(d => d.count));
    return m('.panel', [
      m('.panel-head', [
        m('h2.panel-title', 'Missing breakdown'),
        m('span.panel-badge', state.selectedSet === 'all' ? 'All sets' : state.selectedSet),
      ]),
      m('p.panel-hint', { style: { marginBottom: '12px' } }, 'Tap a row to filter the grid.'),
      s.rarityMiss.length ? m('.facet-group', [
        m('.facet-group-label', 'By rarity'),
        s.rarityMiss.map(r => facetRow('rarity', r, RARITY_COLOR[r.id] || '#8A92A0', maxR, true)),
      ]) : null,
      s.typeMiss.length ? m('.facet-group', [
        m('.facet-group-label', 'By type'),
        s.typeMiss.map(t => facetRow('type', t, '#5B53E0', maxT, false)),
      ]) : null,
      s.domainMiss.length ? m('.facet-group', [
        m('.facet-group-label', 'By color'),
        s.domainMiss.map(d => facetRow('domain', d, DOMAIN_COLOR[d.id] || '#8A92A0', maxD, false)),
      ]) : null,
      !hasAny ? m('.empty-good', [m('span', '\u2713'), ' Every card here is collected. Nice.']) : null,
    ]);
  },
};

const TransitPanel = {
  view() {
    return m('.panel', [
      m('.panel-head', [
        m('h2.panel-title', [m('span.ic-warn', '\u231B'), 'In transit']),
        m('button.panel-add', { onclick: () => openAdd('transit') }, '\uFF0B Add'),
      ]),
      state.transitOrders.length ? m('.order-list', state.transitOrders.map(o => {
        const off = o.enabled === false;
        const expanded = state.expandedTransit.has(o.id);
        const n = o.items.reduce((s, it) => s + (it.normal || 0) + (it.foil || 0), 0);
        const toggleExpand = () => {
          if (expanded) state.expandedTransit.delete(o.id);
          else state.expandedTransit.add(o.id);
        };
        return m('div', { key: o.id }, [
          m('.order-row.transit', { class: off ? 'off' : '' }, [
            m('button.order-switch', { class: off ? '' : 'on', title: off ? 'Enable order' : 'Disable order', onclick: () => toggleTransitOrder(o.id) }, m('span.order-switch-knob')),
            m('.order-info', { onclick: toggleExpand }, [
              m('.order-label', o.label),
              m('.order-meta', `${n} card${n !== 1 ? 's' : ''} \u00b7 ${new Date(o.date).toLocaleDateString()}`),
            ]),
            m('button.order-btn.order-expand', { title: expanded ? 'Hide cards' : 'Show cards', onclick: toggleExpand }, expanded ? '\u25B2' : '\u25BC'),
            m('button.order-btn', { title: 'Remove order', onclick: () => removeTransitOrder(o.id) }, '\u2715'),
          ]),
          expanded ? m('.order-items', o.items.map(it => m('.order-item', { key: it.normId }, [
            m('span.order-item-name', it.name),
            m('span.order-item-id', it.normId),
            m('span.order-item-qty', `N ${it.normal || 0}${it.foil ? ` · F ${it.foil}` : ''}`),
            m('button.order-btn', { title: 'Remove card', onclick: () => removeTransitItem(o.id, it.normId) }, '\u2715'),
          ]))) : null,
        ]);
      })) : m('p.panel-hint', 'Nothing on the way. Add an order and those cards count toward what you have — so your missing list stays honest.'),
    ]);
  },
};

const WantPanel = {
  view() {
    return m('.panel', [
      m('.panel-head', [
        m('h2.panel-title', [m('span.ic-heart', '\u2665'), 'Want list']),
        m('button.panel-add.heart', { onclick: () => openAdd('want') }, '\uFF0B Add'),
      ]),
      state.wantOrders.length ? m('.order-list', state.wantOrders.map(o => {
        const n = o.items.reduce((s, it) => s + (it.qty || 0), 0);
        return m('.order-row.want', { key: o.id }, [
          m('.order-info', { style: { cursor: 'default' } }, [
            m('.order-label', o.label),
            m('.order-meta', `${o.items.length} card${o.items.length !== 1 ? 's' : ''} \u00b7 \u00d7${n} \u00b7 ${new Date(o.date).toLocaleDateString()}`),
          ]),
          m('button.order-btn', { title: 'Remove', onclick: () => removeWantOrder(o.id) }, '\u2715'),
        ]);
      })) : m('p.panel-hint', 'No wants yet. Jot down the cards you\u2019re hunting and copy the list when you trade.'),
    ]);
  },
};

const GridToolbar = {
  view() {
    const cards = filteredCards();
    const hasUser = Object.keys(state.userCards).length > 0;
    const anyFilter = state.missingOnly || state.forTrade || state.wishlist || !!state.facet;
    const compact = state.density === 'compact';
    const setDensity = d => { state.density = d; localStorage.setItem('rb_density', d); };
    return m('.grid-head', [
      m('.grid-count', [m('b', cards.length), m('span', 'cards shown')]),
      m('.density', [
        m('button', { class: !compact ? 'active' : '', title: 'Comfortable', onclick: () => setDensity('comfortable') }, '\u25A6'),
        m('button', { class: compact ? 'active' : '', title: 'Compact', onclick: () => setDensity('compact') }, '\u25A5'),
      ]),
      m('.grid-filters', [
        hasUser ? m('button.fbtn', { class: state.missingOnly ? 'on' : '', onclick: () => state.missingOnly = !state.missingOnly }, '\u25CE Missing only') : null,
        hasUser ? m('button.fbtn.trade', { class: state.forTrade ? 'on' : '', onclick: () => state.forTrade = !state.forTrade }, '\u21C4 For trade') : null,
        hasUser ? m('button.fbtn.wish', { class: state.wishlist ? 'on' : '', onclick: () => state.wishlist = !state.wishlist }, '\u2665 Wishlist') : null,
        cards.length ? m('button.fbtn.copy', { class: state.copyDone ? 'on' : '', onclick: copyList }, state.copyDone ? '\u2713 Copied' : '\u29C9 Copy list') : null,
        anyFilter ? m('button.fbtn.clear', { onclick: clearFilters }, '\u2715 Clear') : null,
      ]),
    ]);
  },
};

function tileArt(card, opts = {}) {
  const dc = domainColor(card), rc = rarityColor(card);
  const img = card.cardImage?.url;
  const missing = opts.missing;
  return [
    img
      ? m('img.tile-img', { src: img, alt: card.name || card.id, loading: 'lazy' })
      : m('.tile-bg', { style: { background: `linear-gradient(155deg, ${hexA(dc, 0.10)}, ${hexA(dc, 0.26)})`, filter: missing ? 'grayscale(0.75)' : 'none', opacity: missing ? 0.6 : 1 } },
          m('span.tile-glyph', { style: { color: dc } }, typeGlyph(card))),
    m('span.tile-gem', { style: { background: rc } }),
  ];
}

const CardGrid = {
  view() {
    const cards = filteredCards();
    const hasUser = Object.keys(state.userCards).length > 0;
    const pooled = buildPooledMap();
    if (!cards.length) return m('.grid-empty', 'No cards match these filters.');
    return m('.card-grid', { class: state.density === 'compact' ? 'compact' : '' }, cards.map(card => {
      const u = state.userCards[normId(card.id)] || {};
      const missing = hasUser && isMissingForMode(card, pooled);
      const owned = ownedTotal(card.id);
      const foil = (u.foil || 0) > 0;
      return m('button.tile', { key: card.id, class: missing ? 'missing' : '', onclick: () => state.selectedCard = card }, [
        m('.tile-art', [
          ...tileArt(card, { missing }),
          foil ? m('span.tile-foil', '\u2726') : null,
          m('span.tile-status', { class: missing ? 'need' : '' }, missing ? 'NEED' : `\u00d7${owned}`),
        ]),
        m('.tile-foot', [
          m('span.tile-name', card.name || normId(card.id)),
          m('span.tile-id', normId(card.id)),
        ]),
      ]);
    }));
  },
};

const CardModal = {
  view() {
    if (!state.selectedCard) return null;
    const c = state.selectedCard;
    const u = state.userCards[normId(c.id)] || {};
    const tt = transitTotals().get(normId(c.id));
    const wt = wantTotals().get(normId(c.id));
    const dc = domainColor(c), rc = rarityColor(c), img = c.cardImage?.url;
    const counts = [
      { val: u.normal || 0, label: 'Normal', color: '#1A1D26' },
      { val: u.foil   || 0, label: 'Foil',   color: '#E0930B' },
      { val: u.trade  || 0, label: 'Trade',  color: '#0C8CE0' },
      { val: u.wish   || 0, label: 'Wish',   color: '#E5484D' },
    ];
    if (tt) counts.push({ val: tt.normal + tt.foil, label: 'In transit', color: '#5B53E0' });
    if (wt) counts.push({ val: wt, label: 'Wanted', color: '#9B51E0' });
    return m('.overlay.center', { onclick: () => state.selectedCard = null }, [
      m('.modal-card.modal-detail', { onclick: e => e.stopPropagation() }, [
        m('.modal-art', { style: img ? {} : { background: `linear-gradient(155deg, ${hexA(dc, 0.12)}, ${hexA(dc, 0.3)})` } }, [
          img ? m('img.tile-img', { src: img, alt: c.name }) : m('span.modal-glyph', { style: { color: dc } }, typeGlyph(c)),
          m('span.modal-gem', { style: { background: rc } }),
        ]),
        m('.modal-body', [
          m('h3.modal-name', [c.name || normId(c.id), isSigned(c) ? m('span.add-qty', { style: { marginLeft: '8px' } }, '\u270D Signed') : null]),
          m('.modal-id', normId(c.id)),
          m('.modal-tags', [
            c.rarity?.value ? m('span.modal-rarity', { style: { color: rc } }, c.rarity.value.label) : null,
            (c.cardType?.type || []).length ? [m('span.sep', '\u00b7'), m('span.modal-tag', c.cardType.type.map(t => t.label).join(', '))] : null,
            (c.domain?.values || []).length ? [m('span.sep', '\u00b7'), m('span.modal-tag', c.domain.values.map(d => d.label).join(', '))] : null,
          ]),
          c.set?.value ? m('.modal-set', `${c.set.value.label} set`) : null,
          m('.modal-counts', counts.map(ct => m('.count-box', [
            m('span.count-val', { style: { color: ct.color } }, ct.val),
            m('span.count-lab', ct.label),
          ]))),
          m('button.modal-close', { onclick: () => state.selectedCard = null }, 'Close'),
        ]),
      ]),
    ]);
  },
};

const UserModal = {
  view() {
    if (!state.userOpen) return null;
    const users = getUsers();
    return m('.overlay.top', { onclick: () => { state.userOpen = false; state.userInput = ''; } }, [
      m('.modal-card.modal-pad', { style: { maxWidth: '430px' }, onclick: e => e.stopPropagation() }, [
        m('div', [
          m('h3.modal-h3', 'Switch collection'),
          m('p.modal-p', { style: { marginTop: '5px' } }, 'Enter a riftbound.gg username to load a different collection.'),
        ]),
        m('form.user-form', { onsubmit: e => { e.preventDefault(); switchUser(state.userInput); } }, [
          m('input.field', { placeholder: 'riftbound.gg username', value: state.userInput, oninput: e => state.userInput = e.target.value, spellcheck: false }),
          m('button.btn-solid[type=submit]', 'View'),
        ]),
        users.length ? m('.saved-list', [
          m('.saved-list-label', 'Recent'),
          users.map(name => m('.saved-row', { key: name }, [
            m('button.saved-select', { class: name === state.username ? 'active' : '', onclick: () => switchUser(name) }, [
              m('span.dot'),
              m('span.name', `@${name}`),
              name === state.username ? m('span.viewing', 'viewing') : null,
            ]),
            m('button.order-btn', { title: 'Remove', onclick: () => { removeUser(name); } }, '\u2715'),
          ])),
        ]) : null,
      ]),
    ]);
  },
};

const AddDialog = {
  view() {
    if (!state.addOpen) return null;
    const isTransit = state.addKind === 'transit';
    const p = parseAdd();
    const close = () => { state.addOpen = false; state.addText = ''; state.addLabel = ''; };
    return m('.overlay.top', { onclick: close }, [
      m('.modal-card.modal-pad', { style: { maxWidth: '520px' }, onclick: e => e.stopPropagation() }, [
        m('h3.modal-h3', isTransit ? 'Add an incoming order' : 'Add to want list'),
        m('p.modal-p', isTransit
          ? 'One card per line — e.g. “2x OGN-014”. You can also paste a Cardmarket order table. Matched cards count toward what you own.'
          : 'List the cards you’re hunting, one per line — e.g. “1x OGN-037”.'),
        m('textarea.add-text', {
          placeholder: isTransit ? '2x OGN-014\n1x SFD-007\nOGS-019' : '1x OGN-037\n2x UNL-021',
          value: state.addText, oninput: e => state.addText = e.target.value,
        }),
        p.items.length ? m('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } }, [
          m('.add-preview-label', `Matched ${p.items.length} card${p.items.length !== 1 ? 's' : ''}`),
          m('.add-list', p.items.map(it => m('.add-item', { key: it.normId }, [
            m('span.add-item-name', it.name),
            m('span.add-item-id', it.normId),
            m('span.add-qty', { class: isTransit ? '' : 'want' }, isTransit ? `N ${it.normal || 0}` : `\u00d7${it.qty}`),
          ]))),
          m('.add-label-row', [
            m('label', 'Label'),
            m('input.add-label-input', { value: state.addLabel, oninput: e => state.addLabel = e.target.value }),
          ]),
        ]) : null,
        p.unmatched.length ? m('.add-unmatched', [
          m('.add-unmatched-title', `${p.unmatched.length} line${p.unmatched.length !== 1 ? 's' : ''} not matched`),
          ...p.unmatched.map(s => m('.add-unmatched-row', s)),
        ]) : null,
        m('.add-actions', [
          p.items.length ? m('button.btn-solid', { onclick: () => { saveAdd(); } }, isTransit ? '\u2714 Save order' : '\u2714 Save wants') : null,
          m('button.add-cancel', { onclick: close }, 'Cancel'),
        ]),
      ]),
    ]);
  },
};

function openAdd(kind) {
  state.addOpen = true; state.addKind = kind; state.addText = ''; state.addLabel = today();
}
function saveAdd() {
  const p = parseAdd();
  if (!p.items.length) return;
  if (state.addKind === 'want') saveWantOrder(state.addLabel, p.items);
  else saveTransitOrder(state.addLabel, p.items);
  state.addOpen = false; state.addText = ''; state.addLabel = '';
}

const MainScreen = {
  view() {
    const all = setSummary('all');
    const summary = `${all.missing} ${state.viewMode === 'unique' ? 'unique cards' : 'play-set copies'} missing across ${SETS.length} sets`;
    const cur = setSummary(state.selectedSet);
    return m('div', [
      m(Header),
      m('main.page', [
        m('.page-head', [
          m('div', [
            m('h1.page-title', 'Your Collection'),
            m('p.page-sub', summary),
          ]),
          m('.view-toggle', [
            m('button', { class: state.viewMode === 'unique' ? 'active' : '', onclick: () => { state.viewMode = 'unique'; state.facet = null; } }, 'Master Collection'),
            m('button', { class: state.viewMode === 'master' ? 'active' : '', onclick: () => { state.viewMode = 'master'; state.facet = null; } }, 'Play Set'),
          ]),
        ]),
        state.userError ? m('.banner', `\u26A0 ${state.userError}`) : null,
        state.loadError ? m('.banner', `\u26A0 Cards failed to load: ${state.loadError}`) : null,
        // Mobile-only control bar
        m('.mobile-bar', [
          m('.mobile-bar-set', [
            m('span.mobile-bar-code', { class: state.selectedSet === 'all' ? 'all' : '' }, state.selectedSet === 'all' ? 'ALL' : state.selectedSet),
            m('span.mobile-bar-miss', [m('b', cur.missing), ' missing']),
          ]),
          m('button.mobile-toggle', { class: state.mobileSets ? 'on' : '', onclick: () => state.mobileSets = !state.mobileSets },
            [`\u25A6 Sets `, m('span.caret', state.mobileSets ? '\u25B2' : '\u25BC')]),
        ]),
        m('.sets-wrap', { class: state.mobileSets ? 'open' : '' }, m(SetTiles)),
        m('.dash', [
          state.mobileFilters ? m('.drawer-backdrop', { onclick: () => state.mobileFilters = false }) : null,
          m('aside.dash-side', { class: state.mobileFilters ? 'open' : '' }, [
            m('.drawer-head', [
              m('span.drawer-grab'),
              m('span.drawer-title', 'Filters & Orders'),
              m('button.drawer-close', { onclick: () => state.mobileFilters = false }, '\u2715'),
            ]),
            m('.drawer-scroll', [
              m(Breakdown),
              m(TransitPanel),
              m(WantPanel),
            ]),
            m('button.drawer-done', { onclick: () => state.mobileFilters = false }, 'View cards'),
          ]),
          m('section.dash-main', [
            m(GridToolbar),
            m(CardGrid),
          ]),
        ]),
      ]),
      m(FilterFab),
      m(BottomNav),
      m(CardModal),
      m(UserModal),
      m(AddDialog),
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

// ── Boot ───────────────────────────────────────────────────────────
applyTheme();
if (state.username) init();
m.mount(document.getElementById('app'), App);
