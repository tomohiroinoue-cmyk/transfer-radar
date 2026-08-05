/* ============================================================
   Transfer Radar — client
   Reads data/transfers.json (rewritten by the scheduled updater)
   and data/photos.json (written by scripts/fetch-photos.mjs).
   No build step, no dependencies.
   ============================================================ */

'use strict';

const UPDATE_INTERVAL_MIN = 30;
const STALE_AFTER_MIN = 95; // 30分間隔なので3周期ぶん落ちたら警告

/* ---------- club colours ----------
   エンブレムは著作権物なので使わず、識別用の色だけを持つ。
   未登録クラブは名前のハッシュから安定した色を生成する。 */
const CLUB_COLORS = {
  'Arsenal': '#EF0107', 'Aston Villa': '#95BFE5', 'Bournemouth': '#DA291C',
  'Brentford': '#E30613', 'Brighton': '#0057B8', 'Burnley': '#6C1D45',
  'Chelsea': '#034694', 'Crystal Palace': '#1B458F', 'Everton': '#003399',
  'Fulham': '#CC0000', 'Leeds United': '#FFCD00', 'Liverpool': '#C8102E',
  'Manchester City': '#6CABDD', 'Manchester United': '#DA291C',
  'Newcastle United': '#41B6E6', 'Nottingham Forest': '#DD0000',
  'Sunderland': '#EB172B', 'Tottenham': '#132257', 'West Ham': '#7A263A',
  'Wolves': '#FDB913', 'Hull City': '#F18A00', 'Ipswich Town': '#3A64A3',
  'Birmingham City': '#0000FF', 'Southampton': '#D71920',
  'Real Madrid': '#FEBE10', 'Barcelona': '#A50044', 'Atletico Madrid': '#CB3524',
  'Rayo Vallecano': '#E53027', 'Sporting CP': '#008057', 'Portimonense': '#000000',
  'Bayern Munich': '#DC052D', 'Borussia Dortmund': '#FDE100',
  "Borussia Monchengladbach": '#00A650', 'RB Leipzig': '#DD0741',
  'Hannover 96': '#00963F', 'Inter Milan': '#0068A8', 'AC Milan': '#FB090B',
  'Juventus': '#000000', 'Napoli': '#12A0D7', 'Como': '#004B87',
  'PSG': '#004170', 'Marseille': '#2FAEE0', 'Lille': '#E01E13', 'Reims': '#DA020E',
  'Celtic': '#018749', 'Rangers': '#1B458F', 'Fenerbahce': '#FFED00',
  'Ajax': '#D2122E', 'PSV': '#ED1C24', 'Benfica': '#DA020E', 'Porto': '#00428C',
  'Slavia Prague': '#D7141A', 'KV Mechelen': '#F9E11E', 'LA Galaxy': '#00245D',
  'DC United': '#000000', 'Urawa Reds': '#E7262C', 'Free agent': '#64748B',
  'Mainz': '#C3141E', 'Parma': '#FFD700', 'Real Sociedad': '#0067B1',
  'Braga': '#C60C30', 'Strasbourg': '#009EE0', 'Lens': '#FFE500',
  'Kashima Antlers': '#A5052C', 'Sint-Truiden': '#FFE500',
  'Sanfrecce Hiroshima': '#4B2E83', 'Le Havre': '#0072BC',
};

