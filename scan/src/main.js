import { createWorker } from 'tesseract.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// Matches card IDs: OGN-001, SFD-141A, OGN-007a, SFD-T03, OGS-017, etc.
const CARD_ID_REGEX = /\b([A-Z]{2,3}-(?:[A-Z]?\d{2,3}[A-Za-z]?))\b/;

const SET_NAMES = {
  OGN: 'Origins',
  SFD: 'Spiritforged',
  OGS: 'Proving Grounds',
};

// Mirror of app/main.js normId: 'ogn-001-298' → 'OGN-001'
const normId = id => id ? id.split('-').slice(0, 2).join('-').toUpperCase() : id;

// Episode slug → set code (for riftboundindex.com API fallback)
const SLUG_TO_CODE = {
  'origins':         'OGN',
  'spiritforged':    'SFD',
  'proving-grounds': 'OGS',
};

const CONFIRM_FRAMES = 2;     // consecutive matching OCR reads before confirming
const COOLDOWN_MS    = 2000;  // pause between scans (ms)
const NAME_SCORE_MIN = 0.60;  // fuzzy name match threshold (0–1)

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  worker:            null,
  stream:            null,
  scanActive:        false,
  cooldown:          false,
  scanning:          false,
  consecutiveHits:   0,
  lastHitId:         null,
  scanList:          JSON.parse(localStorage.getItem('rb-scan-list') || '[]'),
  csvRows:           null,      // parsed CSV rows from the user's riftbound.gg export (for merging)
  cardNameMap:       {},        // { 'OGN-001': { name, set } } — built from full card catalog
  soundEnabled:      JSON.parse(localStorage.getItem('rb-scan-sound') ?? 'true'),
  debugVisible:      false,
  torchOn:           false,
};

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = {
  video:          $('camera-feed'),
  ocrCanvas:      $('ocr-canvas'),
  camGate:        $('cam-gate'),
  camGateStatus:  $('cam-gate-status'),
  startCamBtn:    $('start-cam-btn'),
  camView:        $('cam-view'),
  camError:       $('cam-error'),
  camErrMsg:      $('cam-error-msg'),
  camErrSub:      $('cam-error-sub'),
  retryBtn:       $('retry-btn'),
  guideFrame:     $('guide-frame'),
  status:         $('status'),
  scanDrawer:     $('scan-drawer'),
  drawerHeader:   $('drawer-header'),
  drawerActions:  $('drawer-actions'),
  scanList:       $('scan-list'),
  scanEmpty:      $('scan-empty'),
  scanCount:      $('scan-count'),
  csvUpload:      $('csv-upload'),
  csvBadge:       $('csv-badge'),
  exportBtn:      $('export-btn'),
  clearBtn:       $('clear-btn'),
  soundToggle:    $('sound-toggle'),
  debugToggle:    $('debug-toggle'),
  torchBtn:       $('torch-btn'),
  scanBtn:        $('scan-btn'),
  debugOverlay:   $('debug-overlay'),
  debugCanvas:    $('debug-canvas'),
  debugText:      $('debug-text'),
};

// ── Audio (Web Audio API — works on all platforms including iOS) ──────────────
let audioCtx = null;

function playBlip() {
  if (!state.soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.09);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.09);
  } catch (_) {}
}

// ── Haptic feedback (Android only — silently ignored elsewhere) ───────────────
function vibrate() {
  try { navigator.vibrate?.(150); } catch (_) {}
}

// ── Guide-frame flash ─────────────────────────────────────────────────────────
function flashGuide() {
  el.guideFrame.classList.add('confirmed');
  setTimeout(() => el.guideFrame.classList.remove('confirmed'), 600);
}

// ── Status pill ───────────────────────────────────────────────────────────────
function setStatus(text, type = '') {
  el.status.textContent = text;
  el.status.className = 'status' + (type ? ` ${type}` : '');
}

// ── Persistence ───────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('rb-scan-list', JSON.stringify(state.scanList));
}

