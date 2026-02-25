import m from 'mithril';
import { addUser, getUsers } from '../../shared/savedUsers.js';

// ── Wake Lock ─────────────────────────────────────────────────────────────────
let wakeLock = null;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.phase === 'match' && state.match.winner === null) {
    acquireWakeLock();
  }
});

// ── Legends ───────────────────────────────────────────────────────────────────
const LEGENDS = [
  // Origins
  { id: 'ogn-247', imageId: 'OGN-247', name: 'Daughter of the Void',    champion: "Kai'Sa",       set: 'Origins' },
  { id: 'ogn-249', imageId: 'OGN-249', name: 'Relentless Storm',          champion: 'Volibear',     set: 'Origins' },
  { id: 'ogn-251', imageId: 'OGN-251', name: 'Loose Cannon',              champion: 'Jinx',         set: 'Origins' },
  { id: 'ogn-253', imageId: 'OGN-253', name: 'Hand of Noxus',             champion: 'Darius',       set: 'Origins' },
  { id: 'ogn-255', imageId: 'OGN-255', name: 'Nine-Tailed Fox',           champion: 'Ahri',         set: 'Origins' },
  { id: 'ogn-257', imageId: 'OGN-257', name: 'Blind Monk',                champion: 'Lee Sin',      set: 'Origins' },
  { id: 'ogn-259', imageId: 'OGN-259', name: 'Unforgiven',                champion: 'Yasuo',        set: 'Origins' },
  { id: 'ogn-261', imageId: 'OGN-261', name: 'Radiant Dawn',              champion: 'Leona',        set: 'Origins' },
  { id: 'ogn-263', imageId: 'OGN-263', name: 'Swift Scout',               champion: 'Teemo',        set: 'Origins' },
  { id: 'ogn-265', imageId: 'OGN-265', name: 'Herald of the Arcane',      champion: 'Viktor',       set: 'Origins' },
  { id: 'ogn-267', imageId: 'OGN-267', name: 'Bounty Hunter',             champion: 'Miss Fortune', set: 'Origins' },
  { id: 'ogn-269', imageId: 'OGN-269', name: 'The Boss',                  champion: 'Sett',         set: 'Origins' },
  // Proving Grounds Starters
  { id: 'ogs-017', imageId: 'OGS-017', name: 'Dark Child',                champion: 'Annie',        set: 'Proving Grounds' },
  { id: 'ogs-019', imageId: 'OGS-019', name: 'Wuju Bladesman',            champion: 'Master Yi',    set: 'Proving Grounds' },
  { id: 'ogs-021', imageId: 'OGS-021', name: 'Lady of Luminosity',        champion: 'Lux',          set: 'Proving Grounds' },
  { id: 'ogs-023', imageId: 'OGS-023', name: 'Might of Demacia',          champion: 'Garen',        set: 'Proving Grounds' },
  // Spiritforged
  { id: 'sfd-181', imageId: 'SFD-181', name: 'Mechanized Menace',         champion: 'Rumble',       set: 'Spiritforged' },
  { id: 'sfd-183', imageId: 'SFD-183', name: 'Purifier',                  champion: 'Lucian',       set: 'Spiritforged' },
  { id: 'sfd-185', imageId: 'SFD-185', name: 'Glorious Executioner',      champion: 'Draven',       set: 'Spiritforged' },
  { id: 'sfd-187', imageId: 'SFD-187', name: 'Void Burrower',             champion: "Rek'Sai",      set: 'Spiritforged' },
  { id: 'sfd-189', imageId: 'SFD-189', name: 'Fire Below the Mountain',   champion: 'Ornn',         set: 'Spiritforged' },
  { id: 'sfd-193', imageId: 'SFD-193', name: 'Grandmaster at Arms',       champion: 'Jax',          set: 'Spiritforged' },
  { id: 'sfd-195', imageId: 'SFD-195', name: 'Blade Dancer',              champion: 'Irelia',       set: 'Spiritforged' },
  { id: 'sfd-197', imageId: 'SFD-197', name: 'Emperor of the Sands',      champion: 'Azir',         set: 'Spiritforged' },
  { id: 'sfd-199', imageId: 'SFD-199', name: 'Prodigal Explorer',         champion: 'Ezreal',       set: 'Spiritforged' },
  { id: 'sfd-201', imageId: 'SFD-201', name: 'Chem-Baroness',             champion: 'Renata Glasc', set: 'Spiritforged' },
  { id: 'sfd-203', imageId: 'SFD-203', name: 'Battle Mistress',           champion: 'Sivir',        set: 'Spiritforged' },
  { id: 'sfd-205', imageId: 'SFD-205', name: 'Grand Duelist',             champion: 'Fiora',        set: 'Spiritforged' },
];