function clubColor(name) {
  if (!name) return '#64748B';
  if (CLUB_COLORS[name]) return CLUB_COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360} 52% 52%)`;
}

/* ---------- probability tiers ---------- */
const TIERS = [
  { min: 100, color: 'var(--p5)', label: '成立' },
  { min: 85, color: 'var(--p5)', label: '発表間近' },
  { min: 70, color: 'var(--p4)', label: 'かなり有力' },
  { min: 50, color: 'var(--p3)', label: '五分以上' },
  { min: 30, color: 'var(--p2)', label: '温度は低い' },
  { min: 0,  color: 'var(--p1)', label: '観測段階' },
];
const tierOf = (p) => TIERS.find((t) => p >= t.min) || TIERS[TIERS.length - 1];

/** 成立＝クラブの公式発表済み。確度の推定対象から外れ、表示は 100% に固定される。 */
const isDone = (item) => item.probability >= 100 || item.status === '成立';

/* ---------- helpers ---------- */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const JST = { timeZone: 'Asia/Tokyo' };

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString('ja-JP', {
    ...JST, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function relative(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'たった今';
  if (mins < 60) return `${mins}分前`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  const take = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0]];
  return take.map((p) => [...p][0] || '').join('').toUpperCase().slice(0, 2);
}

/** 移籍金の文字列から並べ替え用の概算値（百万ユーロ）を取り出す */
function feeValue(fee) {
  if (!fee) return -1;
  const m = String(fee).match(/([\d.]+)\s*(m|億|bn)?/i);
  if (!m) return -1;
  let v = parseFloat(m[1]);
  if (isNaN(v)) return -1;
  if (/bn/i.test(m[2] || '')) v *= 1000;
  if ((m[2] || '') === '億') v *= 6; // 億円 → 概算の百万ユーロ（順位付け用の粗い換算）
  return v;
}

const TYPE_LABEL = { permanent: '完全移籍', loan: 'レンタル', free: 'フリー', 'loan-to-buy': 'レンタル+買取OP' };

/* ---------- state ---------- */

const state = {
  items: [],
  photos: {},
  meta: {},
  cat: 'all',
  q: '',
  sort: 'prob-desc',
  minProb: 0,
  hideDone: false,
};

/* ---------- rendering ---------- */

function ringSvg(prob, color) {
  const R = 26, C = 2 * Math.PI * R;
  const dash = (Math.max(0, Math.min(100, prob)) / 100) * C;
  return `<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="${R}" fill="none" stroke="var(--track)" stroke-width="5"></circle>
    <circle cx="32" cy="32" r="${R}" fill="none" stroke="${color}" stroke-width="5"
      stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${C.toFixed(2)}"></circle>
  </svg>`;
}

function avatarHtml(item) {
  const photo = state.photos[item.player.photoKey || item.player.name];
  const alt = esc(item.player.name);
  if (photo && photo.file) {
    return `<div class="avatar"><img src="data/photos/${esc(photo.file)}" alt="${alt}" loading="lazy"
      onerror="this.closest('.avatar').innerHTML=this.dataset.fb" data-fb="${esc(initialsHtml(item))}"></div>`;
  }
  return `<div class="avatar">${initialsHtml(item)}</div>`;
}

function initialsHtml(item) {
  const a = clubColor(item.to.club), b = clubColor(item.from.club);
  return `<div class="avatar__initials" style="background:linear-gradient(140deg,${a},${b})">${esc(initials(item.player.name))}</div>`;
}

/** 年齢はデータに手書きせず、Wikipedia から取った生年月日から計算する
    （fetch-photos.mjs が photos.json に birthDate を入れる）。 */
function ageOf(item) {
  if (item.player.age) return item.player.age;
  const p = state.photos[item.player.photoKey || item.player.name];
  if (!p || !p.birthDate) return null;
  const b = new Date(p.birthDate);
  if (isNaN(b)) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a > 12 && a < 60 ? a : null;
}

function creditHtml(item) {
  const p = state.photos[item.player.photoKey || item.player.name];
  if (!p || !p.file) {
    return `<div class="credit">写真: 該当するライセンス画像が見つからないため、イニシャル表示にしています。</div>`;
  }
  const artist = esc(p.artist || 'Unknown author');
  const lic = esc(p.license || 'see source');
  const licLink = p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${lic}</a>` : lic;
  const page = p.sourcePage
    ? `<a href="${esc(p.sourcePage)}" target="_blank" rel="noopener">Wikimedia Commons</a>`
    : 'Wikimedia Commons';
  return `<div class="credit">写真: ${artist} / ${licLink} — ${page}</div>`;
}

