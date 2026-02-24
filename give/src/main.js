import m from 'mithril';
import { fetchUserList } from './parser.js';
import { compare } from './compare.js';
import { addUser, getUsers } from '../../shared/savedUsers.js';

// ── URL state sync ────────────────────────────────────────────────────────────
function getParams() {
  const p = new URLSearchParams(window.location.search);
  return { a: p.get('a') || '', b: p.get('b') || '' };
}

function setParams(a, b) {
  const p = new URLSearchParams();
  if (a) p.set('a', a);
  if (b) p.set('b', b);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

// ── App state ─────────────────────────────────────────────────────────────────
const state = {
  userA: getParams().a,
  userB: getParams().b,
  loading: false,
  error: null,
  resultsAtoB: null, // cards A (trader) can give to B (wishlist)
  resultsBtoA: null, // cards B (trader) can give to A (wishlist)
};

// ── Fetch & compare ───────────────────────────────────────────────────────────
async function findMatches() {
  if (!state.userA.trim() || !state.userB.trim()) return;

  state.loading = true;
  state.error = null;
  state.resultsAtoB = null;
  state.resultsBtoA = null;
  m.redraw();

  setParams(state.userA.trim(), state.userB.trim());
  addUser(state.userA.trim());
  addUser(state.userB.trim());

  try {
    const [dataA, dataB] = await Promise.all([
      fetchUserList(state.userA.trim()),
      fetchUserList(state.userB.trim()),
    ]);

    state.resultsAtoB = compare(dataA.tradeMap, dataB.wishlistMap, state.userA, state.userB);
    state.resultsBtoA = compare(dataB.tradeMap, dataA.wishlistMap, state.userB, state.userA);
  } catch (err) {
    state.error = err.message || 'Something went wrong. Please check the usernames and try again.';
  }

  state.loading = false;
  m.redraw();
}

// ── Components ────────────────────────────────────────────────────────────────

const Header = {
  view() {
    return m('.header', [
      m('img.logo', { src: `${import.meta.env.BASE_URL}logo.png`, alt: 'Riftbound Logo' }),
      m('a.header-nav-link', { href: '../' }, '← Home'),
      m('.header-title', 'Trade Matcher'),
    ]);
  },
};

const CardRow = {
  view({ attrs: { card, traderName, wishlistName } }) {
    return m('.card-row', [
      m('img.card-thumb', {
        src: card.imageUrl,
        alt: card.cardId,
        onerror(e) { e.target.src = `${import.meta.env.BASE_URL}no-image.png`; },
      }),
      m('.card-info', [
        m('.card-name', m('a', { href: card.cardUrl, target: '_blank', rel: 'noopener' }, card.cardId)),
        m('.card-meta', [
          m('.qty-chip', `${traderName}: ${card.tradeQty} available`),
          m('.qty-chip', `${wishlistName} wants: ${card.wantedQty}`),
          m('.qty-chip.can-give', `✓ Can give: ${card.canGive}`),
        ]),
      ]),
    ]);
  },
};

const ResultsSection = {
  view({ attrs: { results, traderName, wishlistName } }) {
    if (!results) return null;

    const directionLabel = `${traderName} → ${wishlistName}`;

    return m('.results-section', [
      m('h2', [
        directionLabel,
        m('span.count-badge', `${results.length} card${results.length !== 1 ? 's' : ''}`),
      ]),
      results.length === 0
        ? m('.status-empty', `No cards ${traderName} can trade to ${wishlistName}.`)
        : results.map((card) =>
            m(CardRow, {
              key: card.cardId,
              card,
              traderName,
              wishlistName,
            })
          ),
    ]);
  },
};

const App = {
  view() {
    const hasResults = state.resultsAtoB !== null || state.resultsBtoA !== null;

    return m('.app', [
      m(Header),

      m('.main', [
        // ── Input form ──
        m('.form-section', [
          m('h2', 'Enter two riftbound.gg usernames'),
          m('.user-inputs', [
            m('datalist', { id: 'rb-users' },
              getUsers().map(u => m('option', { value: u }))
            ),

            m('.input-group', [
              m('label', { for: 'userA' }, 'Trader (has cards to give)'),
              m('input', {
                id: 'userA',
                type: 'text',
                list: 'rb-users',
                placeholder: 'e.g. George Antonakos',
                value: state.userA,
                disabled: state.loading,
                oninput(e) { state.userA = e.target.value; },
                onkeydown(e) { if (e.key === 'Enter') findMatches(); },
              }),
            ]),

            m('button.swap-btn', {
              title: 'Swap users',
              disabled: state.loading,
              onclick() {
                const tmp = state.userA;
                state.userA = state.userB;
                state.userB = tmp;
              },
            }, '⇄'),

            m('.input-group', [
              m('label', { for: 'userB' }, 'Wishlist holder (wants cards)'),
              m('input', {
                id: 'userB',
                type: 'text',
                list: 'rb-users',
                placeholder: 'e.g. Kyle Grech',
                value: state.userB,
                disabled: state.loading,
                oninput(e) { state.userB = e.target.value; },
                onkeydown(e) { if (e.key === 'Enter') findMatches(); },
              }),
            ]),

            m('button.find-btn', {
              disabled: state.loading || !state.userA.trim() || !state.userB.trim(),
              onclick: findMatches,
            }, state.loading ? 'Loading…' : 'Find Matches'),
          ]),
        ]),

        // ── Status ──
        state.loading && m('.status-loading', 'Fetching collection data from riftbound.gg…'),
        state.error && m('.status-error', [m('strong', 'Error: '), state.error]),

        // ── Results ──
        hasResults && m('.results', [
          m(ResultsSection, {
            results: state.resultsAtoB,
            traderName: state.userA.trim(),
            wishlistName: state.userB.trim(),
          }),
          m(ResultsSection, {
            results: state.resultsBtoA,
            traderName: state.userB.trim(),
            wishlistName: state.userA.trim(),
          }),
        ]),
      ]),
    ]);
  },
};

// ── Auto-search on load if URL params are set ─────────────────────────────────
m.mount(document.getElementById('app'), App);

if (state.userA && state.userB) {
  findMatches();
}
