#!/usr/bin/env node
/* ============================================================
   setup-github.mjs — GitHub Pages 公開のための一度きりの設定。

     node scripts/setup-github.mjs <GitHubユーザー名> [リポジトリ名]

   やること:
   1. index.html のフッターの削除依頼連絡先を、そのリポジトリの
      Issues ページへのリンクに書き換える
   2. git remote origin を設定する（既にあれば上書き確認を促す）
   3. 次に実行すべきコマンドを表示する

   このスクリプトは push しません。認証を伴う操作は本人が行ってください。
   ============================================================ */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [user, repoArg] = process.argv.slice(2);
const repo = repoArg || 'transfer-radar';

if (!user || !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(user)) {
  console.error('使い方: node scripts/setup-github.mjs <GitHubユーザー名> [リポジトリ名]');
  console.error('  例:   node scripts/setup-github.mjs octocat');
  process.exit(1);
}

const issuesUrl = `https://github.com/${user}/${repo}/issues`;
const pagesUrl = `https://${user.toLowerCase()}.github.io/${repo}/`;
const remoteUrl = `https://github.com/${user}/${repo}.git`;

/* --- 1. フッターの連絡先を Issues リンクに --- */

const htmlPath = path.join(ROOT, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

const placeholder = '連絡先: <b>（未設定）</b>';
const link = `連絡先: <a href="${issuesUrl}" target="_blank" rel="noopener">GitHub Issues</a>`;

if (html.includes(placeholder)) {
  html = html.replace(placeholder, link);
  writeFileSync(htmlPath, html, 'utf8');
  console.log(`✓ フッターの連絡先を設定: ${issuesUrl}`);
} else if (html.includes(issuesUrl)) {
  console.log(`ℹ フッターの連絡先は既に設定済み: ${issuesUrl}`);
} else {
  console.warn('⚠ フッターの連絡先プレースホルダが見つかりません。index.html を手で確認してください。');
}

/* --- 2. git remote --- */

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
const tryGit = (args) => {
  try { return { ok: true, out: git(args) }; }
  catch (e) { return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).trim() }; }
};

if (!tryGit(['rev-parse', '--git-dir']).ok) {
  console.error('✗ git リポジトリではありません。先に `git init` を実行してください。');
  process.exit(1);
}

const existing = tryGit(['remote', 'get-url', 'origin']);
if (existing.ok && existing.out !== remoteUrl) {
  console.warn(`⚠ origin が別のURLに設定されています: ${existing.out}`);
  console.warn(`  変更する場合: git remote set-url origin ${remoteUrl}`);
} else if (existing.ok) {
  console.log(`ℹ origin は既に設定済み: ${remoteUrl}`);
} else {
  git(['remote', 'add', 'origin', remoteUrl]);
  console.log(`✓ origin を追加: ${remoteUrl}`);
}

/* --- 3. 次の手順 --- */

console.log(`
────────────────────────────────────────────────────────
次は自分で操作してください（認証が必要なため私は代行できません）

1) ブラウザで空のリポジトリを作る
   https://github.com/new
     Repository name : ${repo}
     Public を選択（Private だと GitHub Pages が無料で使えません）
     README / .gitignore / license は追加しない（チェックを外す）

2) 変更をコミットして push する
   cd "${ROOT}"
   git add -A
   git commit -m "chore: 公開用の連絡先を設定"
   git push -u origin main
   → 初回だけブラウザが開いて GitHub のログインを求められます

3) GitHub Pages を有効にする
   https://github.com/${user}/${repo}/settings/pages
     Source : Deploy from a branch
     Branch : main  /  (root)
     Save

4) 1〜2分待つと公開されます
   ${pagesUrl}

以降は30分ごとの定期タスクが自動で push するので、操作は不要です。
────────────────────────────────────────────────────────`);