const SETS = [...new Set(LEGENDS.map(l => l.set))];

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  phase: 'setup', // 'setup' | 'match'

  // Setup inputs
  setup: {
    p1name: '',
    p1legend: '',
    p2name: '',
    p2legend: '',
    target: 8,
    firstPlayer: null, // null | 0 | 1
  },

  // Match state
  match: {
    players: [
      { name: '', legendName: '', champion: '', pointLog: [], animKey: 0, animLevel: '' },
      { name: '', legendName: '', champion: '', pointLog: [], animKey: 0, animLevel: '' },
    ],
    target: 8,
    activeTurn: 1,           // 0 = top (P1), 1 = bottom (P2)
    winner: null,            // null | 0 | 1
    timerSeconds: 3600,      // 60 minutes
    timerRunning: false,
    timerInterval: null,
  },
};

// ── Timer helpers ─────────────────────────────────────────────────────────────
function startTimer() {
  if (state.match.timerRunning) return;
  state.match.timerRunning = true;
  state.match.timerInterval = setInterval(() => {
    if (state.match.timerSeconds > 0) {
      state.match.timerSeconds--;
    } else {
      stopTimer();
    }
    m.redraw();
  }, 1000);
}

function stopTimer() {
  clearInterval(state.match.timerInterval);
  state.match.timerRunning = false;
}

function toggleTimer() {
  if (state.match.timerRunning) stopTimer();
  else startTimer();
  m.redraw();
}

function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── Match actions ─────────────────────────────────────────────────────────────
function addPoint(playerIdx, type) {
  if (state.match.winner !== null) return;
  const p = state.match.players[playerIdx];
  p.pointLog.push(type);
  const pts = p.pointLog.length;
  const tgt = state.match.target;
  // Determine animation intensity tier
  if (pts >= tgt)           p.animLevel = 'bump-win';
  else if (pts === tgt - 1) p.animLevel = 'bump-high';
  else if (pts >= tgt - 3)  p.animLevel = 'bump-mid';
  else                      p.animLevel = 'bump-low';
  p.animKey++;
  if (pts >= tgt) {
    state.match.winner = playerIdx;
    stopTimer();
    releaseWakeLock();
  }
}

function removePoint(playerIdx) {
  if (state.match.winner !== null) return;
  const p = state.match.players[playerIdx];
  if (p.pointLog.length > 0) p.pointLog.pop();
}

function endTurn() {
  if (state.match.winner !== null) return;
  state.match.activeTurn = state.match.activeTurn === 0 ? 1 : 0;
  // Auto-start timer on first end turn
  if (!state.match.timerRunning && state.match.timerSeconds === 3600) {
    startTimer();
  }
}

function startMatch() {
  const s = state.setup;
  const p1 = LEGENDS.find(l => l.id === s.p1legend);
  const p2 = LEGENDS.find(l => l.id === s.p2legend);

  if (s.p1name.trim()) addUser(s.p1name.trim());
  if (s.p2name.trim()) addUser(s.p2name.trim());

  state.match = {
    players: [
      { name: s.p1name.trim() || 'Player 1', legendName: p1 ? p1.name : '—', champion: p1 ? p1.champion : '', imageUrl: p1 ? `https://static.dotgg.gg/riftbound/cards/${p1.imageId}.webp` : '', pointLog: [], animKey: 0, animLevel: '' },
      { name: s.p2name.trim() || 'Player 2', legendName: p2 ? p2.name : '—', champion: p2 ? p2.champion : '', imageUrl: p2 ? `https://static.dotgg.gg/riftbound/cards/${p2.imageId}.webp` : '', pointLog: [], animKey: 0, animLevel: '' },
    ],
    target: s.target,
    activeTurn: s.firstPlayer ?? 0,
    winner: null,
    timerSeconds: 3600,
    timerRunning: false,
    timerInterval: null,
  };
  state.phase = 'match';
  acquireWakeLock();
}