function card(item) {
  // 成立（クラブが公式発表した案件）だけが 100%。噂の推定値は 99% を上限にする。
  const done = isDone(item);
  const prob = done ? 100 : item.probability;
  const tier = done ? { color: 'var(--p5)', label: '成立' } : tierOf(prob);

  const trendMap = {
    up:   ['trend--up', '▲ 上昇'],
    down: ['trend--down', '▼ 下降'],
    flat: ['trend--flat', '— 変化なし'],
  };
  const [trendCls, trendTxt] = trendMap[item.trend] || trendMap.flat;
  const age = ageOf(item);

  const srcs = (item.sources || []).map((s) => `
    <a class="src" href="${esc(s.url)}" target="_blank" rel="noopener"
       title="${esc(s.title || '')}">
      <span class="src__tier" data-tier="${esc(s.tier || 3)}">T${esc(s.tier || 3)}</span>${esc(s.outlet)}
    </a>`).join('');

  return `
  <article class="card" style="--tier:${tier.color}">
    <div class="card__head">
      ${avatarHtml(item)}
      <div class="who">
        <div class="who__name">${esc(item.player.nameJa || item.player.name)}</div>
        <div class="who__latin">${esc(item.player.name)}</div>
        <div class="who__meta">
          ${item.player.position ? `<span class="pill pill--pos">${esc(item.player.position)}</span>` : ''}
          ${age ? `<span class="pill">${esc(age)}歳</span>` : ''}
          ${item.player.nationality ? `<span class="pill">${esc(item.player.nationality)}</span>` : ''}
        </div>
      </div>
      <div class="ring">
        <div class="ring__wrap">
          ${ringSvg(prob, tier.color)}
          <div class="ring__num"><b>${esc(prob)}</b><i>%</i></div>
        </div>
        <div class="ring__label">${esc(tier.label)}</div>
      </div>
    </div>

    <div class="route">
      <div class="club club--from">
        <div class="club__league">${esc(item.from.league || '')}</div>
        <div class="club__name">
          <span class="club__dot" style="background:${clubColor(item.from.club)}"></span>
          ${esc(item.from.clubJa || item.from.club)}
        </div>
      </div>
      <div class="route__arrow" aria-label="→">➔</div>
      <div class="club club--to">
        <div class="club__league">${esc(item.to.league || '')}</div>
        <div class="club__name">
          ${esc(item.to.clubJa || item.to.club)}
          <span class="club__dot" style="background:${clubColor(item.to.club)}"></span>
        </div>
      </div>
    </div>

    <div class="facts">
      <span class="badge badge--status">${esc(item.status)}</span>
      ${item.fee ? `<span class="badge badge--fee">${esc(item.fee)}</span>` : ''}
      ${item.type ? `<span class="badge badge--type">${esc(TYPE_LABEL[item.type] || item.type)}</span>` : ''}
      <span class="trend ${trendCls}">${trendTxt}</span>
    </div>

    ${item.summaryJa ? `<p class="summary">${esc(item.summaryJa)}</p>` : ''}

    ${item.reasoning ? `
    <details class="why">
      <summary>この確度の根拠</summary>
      <div class="why__body">${esc(item.reasoning)}</div>
    </details>` : ''}

    <div class="srcs">
      ${srcs || '<span class="src">出典なし</span>'}
      <span class="srcs__time">${esc(relative(item.updatedAt))}</span>
    </div>
    ${creditHtml(item)}
  </article>`;
}

/** カテゴリタブとの一致。1件が複数タブに出ることを許す（例: シティ→レアルは
    プレミアにもビッグクラブにも出る）ので tags は配列で持つ。 */
function inCategory(item, cat) {
  if (cat === 'all') return true;
  return Array.isArray(item.tags) && item.tags.includes(cat);
}

function visibleItems() {
  const q = state.q.trim().toLowerCase();
  let list = state.items.filter((it) => {
    if (!inCategory(it, state.cat)) return false;
    if (it.probability < state.minProb) return false;
    if (state.hideDone && isDone(it)) return false;
    if (!q) return true;
    const hay = [
      it.player.name, it.player.nameJa, it.from.club, it.from.clubJa,
      it.to.club, it.to.clubJa, it.from.league, it.to.league,
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const cmp = {
    'prob-desc': (a, b) => b.probability - a.probability,
    'prob-asc':  (a, b) => a.probability - b.probability,
    'updated':   (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    'fee':       (a, b) => feeValue(b.fee) - feeValue(a.fee),
  }[state.sort];
  return list.sort(cmp);
}

function render() {
  const list = visibleItems();
  $('#grid').innerHTML = list.map(card).join('');
  $('#empty').hidden = list.length > 0;

  document.querySelectorAll('[data-count]').forEach((el) => {
    el.textContent = state.items.filter((i) => inCategory(i, el.dataset.count)).length;
  });
}

/** 現在時刻の「時」を更新スケジュールのタイムゾーンで取る。 */
function hourInZone(tz) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', hour12: false,
  }).format(new Date())) % 24;
}

