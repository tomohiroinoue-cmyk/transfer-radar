#!/usr/bin/env node
/* ============================================================
   deploy.mjs — 更新済みのデータを GitHub Pages に反映する。

   やること: JSONの検証 → 変更があれば commit → push（fast-forward のみ）

   安全のために守っていること:
   - `git push --force` は絶対に使わない。
   - リモート未設定・変更なしの場合は何もせず正常終了する（定期タスクが
     毎回エラーで止まらないように）。
   - transfers.json が壊れていたら push しない（壊れたサイトを公開しない）。

   使い方:  node scripts/deploy.mjs
   ============================================================ */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts,
  }).trim();
}

function tryGit(args) {
  try { return { ok: true, out: git(args) }; }
  catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() }; }
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

/* --- 1. データの健全性チェック（壊れたものを公開しない） --- */

let data;
try {
  data = JSON.parse(readFileSync(path.join(ROOT, 'data', 'transfers.json'), 'utf8'));
} catch (e) {
  fail(`data/transfers.json が JSON として壊れています: ${e.message}`);
}
if (!Array.isArray(data.items) || data.items.length === 0) {
  fail('data/transfers.json の items が空です。公開を中止しました。');
}
const badProb = data.items.filter((it) => {
  const p = it.probability;
  if (!Number.isInteger(p) || p < 0 || p > 100) return true;
  return p === 100 && it.status !== '成立'; // 100% は公式発表済みだけ
});
if (badProb.length) {
  fail(`確度の値が不正な案件があります: ${badProb.map((i) => `${i.id}(${i.probability})`).join(', ')}`);
}
const noSource = data.items.filter((it) => !it.sources?.length);
if (noSource.length) {
  fail(`出典のない案件があります: ${noSource.map((i) => i.id).join(', ')}`);
}
console.log(`✓ データ検証OK — ${data.items.length}件 / 成立 ${data.items.filter(i => i.probability === 100).length}件`);

/* --- 2. git リポジトリとリモートの確認 --- */

if (!tryGit(['rev-parse', '--git-dir']).ok) {
  console.log('ℹ git リポジトリではないため公開をスキップしました。');
  console.log('  README.md の「公開する」の手順を実行してください。');
  process.exit(0);
}

const remote = tryGit(['remote', 'get-url', 'origin']);
if (!remote.ok) {
  console.log('ℹ origin リモートが未設定のため push をスキップしました。');
  console.log('  README.md の「公開する」の手順を実行してください。');
  process.exit(0);
}
console.log(`✓ origin = ${remote.out}`);

/* --- 3. 変更があればコミット --- */

const status = git(['status', '--porcelain']);
if (!status) {
  console.log('ℹ 変更がないため公開をスキップしました。');
  process.exit(0);
}
console.log(`変更されたファイル:\n${status.split('\n').map((l) => '  ' + l).join('\n')}`);

git(['add', '-A']);

const stamp = new Date().toLocaleString('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const msg = `data: 移籍情報を更新 (${stamp} JST) — ${data.items.length}件`;

const commit = tryGit(['commit', '-m', msg]);
if (!commit.ok) fail(`commit に失敗しました:\n${commit.out}`);
console.log(`✓ commit: ${msg}`);

/* --- 4. push（fast-forward のみ。失敗しても force はしない） --- */

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const push = tryGit(['push', 'origin', branch]);
if (!push.ok) {
  console.error(`✗ push に失敗しました（commit はローカルに残っています）:\n${push.out}`);
  console.error('  認証切れ、またはリモートに別の変更がある可能性があります。');
  console.error('  手動で `git pull --rebase` してから再実行してください。force push は使わないこと。');
  process.exit(1);
}
console.log(`✓ push 完了 (${branch}) — GitHub Pages の反映まで1分ほどかかります。`);