function resetToSetup() {
  stopTimer();
  releaseWakeLock();
  state.phase = 'setup';
}

// ── Setup component ───────────────────────────────────────────────────────────
const Setup = {
  view() {
    const s = state.setup;
    const canStart = s.p1legend && s.p2legend && s.firstPlayer !== null;

    const legendDropdown = (value, onchange) =>
      m('select.setup-select', { value, onchange },
        m('option', { value: '', disabled: true }, '— Choose a legend —'),
        SETS.map(set =>
          m('optgroup', { label: set },
            LEGENDS.filter(l => l.set === set).map(l =>
              m('option', { value: l.id }, `${l.champion} – ${l.name}`)
            )
          )
        )
      );

    return m('.setup-page', [
      m('img.setup-logo', { src: `${import.meta.env.BASE_URL}logo.png`, alt: 'Riftbro' }),
      m('h1.setup-title', 'Match Setup'),

      m('.setup-form', [

        // Players
        m('.setup-players', [
          // Player 1
          m('datalist', { id: 'rb-users' },
            getUsers().map(u => m('option', { value: u }))
          ),
          m('.player-setup-card', [
            m('h3', 'Player 1'),
            m('input.setup-input', {
              type: 'text',
              list: 'rb-users',
              placeholder: 'Player name…',
              value: s.p1name,
              oninput: e => s.p1name = e.target.value,
              maxlength: 20,
            }),
            legendDropdown(s.p1legend, e => s.p1legend = e.target.value),
          ]),
          // Player 2
          m('.player-setup-card', [
            m('h3', 'Player 2'),
            m('input.setup-input', {
              type: 'text',
              list: 'rb-users',
              placeholder: 'Player name…',
              value: s.p2name,
              oninput: e => s.p2name = e.target.value,
              maxlength: 20,
            }),
            legendDropdown(s.p2legend, e => s.p2legend = e.target.value),
          ]),
        ]),

        // Points target
        m('.setup-section', [
          m('h3', 'Points to win'),
          m('.pts-options', [
            m('button.pts-btn', {
              class: s.target === 8 ? 'pts-btn active' : 'pts-btn',
              onclick: () => s.target = 8,
            }, '8 pts'),
            m('button.pts-btn', {
              class: s.target === 9 ? 'pts-btn active' : 'pts-btn',
              onclick: () => s.target = 9,
            }, '9 pts'),
          ]),
        ]),

        // First player
        m('.setup-section', [
          m('h3', 'Who goes first?'),
          m('.first-player-options', [
            m('button.first-player-btn', {
              class: s.firstPlayer === 0 ? 'first-player-btn active' : 'first-player-btn',
              onclick: () => { s.firstPlayer = 0; },
            }, s.p1name.trim() || 'Player 1'),
            m('button.first-player-randomize', {
              title: 'Pick randomly',
              onclick: () => { s.firstPlayer = Math.random() < 0.5 ? 0 : 1; },
            }, '🎲'),
            m('button.first-player-btn', {
              class: s.firstPlayer === 1 ? 'first-player-btn active' : 'first-player-btn',
              onclick: () => { s.firstPlayer = 1; },
            }, s.p2name.trim() || 'Player 2'),
          ]),
          s.firstPlayer !== null && m('.first-player-result',
            `${s.firstPlayer === 0 ? (s.p1name.trim() || 'Player 1') : (s.p2name.trim() || 'Player 2')} goes first`
          ),
        ]),

        // Start
        m('button.start-btn', {
          disabled: !canStart,
          onclick: startMatch,
        }, 'Begin Match'),

        m('a.setup-home', { href: '../' }, '← Back to hub'),
      ]),
    ]);
  },
};

