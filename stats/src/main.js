import m from 'mithril';
import Chart from 'chart.js/auto';

// ── Google Sheet data source ───────────────────────────────────────────────
const SHEET_ID = '1-4ZI3PLDuC0Qrd-9WfHAWQZZBgaqtkA8i9B1lLDrn8w';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json`;

// ── Archetype definitions ──────────────────────────────────────────────────
// Keyed by champion name (case-insensitive). Also matched against legend card name.
const ARCHETYPES = {
  Aggro:    { color: '#e05555', champions: ["Jinx","Draven","Volibear","Irelia","Sivir","Lucian","Teemo"] },
  Tempo:    { color: '#c8a951', champions: ["Ahri","Lee Sin","Yasuo","Jax","Ezreal","Kai'Sa","Master Yi","Rumble"] },
  Midrange: { color: '#4caf82', champions: ["Sett","Garen","Rek'Sai","Miss Fortune","Darius","Fiora"] },
  'Late Game': { color: '#6076e0', champions: ["Viktor","Ornn","Azir","Lux","Renata Glasc","Leona"] },
  Aurora:   { color: '#9b6fe0', champions: ["Annie"] },
};
const ARCHETYPE_UNKNOWN_COLOR = '#555570';

// Build a fast lookup Map: normalised name → archetype label
const ARCHETYPE_MAP = new Map();
for (const [label, { champions }] of Object.entries(ARCHETYPES)) {
  for (const c of champions) {
    ARCHETYPE_MAP.set(c.toLowerCase(), label);
  }
}

// Also map known legend card names to champion/archetype
const LEGEND_NAME_MAP = new Map([
  // Origins
  ["daughter of the void",    "Kai'Sa"],
  ["relentless storm",        "Volibear"],
  ["loose cannon",            "Jinx"],
  ["hand of noxus",           "Darius"],
  ["nine-tailed fox",         "Ahri"],
  ["blind monk",              "Lee Sin"],
  ["unforgiven",              "Yasuo"],
  ["radiant dawn",            "Leona"],
  ["swift scout",             "Teemo"],
  ["herald of the arcane",    "Viktor"],
  ["bounty hunter",           "Miss Fortune"],
  ["the boss",                "Sett"],
  // Proving Grounds
  ["dark child",              "Annie"],
  ["wuju bladesman",          "Master Yi"],
  ["lady of luminosity",      "Lux"],
  ["might of demacia",        "Garen"],
  // Spiritforged
  ["mechanized menace",       "Rumble"],
  ["purifier",                "Lucian"],
  ["glorious executioner",    "Draven"],
  ["void burrower",           "Rek'Sai"],
  ["fire below the mountain", "Ornn"],
  ["grandmaster at arms",     "Jax"],
  ["blade dancer",            "Irelia"],
  ["emperor of the sands",    "Azir"],
  ["prodigal explorer",       "Ezreal"],
  ["chem-baroness",           "Renata Glasc"],
  ["battle mistress",         "Sivir"],
  ["grand duelist",           "Fiora"],
]);

function resolveArchetype(rawLegend) {
  if (!rawLegend) return 'Unknown';
  const lower = rawLegend.trim().toLowerCase();
  // Try direct champion lookup first
  if (ARCHETYPE_MAP.has(lower)) return ARCHETYPE_MAP.get(lower);
  // Try legend-name lookup
  const champion = LEGEND_NAME_MAP.get(lower);
  if (champion && ARCHETYPE_MAP.has(champion.toLowerCase())) {
    return ARCHETYPE_MAP.get(champion.toLowerCase());
  }
  return 'Unknown';
}

function archetypeColor(archetype) {
  return ARCHETYPES[archetype]?.color ?? ARCHETYPE_UNKNOWN_COLOR;
}

// ── Date range filters ─────────────────────────────────────────────────────
const FILTERS = [
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'All time',     days: null },
];

// ── App state ──────────────────────────────────────────────────────────────
const state = {
  loading: false,
  error: null,
  rawRecords: [],   // all parsed records from sheet
  lastUpdated: null,
  filterIdx: 3,     // default: all time
};

// ── Data fetching & parsing ────────────────────────────────────────────────
function parseGvizDate(val) {
  // gviz Date values come as "Date(yyyy,m,d)" where month is 0-indexed
  if (!val) return null;
  const m = String(val).match(/Date\((\d+),(\d+),(\d+)\)/);
  if (m) {
    return new Date(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
  }
  // Fallback: try plain date string
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function toDateString(date) {
  return date.toISOString().slice(0, 10); // "yyyy-mm-dd"
}

function parseWin(val) {
  if (!val) return false;
  return /^w(in)?$/i.test(String(val).trim());
}

function parseCellValue(cell) {
  if (!cell) return '';
  if (cell.v !== undefined && cell.v !== null) return cell.v;
  if (cell.f !== undefined && cell.f !== null) return cell.f;
  return '';
}

async function loadData() {
  state.loading = true;
  state.error = null;
  m.redraw();

  try {
    const res = await fetch(SHEET_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    // Strip the JSONP wrapper: google.visualization.Query.setResponse({...});
    const jsonStart = text.indexOf('{');
    const jsonEnd   = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('Unexpected response format from Google Sheets.');
    const json = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

    const rows = json?.table?.rows ?? [];
    state.rawRecords = rows.map(row => {
      const cells = row.c ?? [];
      const dateVal  = parseCellValue(cells[0]);
      const deck     = String(parseCellValue(cells[1]) ?? '').trim();
      const legend   = String(parseCellValue(cells[2]) ?? '').trim();
      const result   = String(parseCellValue(cells[3]) ?? '').trim();
      const date     = parseGvizDate(dateVal);
      return {
        date,
        dateStr: date ? toDateString(date) : null,
        deck,
        legend,
        archetype: resolveArchetype(legend),
        win: parseWin(result),
      };
    }).filter(r => r.date !== null && r.deck !== '' && r.legend !== '');

    state.lastUpdated = new Date();
  } catch (err) {
    state.error = err.message || 'Failed to load data from Google Sheets.';
  }

  state.loading = false;
  m.redraw();
}

// ── Filtering ──────────────────────────────────────────────────────────────
function getFilteredRecords() {
  const { days } = FILTERS[state.filterIdx];
  if (!days) return state.rawRecords;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return state.rawRecords.filter(r => r.date >= cutoff);
}

// ── Statistics computation ─────────────────────────────────────────────────
function computeStats(records) {
  const total = records.length;
  const wins  = records.filter(r => r.win).length;
  const losses = total - wins;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  // Daily win rates
  const dailyMap = new Map();
  for (const r of records) {
    if (!r.dateStr) continue;
    if (!dailyMap.has(r.dateStr)) dailyMap.set(r.dateStr, { g: 0, w: 0 });
    const d = dailyMap.get(r.dateStr);
    d.g++;
    if (r.win) d.w++;
  }
  const dailyData = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { g, w }]) => ({ date, g, w, wr: g > 0 ? Math.round((w / g) * 100) : 0 }));

  // Deck win rates
  const deckMap = new Map();
  for (const r of records) {
    if (!r.deck) continue;
    if (!deckMap.has(r.deck)) deckMap.set(r.deck, { g: 0, w: 0 });
    const d = deckMap.get(r.deck);
    d.g++;
    if (r.win) d.w++;
  }
  const deckData = [...deckMap.entries()]
    .map(([deck, { g, w }]) => ({ deck, g, w, wr: g > 0 ? Math.round((w / g) * 100) : 0 }))
    .sort((a, b) => b.wr - a.wr);

  // Legend win rates
  const legendMap = new Map();
  for (const r of records) {
    if (!r.legend) continue;
    if (!legendMap.has(r.legend)) legendMap.set(r.legend, { g: 0, w: 0, archetype: r.archetype });
    const d = legendMap.get(r.legend);
    d.g++;
    if (r.win) d.w++;
  }
  const legendData = [...legendMap.entries()]
    .map(([legend, { g, w, archetype }]) => ({ legend, g, w, archetype, wr: g > 0 ? Math.round((w / g) * 100) : 0 }))
    .sort((a, b) => b.wr - a.wr);

  // Archetype win rates
  const archetypeMap = new Map();
  for (const r of records) {
    const key = r.archetype;
    if (!archetypeMap.has(key)) archetypeMap.set(key, { g: 0, w: 0 });
    const d = archetypeMap.get(key);
    d.g++;
    if (r.win) d.w++;
  }
  const archetypeData = [...archetypeMap.entries()]
    .map(([archetype, { g, w }]) => ({ archetype, g, w, wr: g > 0 ? Math.round((w / g) * 100) : 0 }))
    .sort((a, b) => b.wr - a.wr);

  return { total, wins, losses, winRate, dailyData, deckData, legendData, archetypeData };
}

// ── Chart.js global defaults ───────────────────────────────────────────────
Chart.defaults.color = '#7070a0';
Chart.defaults.borderColor = '#252538';
Chart.defaults.font.family = "'Inter', 'Segoe UI', sans-serif";

function chartTooltipDefaults() {
  return {
    backgroundColor: '#111120',
    borderColor: '#252538',
    borderWidth: 1,
    titleColor: '#e8e0cc',
    bodyColor: '#a0a0c8',
    padding: 10,
  };
}

// ── Chart component factory ────────────────────────────────────────────────
// Creates a Mithril component that owns a Chart.js instance.
// `buildConfig(data)` returns a Chart.js config object.
function makeChartComponent(buildConfig) {
  return {
    chart: null,
    oncreate({ dom, attrs }) {
      this.chart = new Chart(dom, buildConfig(attrs.data));
    },
    onupdate({ dom, attrs }) {
      if (!this.chart) return;
      const cfg = buildConfig(attrs.data);
      this.chart.data = cfg.data;
      if (cfg.options) this.chart.options = cfg.options;
      this.chart.update('none');
    },
    onremove() {
      if (this.chart) { this.chart.destroy(); this.chart = null; }
    },
    view({ attrs }) {
      return m('canvas', { style: `height:${attrs.height || 260}px` });
    },
  };
}

// ── Chart configs ──────────────────────────────────────────────────────────
const WinRateOverTimeChart = makeChartComponent((data) => ({
  type: 'line',
  data: {
    labels: data.map(d => d.date),
    datasets: [{
      label: 'Win Rate %',
      data: data.map(d => d.wr),
      borderColor: '#c8a951',
      backgroundColor: 'rgba(200,169,81,0.12)',
      pointBackgroundColor: '#c8a951',
      pointRadius: 4,
      tension: 0.3,
      fill: true,
    }],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: { callback: v => `${v}%` },
        grid: { color: '#252538' },
      },
      x: {
        grid: { color: '#252538' },
        ticks: {
          maxRotation: 45,
          maxTicksLimit: 14,
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTooltipDefaults(),
        callbacks: {
          label: ctx => {
            const d = data[ctx.dataIndex];
            return `Win rate: ${d.wr}%  (${d.w}W / ${d.g - d.w}L, ${d.g} games)`;
          },
        },
      },
    },
  },
}));

const WinRateByDeckChart = makeChartComponent((data) => ({
  type: 'bar',
  data: {
    labels: data.map(d => d.deck),
    datasets: [{
      label: 'Win Rate %',
      data: data.map(d => d.wr),
      backgroundColor: data.map(d => d.wr >= 50 ? 'rgba(76,175,130,0.7)' : 'rgba(224,85,85,0.7)'),
      borderColor:     data.map(d => d.wr >= 50 ? '#4caf82' : '#e05555'),
      borderWidth: 1,
    }],
  },
  options: {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        min: 0,
        max: 100,
        ticks: { callback: v => `${v}%` },
        grid: { color: '#252538' },
      },
      y: { grid: { display: false } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTooltipDefaults(),
        callbacks: {
          label: ctx => {
            const d = data[ctx.dataIndex];
            return `Win rate: ${d.wr}%  (${d.w}W / ${d.g - d.w}L, ${d.g} games)`;
          },
        },
      },
    },
  },
}));

const WinRateByLegendChart = makeChartComponent((data) => ({
  type: 'bar',
  data: {
    labels: data.map(d => d.legend),
    datasets: [{
      label: 'Win Rate %',
      data: data.map(d => d.wr),
      backgroundColor: data.map(d => `${archetypeColor(d.archetype)}bb`),
      borderColor:     data.map(d => archetypeColor(d.archetype)),
      borderWidth: 1,
    }],
  },
  options: {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        min: 0,
        max: 100,
        ticks: { callback: v => `${v}%` },
        grid: { color: '#252538' },
      },
      y: { grid: { display: false } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTooltipDefaults(),
        callbacks: {
          label: ctx => {
            const d = data[ctx.dataIndex];
            return [
              `Win rate: ${d.wr}%  (${d.w}W / ${d.g - d.w}L, ${d.g} games)`,
              `Archetype: ${d.archetype}`,
            ];
          },
        },
      },
    },
  },
}));

const WinRateByArchetypeChart = makeChartComponent((data) => ({
  type: 'bar',
  data: {
    labels: data.map(d => d.archetype),
    datasets: [{
      label: 'Win Rate %',
      data: data.map(d => d.wr),
      backgroundColor: data.map(d => `${archetypeColor(d.archetype)}bb`),
      borderColor:     data.map(d => archetypeColor(d.archetype)),
      borderWidth: 1,
    }],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: { callback: v => `${v}%` },
        grid: { color: '#252538' },
      },
      x: { grid: { display: false } },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartTooltipDefaults(),
        callbacks: {
          label: ctx => {
            const d = data[ctx.dataIndex];
            return `Win rate: ${d.wr}%  (${d.w}W / ${d.g - d.w}L, ${d.g} games)`;
          },
        },
      },
    },
  },
}));

// ── Helper: chart height based on item count (horizontal bars) ─────────────
function hBarHeight(n) {
  return Math.max(200, n * 34 + 40);
}

// ── Mithril root component ─────────────────────────────────────────────────
const App = {
  oninit() { loadData(); },

  view() {
    if (state.loading) {
      return m('.state-screen',
        m('.icon', '⏳'),
        m('p', 'Loading game data from Google Sheets…'),
      );
    }

    if (state.error) {
      return m('.state-screen',
        m('.icon', '⚠️'),
        m('p', 'Failed to load data'),
        m('.error-msg', state.error),
        m('button.btn.btn-accent', { onclick: loadData }, 'Try again'),
      );
    }

    const records = getFilteredRecords();
    const stats   = computeStats(records);

    return m('.stats-page', [
      // Header
      m('.stats-header', [
        m('img.stats-logo', { src: 'logo.png', alt: 'Riftbro' }),
        m('.stats-header-text', [
          m('h1', 'Game Statistics'),
          m('p', 'Win rates from your recorded games'),
        ]),
        m('.stats-header-actions', [
          state.lastUpdated
            ? m('.last-updated', `Updated ${state.lastUpdated.toLocaleTimeString()}`)
            : null,
          m('button.btn.btn-accent', { onclick: loadData }, '↻ Refresh'),
        ]),
      ]),

      // Filter bar
      m('.filter-bar', [
        m('label', 'Period:'),
        FILTERS.map((f, i) =>
          m('button.filter-btn', {
            class: i === state.filterIdx ? 'active' : '',
            onclick() { state.filterIdx = i; m.redraw(); },
          }, f.label)
        ),
      ]),

      // Summary cards
      m('.summary-row', [
        m('.summary-card',         [ m('.label', 'Total Games'), m('.value', stats.total) ]),
        m('.summary-card.wins',    [ m('.label', 'Wins'),         m('.value', stats.wins) ]),
        m('.summary-card.losses',  [ m('.label', 'Losses'),       m('.value', stats.losses) ]),
        m('.summary-card',         [ m('.label', 'Win Rate'),     m('.value', `${stats.winRate}%`) ]),
      ]),

      // Charts
      stats.total === 0
        ? m('.no-data', 'No games recorded in this time period.')
        : m('.charts-grid', [

            // 1. Win rate over time
            m('.chart-card', [
              m('h2', 'Win Rate Over Time'),
              m('.chart-wrap', { style: 'height:260px' },
                m(WinRateOverTimeChart, { key: `time-${state.filterIdx}`, data: stats.dailyData, height: 260 })
              ),
            ]),

            // 2. Win rate by archetype
            m('.chart-card', [
              m('h2', 'Win Rate by Archetype'),
              m('.chart-wrap', { style: `height:${hBarHeight(stats.archetypeData.length)}px` },
                m(WinRateByArchetypeChart, { key: `arch-${state.filterIdx}`, data: stats.archetypeData, height: hBarHeight(stats.archetypeData.length) })
              ),
              m('.archetype-legend',
                Object.entries(ARCHETYPES).map(([name, { color }]) =>
                  m('.arch-badge', [
                    m('.arch-badge-dot', { style: `background:${color}` }),
                    name,
                  ])
                ),
                m('.arch-badge', [
                  m('.arch-badge-dot', { style: `background:${ARCHETYPE_UNKNOWN_COLOR}` }),
                  'Unknown',
                ]),
              ),
            ]),

            // 3. Win rate by deck played
            m('.chart-card', [
              m('h2', 'Win Rate by Deck Played'),
              stats.deckData.length === 0
                ? m('.no-data', 'No deck data available.')
                : m('.chart-wrap', { style: `height:${hBarHeight(stats.deckData.length)}px` },
                    m(WinRateByDeckChart, { key: `deck-${state.filterIdx}`, data: stats.deckData, height: hBarHeight(stats.deckData.length) })
                  ),
            ]),

            // 4. Win rate by opponent legend
            m('.chart-card', [
              m('h2', 'Win Rate by Opponent Legend'),
              stats.legendData.length === 0
                ? m('.no-data', 'No legend data available.')
                : m('.chart-wrap', { style: `height:${hBarHeight(stats.legendData.length)}px` },
                    m(WinRateByLegendChart, { key: `legend-${state.filterIdx}`, data: stats.legendData, height: hBarHeight(stats.legendData.length) })
                  ),
            ]),
          ]),
    ]);
  },
};

m.mount(document.getElementById('app'), App);