// Strip icon/rune tags and clean text for matching: "(You may pay :rb_energy_1::rb_rune_fury:...)" → "you may pay ..."
const splitCamelCase = s => s.replace(/([a-z])([A-Z])/g, '$1 $2')  // fooBar → foo Bar
                           .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'); // HTMLParser → HTML Parser

const cleanText = t => splitCamelCase((t || ''))
  .toLowerCase()
  .replace(/:\w+:/g, ' ')      // :rb_energy_1: → space
  .replace(/\[.*?\]/g, ' ')    // [Accelerate] → space
  .replace(/<[^>]+>/g, ' ')    // strip any HTML tags
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ').trim();

// Words we skip — too common across all cards to be useful signals
const STOP_WORDS = new Set([
  'the','and','you','may','pay','have','this','that','with','from','into','your',
  'they','them','their','will','can','for','are','but','not','all','any','each',
  'when','while','enter','ready','cost','card','unit','spell','action','riftbound',
  'additional','combat','turn','phase','player','target','choose','effect','zone',
]);

const textTokens = str => [...new Set(
  cleanText(str).split(' ').filter(w => w.length >= 4 && !STOP_WORDS.has(w))
)];

// ── Load full card catalog ────────────────────────────────────────────────────
// Reuses the same localStorage cache the main app populates (rb_cards).
// Falls back to fetching directly from riftboundindex.com if not populated yet.
async function loadCardCatalog() {
  // Path 1: use cache from main app (rb_cards in localStorage)
  const raw = localStorage.getItem('rb_cards');
  if (raw) {
    try {
      const cards = JSON.parse(raw);
      if (Array.isArray(cards) && cards.length > 0) {
        // Debug: log first card so we can see the exact structure
        console.log('[scan] rb_cards first card sample:', JSON.stringify(cards[0]));

        for (const card of cards) {
          // Firebase doc ID is like 'ogn-001-298' — drop the last segment
          const key = normId(card.id);

          // The name field may be 'name' or nested — try both
          const name = card.name ?? card.card_name ?? card.data?.name ?? null;

          if (key && key.includes('-') && name && !state.cardNameMap[key]) {
            state.cardNameMap[key] = {
              name,
              set: card.set?.value?.label ?? SET_NAMES[key.split('-')[0]] ?? key.split('-')[0],
              tokens: textTokens((card.cardImage?.accessibilityText ?? '') + ' ' + name),
            };
          }
        }
        const count = Object.keys(state.cardNameMap).length;
        console.log(`[scan] Catalog from cache: ${count} / ${cards.length} cards mapped`);
        if (count > 0) return;
        // If 0 mapped, fall through to API (cache format might differ)
        console.warn('[scan] Cache produced 0 matches — trying API fallback');
      }
    } catch (e) {
      console.warn('[scan] Failed to parse rb_cards:', e.message);
    }
  } else {
    console.log('[scan] No rb_cards in localStorage — fetching from API');
  }

  // Path 2: fetch from riftboundindex.com API
  try {
    const res  = await fetch('https://riftboundindex.com/api/cards?pageSize=10000');
    const data = await res.json();
    const cards = data.cards ?? (Array.isArray(data) ? data : []);
    console.log(`[scan] API returned ${cards.length} cards. First:`, JSON.stringify(cards[0]));

    for (const card of cards) {
      // Same format as rb_cards: id = 'ogn-001-298', name, set.value.id / set.value.label
      const key  = normId(card.id);
      const name = card.name ?? null;
      if (!key || !key.includes('-') || !name) continue;

      if (!state.cardNameMap[key]) {
        state.cardNameMap[key] = {
          name,
          set: card.set?.value?.label ?? SET_NAMES[key.split('-')[0]] ?? key.split('-')[0],
          tokens: textTokens((card.cardImage?.accessibilityText ?? '') + ' ' + name),
        };
      }
    }
    console.log(`[scan] Catalog from API: ${Object.keys(state.cardNameMap).length} cards`);
  } catch (err) {
    console.warn('[scan] Could not load card catalog from API:', err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const cardImg = id =>
  `https://static.dotgg.gg/riftbound/cards/${id}.webp`;

const setFromId = id =>
  SET_NAMES[id.split('-')[0]] ?? id.split('-')[0];

// ── Render scan list ──────────────────────────────────────────────────────────
function render() {
  const list = state.scanList;
  el.scanEmpty.hidden = list.length > 0;
  el.exportBtn.disabled = list.length === 0;

  const total = list.reduce((s, c) => s + c.qty, 0);
  el.scanCount.textContent = total > 0 ? `· ${total} card${total !== 1 ? 's' : ''}` : '';

  el.scanList.innerHTML = list.map((item, i) => `
    <div class="scan-item">
      <img class="scan-item-img"
           src="${cardImg(item.id)}"
           alt="${item.id}"
           loading="lazy"
           onerror="this.style.opacity='0.3'">
      <div class="scan-item-info">
        <div class="scan-item-name">${item.name ?? item.id}</div>
        <div class="scan-item-id">${item.id}</div>
        <div class="scan-item-set">${item.set}</div>
      </div>
      <div class="scan-item-qty">
        <button class="qty-btn" data-i="${i}" data-d="-1">−</button>
        <span class="qty-val">${item.qty}</span>
        <button class="qty-btn" data-i="${i}" data-d="1">+</button>
      </div>
      <button class="remove-btn" data-i="${i}" title="Remove">✕</button>
    </div>
  `).join('');
}

// ── Add card / increment ──────────────────────────────────────────────────────
function addCard(id) {
  const existing = state.scanList.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    const info = state.cardNameMap[id] ?? {};
    state.scanList.unshift({
      id,
      name: info.name ?? null,
      set:  info.set  ?? setFromId(id),
      qty:  1,
    });
  }
  save();
  render();
}

// ── Start / stop the continuous OCR loop ─────────────────────────────────────
function startScanLoop() {
  if (state.scanActive) return;
  state.scanActive      = true;
  state.consecutiveHits = 0;
  state.lastHitId       = null;
  el.scanBtn.textContent = '⏹ Stop';
  el.scanBtn.classList.add('scanning');
  setStatus('Scanning…');
  runLoop();
}

function stopScanLoop(reason = 'idle') {
  state.scanActive = false;
  el.scanBtn.textContent = 'Scan Card';
  el.scanBtn.classList.remove('scanning');
  if (reason === 'idle') {
    state.consecutiveHits = 0;
    state.lastHitId       = null;
    setStatus('Ready · press Scan');
  }
}

async function runLoop() {
  if (!state.scanActive) return;
  await captureAndOCR();
  if (state.scanActive) setTimeout(runLoop, 80); // ~80ms breath between frames
}

// ── Card confirmed after N consecutive frames ─────────────────────────────────
function confirmCard(id) {
  stopScanLoop('confirmed');
  state.consecutiveHits = 0;
  state.lastHitId       = null;
  state.cooldown        = true;
  el.scanBtn.disabled   = true;

  playBlip();
  vibrate();
  flashGuide();
  addCard(id);
  setStatus(`✓ Added ${id}`, 'success');

  setTimeout(() => {
    state.cooldown      = false;
    el.scanBtn.disabled = false;
    setStatus('Ready · press Scan');
  }, COOLDOWN_MS);
}

// ── Fuzzy text matching ───────────────────────────────────────────────────────
// Two scoring paths, best wins:
//  A) token intersection: ocrTokens ∩ cardTokens / ocrTokens  (good when spaces OK)
//  B) name-word substring: how many card name words appear inside the raw OCR string
//     (handles "ChemtechEnforcer" — name words "chemtech" "enforcer" are substrings)
function fuzzyMatchName(ocrText) {
  if (!state.cardNameMap || Object.keys(state.cardNameMap).length === 0) return null;

  const ocrClean  = cleanText(ocrText);           // camelCase already split
  const ocrTokens = textTokens(ocrText);           // deduplicated meaningful words
  const ocrSet    = new Set(ocrTokens);
  // also keep the raw collapsed string for substring search
  const ocrRaw    = (ocrText || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  let bestScore = 0, bestId = null, bestDebug = '';

  for (const [id, info] of Object.entries(state.cardNameMap)) {
    if (!info.tokens || info.tokens.length === 0) continue;
    const cardSet = new Set(info.tokens);

    // Path A: token intersection
    let hitsA = 0;
    for (const w of ocrSet) if (cardSet.has(w)) hitsA++;
    const scoreA = ocrSet.size > 0 ? hitsA / ocrSet.size : 0;

    // Path B: card NAME words as substrings of the raw collapsed OCR string
    // Only use the name tokens (first word(s)) — not the full ability text
    const nameWords = (info.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length >= 4);
    let hitsB = 0;
    for (const w of nameWords) if (ocrRaw.includes(w)) hitsB++;
    const scoreB = nameWords.length > 0 ? hitsB / nameWords.length : 0;

    const score = Math.max(scoreA, scoreB);
    if (score > bestScore) {
      bestScore = score;
      bestId    = id;
      bestDebug = `${info.name} A:${scoreA.toFixed(2)} B:${scoreB.toFixed(2)}`;
    }
  }

  // Update debug text with best candidate regardless of threshold
  if (bestId) {
    const existing = el.debugText.textContent;
    el.debugText.textContent = existing.split('\n').slice(0, -1).concat(`best: ${bestDebug}`).join('\n');
  }

  return bestScore >= NAME_SCORE_MIN ? bestId : null;
}

// ── Frame capture + OCR ───────────────────────────────────────────────────────
const ocrCtx  = el.ocrCanvas.getContext('2d');
const dbgCtx  = el.debugCanvas.getContext('2d');

// ── Map guide-frame CSS rect → video source coordinates ────────────────────────
// The <video> uses object-fit:cover so the displayed area is a cropped window
// into the full video frame.  We reverse that transform to find what part of
// the raw frame corresponds to the visible guide rectangle.
function guideToVideoRect() {
  const vw = el.video.videoWidth;
  const vh = el.video.videoHeight;
  const d  = el.video.getBoundingClientRect();   // display rect
  const g  = el.guideFrame.getBoundingClientRect(); // guide rect

  // Scale factor that object-fit:cover would use
  const s = Math.max(d.width / vw, d.height / vh);

  // Top-left of the scaled video in display space (negative when video is wider)
  const ox = d.left + (d.width  - s * vw) / 2;
  const oy = d.top  + (d.height - s * vh) / 2;

  // Guide rect in video source coordinates
  const srcX = (g.left - ox) / s;
  const srcY = (g.top  - oy) / s;
  const srcW = g.width  / s;
  const srcH = g.height / s;

  // Add padding and clamp to video bounds
  const pad = srcW * 0.05;
  return {
    x: Math.max(0,  srcX - pad),
    y: Math.max(0,  srcY - pad),
    w: Math.min(vw, srcW + pad * 2),
    h: Math.min(vh, srcH + pad * 2),
  };
}

// Card layout (portrait 744×1039) — vertical slice fractions of guide frame height:
//   0–53%  artwork (skip)
//   53–65% name bar
//   65–86% ability text box
//   86–98% stats / card-ID line
const STRIPS = [
  { label: 'name',    y0: 0.53, y1: 0.66 },
  { label: 'ability', y0: 0.65, y1: 0.87 },
  { label: 'id',      y0: 0.85, y1: 0.99 },
];

// ── Per-strip image preprocessing ────────────────────────────────────────────
// Converts a region of a canvas to grayscale, stretches contrast across the
// full 0–255 range (auto-level), and inverts if the background is dark.
// This is far more reliable than CSS filters for OCR on coloured card layouts.
function preprocessStrip(ctx, dx, dy, dw, dh) {
  const imageData = ctx.getImageData(dx, dy, dw, dh);
  const d = imageData.data;
  const len = dw * dh;

  // Pass 1: grayscale + find range
  const gray = new Uint8Array(len);
  let minV = 255, maxV = 0, sum = 0;
  for (let i = 0; i < len; i++) {
    const v = (0.299 * d[i*4] + 0.587 * d[i*4+1] + 0.114 * d[i*4+2]) | 0;
    gray[i] = v;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
    sum += v;
  }

  // Auto-invert: if avg brightness < 140 assume light text on dark bg → invert
  const mean   = sum / len;
  const invert = mean < 140;
  const range  = (maxV - minV) || 1;

  // Pass 2: apply auto-level + optional invert
  for (let i = 0; i < len; i++) {
    let v = Math.round((gray[i] - minV) / range * 255);
    if (invert) v = 255 - v;
    d[i*4] = d[i*4+1] = d[i*4+2] = v;
    d[i*4+3] = 255;
  }
  ctx.putImageData(imageData, dx, dy);
}

async function captureAndOCR() {
  if (state.cooldown || !state.worker || !el.video.videoWidth) return;

  const base = guideToVideoRect();
  const SCALE = 2.5;

  // ── Build composite canvas: strips stacked vertically ───────────────────────
  const stripRects = STRIPS.map(s => ({
    label: s.label,
    sx: base.x,
    sy: base.y + base.h * s.y0,
    sw: base.w,
    sh: base.h * (s.y1 - s.y0),
    dw: Math.round(base.w * SCALE),
    dh: Math.round(base.h * (s.y1 - s.y0) * SCALE),
  }));

  const totalW = stripRects[0].dw;
  const totalH = stripRects.reduce((s, r) => s + r.dh, 0);
  el.ocrCanvas.width  = totalW;
  el.ocrCanvas.height = totalH;
  ocrCtx.filter = 'none';

  let oy = 0;
  for (const r of stripRects) {
    // Draw raw video → canvas at scale
    ocrCtx.drawImage(el.video, r.sx, r.sy, r.sw, r.sh, 0, oy, r.dw, r.dh);
    // Process each strip independently (auto-level + auto-invert per strip)
    preprocessStrip(ocrCtx, 0, oy, r.dw, r.dh);
    oy += r.dh;
  }

  // ── Debug: copy processed canvas + gold dividers ─────────────────────────────
  el.debugCanvas.width  = totalW;
  el.debugCanvas.height = totalH;
  dbgCtx.drawImage(el.ocrCanvas, 0, 0);
  oy = 0;
  for (const r of stripRects) {
    dbgCtx.strokeStyle = '#c8a951'; dbgCtx.lineWidth = 2;
    dbgCtx.beginPath(); dbgCtx.moveTo(0, oy); dbgCtx.lineTo(totalW, oy); dbgCtx.stroke();
    oy += r.dh;
  }

  // ── Single OCR call ──────────────────────────────────────────────────────────
  let text = '';
  try {
    ({ data: { text } } = await state.worker.recognize(el.ocrCanvas));
  } catch (_) { return; }

  el.debugText.textContent = text.trim().replace(/\n+/g, ' ').slice(0, 300) || '(no text)';

  // ── Primary: card ID regex ───────────────────────────────────────────────────
  const upper   = text.replace(/[oO]/g, '0').toUpperCase();
  const foundId = upper.match(CARD_ID_REGEX)?.[1] ?? null;

  // ── Secondary: fuzzy text match ─────────────────────────────────────────────
  const nameId = foundId ? null : fuzzyMatchName(text);
  const hitId  = foundId ?? nameId;
  const method = foundId ? '🔢' : '🔤';

  if (hitId) {
    const info = state.cardNameMap[hitId];
    if (hitId === state.lastHitId) {
      state.consecutiveHits++;
      setStatus(`${method} ${info?.name ?? hitId} ${state.consecutiveHits}/${CONFIRM_FRAMES}`, 'detecting');
      if (state.consecutiveHits >= CONFIRM_FRAMES) confirmCard(hitId);
    } else {
      state.lastHitId       = hitId;
      state.consecutiveHits = 1;
      setStatus(`${method} ${info?.name ?? hitId} 1/${CONFIRM_FRAMES}`, 'detecting');
    }
  } else {
    state.consecutiveHits = 0;
    state.lastHitId       = null;
    setStatus('Scanning…');
  }
}

// ── Show error state ──────────────────────────────────────────────────────────
function showError(title, sub) {
  el.camGate.hidden  = true;
  el.camView.hidden  = true;
  el.camError.hidden = false;
  el.camErrMsg.textContent = title;
  el.camErrSub.textContent = sub;
}

// ── Camera startup ────────────────────────────────────────────────────────────
async function startCamera() {
  // Check API availability (requires HTTPS or localhost)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError(
      'Camera API not available.',
      'This page must be opened over HTTPS or localhost. If you are using port forwarding via USB, make sure you are visiting http://localhost:5176 on your phone.'
    );
    return;
  }

  // Check if already denied via Permissions API (where supported)
  if (navigator.permissions) {
    try {
      const perm = await navigator.permissions.query({ name: 'camera' });
      if (perm.state === 'denied') {
        showError(
          'Camera permission was previously denied.',
          'To fix this: tap the lock / info icon in your browser address bar → Permissions → Camera → Allow, then reload the page.'
        );
        return;
      }
    } catch (_) { /* permissions API not supported, proceed */ }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    state.stream       = stream;
    el.video.srcObject = stream;
    await el.video.play();

    el.camGate.hidden   = true;
    el.camError.hidden  = true;
    el.camView.hidden   = false;
    el.scanBtn.hidden   = false;
    state.scanning      = true;

    // Torch support — show button only if the track capability exists
    const track = stream.getVideoTracks()[0];
    if (track?.getCapabilities?.()?.torch) {
      el.torchBtn.hidden = false;
      el.torchBtn.addEventListener('click', async () => {
        state.torchOn = !state.torchOn;
        try {
          await track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
          el.torchBtn.classList.toggle('active', state.torchOn);
        } catch (_) {
          state.torchOn = !state.torchOn; // revert
        }
      });
    }

    setStatus('Ready · press Scan');

  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      showError(
        'Camera permission denied.',
        'Tap the lock / info icon in your browser\'s address bar → Permissions → Camera → Allow, then tap Try Again.'
      );
    } else if (err.name === 'NotFoundError') {
      showError(
        'No camera found.',
        'Make sure your device has a camera and it is not in use by another app.'
      );
    } else {
      showError(
        `Camera error: ${err.name}`,
        err.message || 'An unexpected error occurred. Try reloading the page.'
      );
    }
  }
}

