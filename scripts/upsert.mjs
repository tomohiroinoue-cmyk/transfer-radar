#!/usr/bin/env node
/* ============================================================
   upsert.mjs — 変更ぶんだけを書いた JSON 配列を transfers.json に反映する。

   定期タスクが transfers.json を全文読んで全文書き直すのをやめるための仕組み。
   タスクは「新規・更新したい案件だけ」を小さな配列で渡せばよい。

   やること:
   - スキーマとルールの検証（噂が100%、出典なし 等は弾く）
   - クラブ名の表記揺れを正規化（Big 6 フィルターは完全一致で判定するため）
   - 「同じ選手 × 同じ移籍先」を同一案件として更新（アクセント記号の違いも吸収）
   - generatedAt / nextUpdateAt の更新

   使い方:
     node scripts/upsert.mjs changes.json

   changes.json の形（transfers.json の items と同じ形の配列）:
     [ { "id": "...", "tags": [...], "player": {...}, ... } ]

   案件を削除したいときは `{"id": "...", "_delete": true}` を入れる。
   ============================================================ */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'data', 'transfers.json');
const MAX_ITEMS = 150;

const src = process.argv[2];
if (!src) {
  console.error('使い方: node scripts/upsert.mjs <変更を書いたJSON配列のパス>');
  process.exit(1);
}

/* 2026-27シーズンのリーグ所属（プレミアリーグ公式で確認済み）
   昇格: Coventry City / Ipswich Town / Hull City
   降格: Wolves / Burnley / West Ham */
const PL = new Set([
  'Arsenal', 'Aston Villa', 'Bournemouth', 'Brentford', 'Brighton', 'Chelsea',
  'Coventry City', 'Crystal Palace', 'Everton', 'Fulham', 'Hull City',
  'Ipswich Town', 'Leeds United', 'Liverpool', 'Manchester City',
  'Manchester United', 'Newcastle United', 'Nottingham Forest', 'Sunderland',
  'Tottenham',
]);

const ALIAS = {
  'man city': 'Manchester City', 'man. city': 'Manchester City',
  'man united': 'Manchester United', 'man utd': 'Manchester United',
  'tottenham hotspur': 'Tottenham', 'spurs': 'Tottenham',
  'newcastle': 'Newcastle United', 'west ham united': 'West Ham',
  'brighton & hove albion': 'Brighton', 'brighton and hove albion': 'Brighton',
  'wolverhampton wanderers': 'Wolves', 'leeds': 'Leeds United',
  'inter': 'Inter Milan', 'internazionale': 'Inter Milan', 'milan': 'AC Milan',
  'as roma': 'Roma', 'ss lazio': 'Lazio',
  'paris saint-germain': 'PSG', 'paris sg': 'PSG',
  'bayern': 'Bayern Munich', 'fc bayern': 'Bayern Munich', 'bayern münchen': 'Bayern Munich',
  'dortmund': 'Borussia Dortmund', 'bvb': 'Borussia Dortmund',
  'leipzig': 'RB Leipzig', 'sporting': 'Sporting CP', 'sporting lisbon': 'Sporting CP',
  'atlético madrid': 'Atletico Madrid', 'atletico de madrid': 'Atletico Madrid',
  'olympique marseille': 'Marseille', 'olympique de marseille': 'Marseille',
  'ajax amsterdam': 'Ajax', 'psv eindhoven': 'PSV',
  'fenerbahçe': 'Fenerbahce', 'schalke 04': 'Schalke',
};

