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

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic'];
const RARITY_COLOR = {
  common:       '#9ca3af',
  uncommon:     '#34d399',
  rare:         '#60a5fa',
  epic:         '#c084fc',
  overnumbered: '#f59e0b',
};

// -- Card helpers --
const isOvernumbered = c => c.rarity?.value?.id === 'overnumbered';
const isType = (c, t) => (c.cardType?.type || []).some(ct =>
  ct.id?.toLowerCase() === t || ct.label?.toLowerCase() === t);
const isRune        = c => isType(c, 'rune');
const isLegend      = c => isType(c, 'legend');
const isBattlefield = c => isType(c, 'battlefield');

// Normalize Firebase ID (e.g. "ogn-001-298") to DotGG format ("OGN-001")
const normId = id => id ? id.split('-').slice(0, 2).join('-').toUpperCase() : id;

function masterTarget(card) {
  if (isOvernumbered(card)) return null;
  if (isRune(card))         return null;
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
  chipRarity:    '',
  chipType:      '',
  chipDomain:    '',
};

if (state.username) state.phase = 'loading';

// -- Data helpers --
function ownedTotal(id) {
  const u = state.userCards[normId(id)];
  return u ? (u.normal || 0) + (u.foil || 0) : 0;
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
  const cards = cardsForSet(setId).filter(c => !isOvernumbered(c));
  let uniqueTotal = 0, uniqueHave = 0;
  let masterTotal = 0, masterHave = 0;
  const rarityMiss = {};
  const typeMiss   = {};
  const domainMiss = {};

  for (const card of cards) {
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

function filteredCards() {
  let cards = cardsForSet(state.selectedSet).filter(c => !isOvernumbered(c));
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
            m('.cg-name', card.name || normId(card.id)),
            m('.cg-id', normId(card.id)),
            hasUser ? m('.cg-badges', [
              m('.badge.n', `N ${u.normal || 0}`),
              m('.badge.f', `F ${u.foil   || 0}`),
              (u.trade || 0) > 0 ? m('.badge.t', `T ${u.trade}`) : null,
              (u.wish  || 0) > 0 ? m('.badge.w', `W ${u.wish}`)  : null,
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
          m('h2.modal-name', card.name || normId(card.id)),
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
          ]) : null,
        ]),
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
        ]),
      ]),
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
