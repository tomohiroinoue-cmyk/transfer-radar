#!/usr/bin/env node
/* ============================================================
   index.mjs — transfers.json の一覧を、コンテキストに載せやすい
   1行1件の要約として出力する。

   定期タスクが毎回 transfers.json を全文読むと 200KB 超（≒7万トークン）に
   なるため、更新すべき案件を判断するのに必要な情報だけを出す。
   全文が必要になるのは中身を書き換えるときだけで、それは upsert.mjs が担当する。

   使い方:
     node scripts/index.mjs              全件
     node scripts/index.mjs --stale 3    3日以上更新されていない案件だけ
     node scripts/index.mjs --tag japanese
     node scripts/index.mjs --id sano-mainz-liverpool   その案件だけ全文JSONで出す
   ============================================================ */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(path.join(ROOT, 'data', 'transfers.json'), 'utf8'));

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? true);
};

/* --id: 1件だけ全文で出す（書き換え前に中身を確認したいとき用） */
const wantId = opt('--id');
if (wantId && wantId !== true) {
  const it = data.items.find((i) => i.id === wantId);
  if (!it) { console.error(`該当なし: ${wantId}`); process.exit(1); }
  console.log(JSON.stringify(it, null, 2));
  process.exit(0);
}

let items = data.items;

const tag = opt('--tag');
if (tag && tag !== true) items = items.filter((i) => i.tags?.includes(tag));

const staleDays = Number(opt('--stale'));
if (Number.isFinite(staleDays) && staleDays > 0) {
  const cutoff = Date.now() - staleDays * 86400000;
  items = items.filter((i) => Date.parse(i.updatedAt || 0) < cutoff);
}

const ageDays = (iso) => {
  const t = Date.parse(iso || 0);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : 999;
};

items = [...items].sort((a, b) => b.probability - a.probability);

/* --- ヘッダ --- */
console.log(`# transfers.json 一覧`);
console.log(`generatedAt: ${data.generatedAt}`);
console.log(`更新間隔: ${data.updateSchedule?.intervalMinutes ?? '?'}分 / 稼働: ${
  (data.updateSchedule?.activeHours ?? []).join(',') || '常時'} 時 (${data.updateSchedule?.timezone ?? ''})`);
console.log(`表示 ${items.length}件 / 全 ${data.items.length}件`
  + `（成立 ${data.items.filter((i) => i.probability === 100).length} / 噂 ${data.items.filter((i) => i.probability < 100).length}）`);
console.log(`\n形式: 確度 | id | 選手 | 移籍元→移籍先 | 状態 | 経過日数 | 出典数`);
console.log('-'.repeat(100));

for (const i of items) {
  console.log([
    String(i.probability).padStart(3) + '%',
    i.id,
    i.player?.nameJa || i.player?.name,
    `${i.from?.club}→${i.to?.club}`,
    i.status,
    `${ageDays(i.updatedAt)}日前`,
    `出典${i.sources?.length ?? 0}`,
  ].join(' | '));
}

/* --- 更新の優先度が高いものを明示する --- */
const stale = data.items.filter((i) => i.probability < 100 && ageDays(i.updatedAt) >= 2);
if (stale.length) {
  console.log(`\n## 2日以上動きがない噂（${stale.length}件）— 進展を確認するか、ルーブリックの「5日以上更新なし −10」を適用する`);
  for (const i of stale.slice(0, 30)) {
    console.log(`  ${i.id} (${i.probability}%, ${ageDays(i.updatedAt)}日前)`);
  }
}

console.log(`\n## 使い方`);
console.log(`  1件の全文を見る:      node scripts/index.mjs --id <id>`);
console.log(`  変更を反映する:        node scripts/upsert.mjs <変更だけを書いたJSON配列のパス>`);
console.log(`  ※ transfers.json を直接開くと 200KB超（≒7万トークン）なので読まないこと。`);