const norm = (n) => (n ? (ALIAS[String(n).trim().toLowerCase()] || String(n).trim()) : n);
const flat = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const data = JSON.parse(readFileSync(TARGET, 'utf8'));
let changes;
try {
  changes = JSON.parse(readFileSync(path.resolve(src), 'utf8'));
} catch (e) {
  console.error(`✗ 入力ファイルを読めません: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(changes)) { console.error('✗ 入力はJSON配列である必要があります'); process.exit(1); }

const NOW = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const byId = new Map(data.items.map((i) => [i.id, i]));
const byTransfer = new Map(data.items.map((i) => [`${flat(i.player?.name)}|${flat(i.to?.club)}`, i]));

const rep = { added: 0, updated: [], deleted: [], rejected: [], normalized: new Set() };

for (const raw of changes) {
  const it = JSON.parse(JSON.stringify(raw));

  /* 削除 */
  if (it._delete) {
    const target = byId.get(it.id);
    if (!target) { rep.rejected.push(`${it.id} — 削除対象が見つからない`); continue; }
    data.items = data.items.filter((x) => x.id !== it.id);
    byId.delete(it.id);
    byTransfer.delete(`${flat(target.player?.name)}|${flat(target.to?.club)}`);
    rep.deleted.push(`${target.player?.nameJa || target.player?.name} → ${target.to?.club}`);
    continue;
  }

  /* 検証 */
  const why = [];
  if (!it.id) why.push('idなし');
  if (!it.player?.name) why.push('player.nameなし');
  if (!it.from?.club) why.push('from.clubなし');
  if (!it.to?.club) why.push('to.clubなし');
  if (!Array.isArray(it.tags) || !it.tags.length) why.push('tagsなし');
  if (!Array.isArray(it.sources) || !it.sources.length) why.push('出典なし');
  else if (!it.sources.every((s) => /^https?:\/\/.+/.test(s.url || ''))) why.push('出典URLが不正');
  if (!it.summaryJa) why.push('summaryJaなし');

  const p = it.probability;
  if (!Number.isInteger(p) || p < 0 || p > 100) why.push(`確度が不正(${p})`);
  else if (p === 100 && it.status !== '成立') why.push(`成立でないのに100%(${it.status})`);
  else if (p < 100 && it.status === '成立') why.push(`成立なのに${p}%`);

  if (it.player && 'age' in it.player) delete it.player.age;
  if (why.length) { rep.rejected.push(`${it.id || '(id不明)'} — ${why.join(' / ')}`); continue; }

  /* 正規化 */
  for (const side of ['from', 'to']) {
    const before = it[side].club;
    it[side].club = norm(before);
    if (before !== it[side].club) rep.normalized.add(`${before} → ${it[side].club}`);
    if (PL.has(it[side].club)) it[side].league = 'Premier League';
  }
  const involvesPL = PL.has(it.from.club) || PL.has(it.to.club);
  if (involvesPL && !it.tags.includes('premier')) it.tags.push('premier');
  if (!involvesPL) it.tags = it.tags.filter((t) => t !== 'premier');
  if (!it.tags.length) it.tags.push('bigclub');
  if (!it.trend) it.trend = 'flat';
  if (!it.fee) it.fee = '非公表';
  it.updatedAt = NOW;

  /* 反映 */
  const key = `${flat(it.player.name)}|${flat(it.to.club)}`;
  const existing = byId.get(it.id) || byTransfer.get(key);

  if (existing) {
    const label = `${existing.player.nameJa || existing.player.name} → ${existing.to.clubJa || existing.to.club}`;
    if (existing.probability !== it.probability) {
      rep.updated.push(`${label}: ${existing.probability}% → ${it.probability}% (${existing.status} → ${it.status})`);
    } else {
      rep.updated.push(`${label}: ${it.probability}% (内容のみ更新)`);
    }
    const id = existing.id; // idは変えない（外部から参照される可能性があるため）
    Object.assign(existing, it, { id });
    byTransfer.set(key, existing);
  } else {
    if (byId.has(it.id)) it.id = `${it.id}-2`;
    data.items.push(it);
    byId.set(it.id, it);
    byTransfer.set(key, it);
    rep.added++;
  }
}

/* 件数上限。削るのは最後の手段で、japanese は削らない */
if (data.items.length > MAX_ITEMS) {
  const age = (i) => Date.parse(i.updatedAt || 0);
  const droppable = data.items
    .filter((i) => !i.tags.includes('japanese') && i.probability < 20)
    .sort((a, b) => age(a) - age(b));
  const n = Math.min(data.items.length - MAX_ITEMS, droppable.length);
  const drop = new Set(droppable.slice(0, n).map((i) => i.id));
  if (drop.size) {
    data.items = data.items.filter((i) => !drop.has(i.id));
    rep.deleted.push(`件数上限(${MAX_ITEMS})超過のため低確度の古い案件を ${drop.size}件 削除`);
  }
}

data.generatedAt = NOW;
const interval = Number(data.updateSchedule?.intervalMinutes) || 60;
data.nextUpdateAt = new Date(Date.parse(NOW) + interval * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
writeFileSync(TARGET, JSON.stringify(data, null, 2) + '\n', 'utf8');

/* 報告 */
console.log(`✓ 新規 ${rep.added}件 / 更新 ${rep.updated.length}件 / 削除 ${rep.deleted.length}件 → 合計 ${data.items.length}件`);
for (const u of rep.updated) console.log(`  更新: ${u}`);
for (const d of rep.deleted) console.log(`  削除: ${d}`);
for (const n of rep.normalized) console.log(`  クラブ名を正規化: ${n}`);
if (rep.rejected.length) {
  console.log(`\n✗ ルール違反で取り込まなかった ${rep.rejected.length}件:`);
  for (const r of rep.rejected) console.log(`  ${r}`);
  console.log('  → 直して再実行してください。検証を迂回してはいけません。');
}
console.log(`\ngeneratedAt = ${data.generatedAt} / nextUpdateAt = ${data.nextUpdateAt}`);