/** 更新タスクは1日中回っていない（休止時間帯がある）。休止中に
    「更新が止まっている」と誤警告しないよう、時間帯を見て判断する。 */
function scheduleState() {
  const sched = state.meta.updateSchedule;
  if (!sched || !Array.isArray(sched.activeHours) || !sched.activeHours.length) {
    return { active: true };
  }
  const tz = sched.timezone || 'Asia/Tokyo';
  const hour = hourInZone(tz);
  if (sched.activeHours.includes(hour)) return { active: true };

  // 休止中 — 次に更新が始まる時刻を求める
  for (let i = 1; i <= 24; i++) {
    const h = (hour + i) % 24;
    if (sched.activeHours.includes(h)) {
      return { active: false, resumesAtHour: h, tz };
    }
  }
  return { active: true };
}

function renderClock() {
  const gen = state.meta.generatedAt;
  $('#lastUpdated').textContent = gen ? `${fmtDateTime(gen)} (${relative(gen)})` : '—';
  $('#footGenerated').textContent = gen ? fmtDateTime(gen) + ' JST' : '—';

  if (!gen) return;

  const sched = scheduleState();
  const flag = $('#staleFlag');

  if (!sched.active) {
    $('#nextUpdate').textContent = `${String(sched.resumesAtHour).padStart(2, '0')}:00〜`;
    flag.hidden = true;
    return;
  }

  const next = state.meta.nextUpdateAt
    ? new Date(state.meta.nextUpdateAt)
    : new Date(new Date(gen).getTime() + UPDATE_INTERVAL_MIN * 60000);
  const leftMs = next - Date.now();

  if (leftMs > 0) {
    const m = Math.floor(leftMs / 60000), s = Math.floor((leftMs % 60000) / 1000);
    $('#nextUpdate').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  } else {
    $('#nextUpdate').textContent = '取得中…';
  }

  const ageMin = (Date.now() - new Date(gen)) / 60000;
  if (ageMin > STALE_AFTER_MIN) {
    flag.hidden = false;
    flag.textContent =
      `⚠ データが ${Math.floor(ageMin / 60)}時間${Math.floor(ageMin % 60)}分 更新されていません。` +
      `更新タスクが停止している可能性があります（表示中の内容は古いままです）。`;
  } else {
    flag.hidden = true;
  }
}

/* ---------- theme ---------- */

function initTheme() {
  const saved = localStorage.getItem('tr-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  $('#themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('tr-theme', next);
  });
}

/* ---------- events ---------- */

function initControls() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === btn));
    state.cat = btn.dataset.cat;
    render();
  });

  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value; render(); }, 120);
  });

  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

  $('#minProb').addEventListener('input', (e) => {
    state.minProb = Number(e.target.value);
    $('#minProbVal').textContent = state.minProb;
    render();
  });

  $('#hideDone').addEventListener('change', (e) => { state.hideDone = e.target.checked; render(); });
}

/* ---------- data loading ---------- */

async function loadJson(path, fallback) {
  try {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.warn(`[transfer-radar] ${path} を読み込めませんでした:`, err.message);
    return fallback;
  }
}

async function load() {
  const [data, photos] = await Promise.all([
    loadJson('data/transfers.json', null),
    loadJson('data/photos.json', {}),
  ]);

  state.photos = photos || {};

  if (!data || !Array.isArray(data.items)) {
    $('#empty').hidden = false;
    $('#empty').textContent =
      'data/transfers.json を読み込めませんでした。ローカルファイルを直接開いた場合は '
      + '`node scripts/serve.mjs` でサーバー経由で開いてください。';
    return;
  }

  state.items = data.items
    .filter((it) => it && it.player && it.from && it.to)
    .map((it) => ({
      ...it,
      probability: Math.max(0, Math.min(100, Math.round(Number(it.probability) || 0))),
    }));
  state.meta = {
    generatedAt: data.generatedAt,
    nextUpdateAt: data.nextUpdateAt,
    updateSchedule: data.updateSchedule,
    window: data.window,
  };

  render();
  renderClock();
}

/* ---------- boot ---------- */

initTheme();
initControls();
load();
setInterval(renderClock, 1000);

// 更新タスクが JSON を書き換えたら拾いにいく（表示のズレを最小にする）
setInterval(load, 60 * 1000);
