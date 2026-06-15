// landing.js — RiftBro promotional landing page
import { getCardCatalog } from './shared/cardCatalog.js';

const SET_IDS = ['OGN', 'SFD', 'OGS', 'UNL'];

// ── Nav background on scroll ───────────────────────────────────────
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

// ── Scroll-reveal animations ───────────────────────────────────────
const revealObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); revealObserver.unobserve(e.target); }
  }
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

// ── Count-up helper (runs once when scrolled into view) ────────────
function animateCount(el, target) {
  const dur = 1400, start = performance.now();
  const fmt = (n) => Math.round(n).toLocaleString();
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = fmt(target);
  }
  requestAnimationFrame(step);
}
const countObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target;
    const target = +(el.dataset.target || el.dataset.value || 0);
    if (target > 0) animateCount(el, target);
    countObserver.unobserve(el);
  }
}, { threshold: 0.5 });
document.querySelectorAll('[data-count]').forEach((el) => countObserver.observe(el));

// ── App-logo fallback (graceful crystal "R" if asset is missing) ───
const FALLBACK_LOGO =
  'data:image/svg+xml;utf8,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#5B53E0"/>
      </linearGradient>
    </defs>
    <path d="M32 3 56 16v32L32 61 8 48V16Z" fill="none" stroke="url(#g)" stroke-width="3"/>
    <path d="M24 20h11a8 8 0 0 1 1 16l7 10h-7l-6-9h-2v9h-7Zm7 6v6h4a3 3 0 0 0 0-6Z" fill="url(#g)"/>
  </svg>`);
document.querySelectorAll('#brandMark, #ctaMark, .footer-brand .brand-mark').forEach((el) => {
  const applyFallback = () => { if (el.src !== FALLBACK_LOGO) el.src = FALLBACK_LOGO; };
  if (el.complete && el.naturalWidth === 0) applyFallback();       // already failed before JS ran
  el.addEventListener('error', applyFallback, { once: true });
});

// ── Live data: total + per-set card counts ─────────────────────────
(async () => {
  let cards = [];
  try { cards = await getCardCatalog(); } catch (_) { /* offline — keep fallbacks */ }

  // Total cards
  const statCards = document.getElementById('statCards');
  if (statCards) {
    const total = cards.length || 1000; // sensible fallback before/without data
    statCards.dataset.target = String(total);
    // statCards may already be in view: animate immediately if so
    const r = statCards.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) animateCount(statCards, total);
  }

  // Per-set counts + relative completeness bar
  const counts = {};
  for (const id of SET_IDS) counts[id] = 0;
  for (const c of cards) {
    const id = c.set?.value?.id;
    if (id && id in counts) counts[id]++;
  }
  const max = Math.max(1, ...SET_IDS.map((id) => counts[id]));
  for (const id of SET_IDS) {
    const n = counts[id];
    const numEl = document.querySelector(`[data-set-count="${id}"]`);
    if (numEl) numEl.textContent = n ? n.toLocaleString() : '—';
    const barEl = document.querySelector(`.set-card[data-set="${id}"] .set-bar span`);
    if (barEl) requestAnimationFrame(() => { barEl.style.width = `${n ? Math.max(12, (n / max) * 100) : 0}%`; });
  }
})();