// ── Player half component ─────────────────────────────────────────────────────
const PlayerHalf = {
  view({ attrs: { playerIdx, position } }) {
    const match = state.match;
    const p = match.players[playerIdx];
    const pts = p.pointLog.length;
    const isActive = match.activeTurn === playerIdx;
    const isWinner = match.winner === playerIdx;
    const atTarget = pts >= match.target;

    const bgStyle = p.imageUrl
      ? `background-image: linear-gradient(rgba(7,7,15,0.62), rgba(7,7,15,0.72)), url('${p.imageUrl}'); background-size: cover; background-position: center 15%;`
      : '';

    // Point bar segments: index 0 = first point (bottom of bar via column-reverse)
    const segments = Array.from({ length: match.target }, (_, i) => ({
      filled: i < pts,
      type: p.pointLog[i] || null,
      isTop: i === pts - 1 && pts > 0, // liquid surface segment
    }));

    return m(`.player-half.${position}`, { class: isActive ? 'active-turn' : '', style: bgStyle }, [
      m('.turn-pip'),

      m('.player-name', p.name),
      m('.legend-name', p.champion
        ? `${p.legendName} · ${p.champion}`
        : p.legendName),

      m('.pts-display', { key: p.animKey, class: [atTarget ? 'at-target' : '', p.animLevel].filter(Boolean).join(' ') }, pts),

      // Per-point flash burst — keyed so it always replays on new points
      p.animKey > 0 && m('.score-flash', { key: `flash-${p.animKey}`, class: p.animLevel }),

      m('.action-btns', [
        m('button.action-btn.conquer-btn', {
          onclick: () => { addPoint(playerIdx, 'conquer'); },
          disabled: match.winner !== null,
        }, [m('span.action-icon', '⚔'), m('span.action-label', 'Conquer')]),
        m('button.action-btn.hold-btn', {
          onclick: () => { addPoint(playerIdx, 'hold'); },
          disabled: match.winner !== null,
        }, [m('span.action-icon', '🛡'), m('span.action-label', 'Hold')]),
      ]),

      pts > 0 && match.winner === null
        ? m('button.undo-btn', { onclick: () => { removePoint(playerIdx); } }, '↩ Undo')
        : m('span.undo-placeholder'),

      // Vertical point bar — fills from bottom to top (column-reverse)
      m('.point-bar',
        segments.map(seg => {
          const cls = [
            seg.filled ? `filled ${seg.type}` : 'empty',
            seg.isTop ? 'liquid-top' : '',
          ].join(' ').trim();
          return m('.point-seg', { class: cls },
            seg.filled ? (seg.type === 'conquer' ? '⚔' : '🛡') : ''
          );
        })
      ),

      isWinner && m('.win-overlay', [
        m('.win-label', `🏆 ${p.name} wins!`),
        m('.win-sub', `${pts} points · ${formatTime(3600 - match.timerSeconds)} played`),
      ]),
    ]);
  },
};

// ── Divider strip ─────────────────────────────────────────────────────────────
const MatchDivider = {
  view() {
    const match = state.match;
    const secs = match.timerSeconds;
    let timerClass = 'timer-display';
    if (!match.timerRunning && secs < 3600) timerClass += ' paused';
    else if (secs <= 60)  timerClass += ' critical';
    else if (secs <= 300) timerClass += ' warning';

    return m('.match-divider', [

      // New game
      m('button.new-game-btn', { onclick: resetToSetup }, [
        m('span.btn-icon', '⟳'),
        m('span.btn-label', 'New'),
      ]),

      // Timer + turn dots
      m('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:6px;' }, [
        m('.turn-indicators', [
          m('.turn-dot', { class: match.activeTurn === 0 ? 'active' : '' }),
          m('.turn-dot', { class: match.activeTurn === 1 ? 'active' : '' }),
        ]),
        m('button.timer-btn', { onclick: toggleTimer, title: match.timerRunning ? 'Pause' : 'Resume' }, [
          m('.' + timerClass, formatTime(secs)),
          m('.timer-label', match.timerRunning ? 'tap to pause' : (secs < 3600 ? 'paused' : 'tap to start')),
        ]),
      ]),

      // End turn
      m('button.end-turn-btn', {
        onclick: endTurn,
        disabled: match.winner !== null,
      }, [
        m('span.btn-arrow', '⇄'),
        m('span.btn-label', 'End Turn'),
      ]),
    ]);
  },
};

// ── Match screen ──────────────────────────────────────────────────────────────
const Match = {
  view() {
    return m('.match-screen', [
      m(PlayerHalf, { playerIdx: 0, position: 'top' }),
      m(MatchDivider),
      m(PlayerHalf, { playerIdx: 1, position: 'bottom' }),
    ]);
  },
};

// ── Root component ────────────────────────────────────────────────────────────
const App = {
  view() {
    return state.phase === 'setup' ? m(Setup) : m(Match);
  },
};

m.mount(document.getElementById('app'), App);