// ── CSV parsing ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines  = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows   = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = [];
    let inQ = false, cur = '';
    for (const ch of lines[i] + ',') {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    if (cols.length < 2) continue;
    const row = {};
    header.forEach((h, idx) => row[h] = cols[idx] ?? '');
    rows.push(row);

    // Build name map for scan display
    const cid = row['CardId']?.toUpperCase();
    if (cid) state.cardNameMap[cid] = { name: row['Name'], set: row['Set'] };
  }
  return rows;
}

// ── CSV merge + export ────────────────────────────────────────────────────────
function buildCSVString(rows) {
  const header = 'CardId,Normal,Foil,Name,Set';
  const body   = rows.map(r =>
    `"${r.CardId}",${r.Normal},${r.Foil},"${r.Name}","${r.Set}"`
  ).join('\n');
  return `${header}\n${body}`;
}

function exportCSV() {
  // Clone existing CSV rows (or start fresh)
  const rows = (state.csvRows ?? []).map(r => ({ ...r }));

  for (const item of state.scanList) {
    const existing = rows.find(r => r.CardId?.toUpperCase() === item.id);
    if (existing) {
      existing.Normal = String(Number(existing.Normal || 0) + item.qty);
    } else {
      // New card not yet in the collection
      const info = state.cardNameMap[item.id] ?? {};
      rows.push({
        CardId: item.id,
        Normal: String(item.qty),
        Foil:   '0',
        Name:   info.name ?? item.id,
        Set:    info.set  ?? setFromId(item.id),
      });
    }
  }

  const csv  = buildCSVString(rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `collection-updated-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Event wiring ──────────────────────────────────────────────────────────────
function wireEvents() {

  // Sound toggle
  el.soundToggle.checked = state.soundEnabled;
  el.soundToggle.addEventListener('change', () => {
    state.soundEnabled = el.soundToggle.checked;
    localStorage.setItem('rb-scan-sound', JSON.stringify(state.soundEnabled));
  });

  // Debug overlay toggle
  el.debugToggle.addEventListener('click', () => {
    state.debugVisible = !state.debugVisible;
    el.debugOverlay.hidden = !state.debugVisible;
    el.debugToggle.classList.toggle('active', state.debugVisible);
  });

  // Manual scan button — starts loop; while scanning it becomes a Stop button
  el.scanBtn.addEventListener('click', () => {
    if (state.scanActive) stopScanLoop('idle');
    else startScanLoop();
  });

  // Drawer collapse/expand — tap the header bar (but not the action buttons)
  el.drawerHeader.addEventListener('click', e => {
    if (el.drawerActions.contains(e.target)) return; // let buttons work normally
    el.scanDrawer.classList.toggle('expanded');
  });

  // Delegated clicks on scan list (qty +/- and remove)
  el.scanList.addEventListener('click', e => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    const i = Number(btn.dataset.i);

    if (btn.classList.contains('remove-btn')) {
      state.scanList.splice(i, 1);
    } else if (btn.classList.contains('qty-btn')) {
      const d = Number(btn.dataset.d);
      state.scanList[i].qty += d;
      if (state.scanList[i].qty <= 0) state.scanList.splice(i, 1);
    }
    save();
    render();
  });

  // CSV file upload (only needed for collection merge/export — names come from catalog)
  el.csvUpload.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      state.csvRows = parseCSV(ev.target.result);
      save();
      render();

      el.csvBadge.textContent = `✓ Collection CSV loaded: ${file.name} (${state.csvRows.length} rows) — ready to merge`;
      el.csvBadge.hidden = false;
    };
    reader.readAsText(file);
  });

  // Export button
  el.exportBtn.addEventListener('click', exportCSV);

  // Clear all
  el.clearBtn.addEventListener('click', () => {
    if (state.scanList.length === 0) return;
    if (!confirm(`Clear all ${state.scanList.reduce((s,c) => s+c.qty,0)} scanned cards?`)) return;
    state.scanList = [];
    save();
    render();
  });

  // Unlock AudioContext on first user gesture (required by browsers)
  document.addEventListener('click', () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });

  // Start Camera button
  el.startCamBtn.addEventListener('click', async () => {
    el.startCamBtn.disabled = true;
    el.camGateStatus.hidden = false;
    await startCamera();
    el.startCamBtn.disabled = false;
  });

  // Retry button (shown in error state)
  el.retryBtn.addEventListener('click', async () => {
    el.camError.hidden = true;
    el.camGate.hidden  = false;
    el.startCamBtn.disabled  = false;
    el.camGateStatus.hidden  = true;
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  wireEvents();
  render();

  // Load card catalog and Tesseract in parallel — both ready before user taps camera
  const [, worker] = await Promise.all([
    loadCardCatalog(),
    createWorker('eng', 1, { logger: () => {} }),
  ]);

  await worker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-abcdefghijklmnopqrstuvwxyz',
    tessedit_pageseg_mode: '11',
  });
  state.worker = worker;

  if (!el.camGate.hidden) {
    const count = Object.keys(state.cardNameMap).length;
    el.camGateStatus.textContent = count > 0
      ? `Ready · ${count} cards loaded`
      : 'Ready · no card catalog (name matching unavailable)';
    el.camGateStatus.hidden = false;
    setTimeout(() => { el.camGateStatus.hidden = true; }, 2500);
  }
}

init().catch(err => {
  console.error('Scanner init failed:', err);
  showError('Init error', err.message);
});
