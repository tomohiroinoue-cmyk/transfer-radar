#!/usr/bin/env node
/* ============================================================
   fetch-photos.mjs
   data/transfers.json に載っている選手について、Wikipedia / Wikimedia
   Commons から「自由ライセンスの写真」と「生年月日」を取得し、
     - data/photos/<id>.<ext>   … 画像本体
     - data/photos.json         … 帰属表示用のメタデータ + birthDate
   を書き出す。

   守っていること:
   - 採用するのは commons.wikimedia.org 上のファイルのみ。英語版
     Wikipedia ローカルのファイルはフェアユースの可能性があるため除外。
   - ライセンス名に fair use / non-free を含むものは除外。
   - 撮影者・ライセンス名・ライセンスURL・ファイル解説ページURLを必ず記録し、
     どれか欠けたら採用しない（帰属表示ができない画像は使わない）。

   使い方:  node scripts/fetch-photos.mjs [--force]
   ============================================================ */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRANSFERS = path.join(ROOT, 'data', 'transfers.json');
const PHOTOS_JSON = path.join(ROOT, 'data', 'photos.json');
const PHOTOS_DIR = path.join(ROOT, 'data', 'photos');

const UA = 'TransferRadar/1.0 (personal hobby site; contact via site owner)';
const THUMB_PX = 400;
const FORCE = process.argv.includes('--force');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Wikimedia は匿名アクセスに厳しめのレート制限をかけるため、429 / 5xx は
   Retry-After を尊重しつつ指数バックオフで数回まで再試行する。 */
async function api(host, params, attempt = 0) {
  const url = new URL(`https://${host}/w/api.php`);
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });

  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1500 * 2 ** attempt;
    console.warn(`  ${res.status} — ${Math.round(waitMs / 1000)}秒待って再試行 (${attempt + 1}/4)`);
    await sleep(waitMs);
    return api(host, params, attempt + 1);
  }

  if (!res.ok) throw new Error(`${host} ${res.status} ${res.statusText}`);
  return res.json();
}

/** 選手名から Wikipedia の記事タイトルを引く。en → ja の順に試す。 */
async function resolveTitle(nameLatin, nameJa) {
  const attempts = [
    ['en.wikipedia.org', `${nameLatin} footballer`],
    ['en.wikipedia.org', nameLatin],
  ];
  if (nameJa && nameJa !== nameLatin) {
    attempts.push(['ja.wikipedia.org', `${nameJa} サッカー`]);
    attempts.push(['ja.wikipedia.org', nameJa]);
  }
  for (const [host, q] of attempts) {
    try {
      const d = await api(host, { action: 'query', list: 'search', srsearch: q, srlimit: '1' });
      const hit = d?.query?.search?.[0];
      if (hit) return { host, title: hit.title };
    } catch (e) {
      console.warn(`  検索失敗 (${host}, "${q}"): ${e.message}`);
    }
    await sleep(350);
  }
  return null;
}

/** 記事ページから代表画像のファイル名と Wikidata ID を取る。 */
async function pageMeta(host, title) {
  const d = await api(host, {
    action: 'query', titles: title,
    prop: 'pageimages|pageprops', piprop: 'name', ppprop: 'wikibase_item',
  });
  const page = d?.query?.pages?.[0];
  if (!page || page.missing) return null;
  return {
    file: page.pageimage || null,
    wikidataId: page.pageprops?.wikibase_item || null,
  };
}

/** ファイルのライセンス情報とサムネイルURL。commons 以外／非自由は null を返す。 */
async function fileInfo(host, fileName) {
  const d = await api(host, {
    action: 'query', titles: `File:${fileName}`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: String(THUMB_PX),
  });
  const info = d?.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) return null;

  const descUrl = info.descriptionurl || '';
  if (!descUrl.includes('commons.wikimedia.org')) {
    return { rejected: 'Commons上のファイルではない（フェアユースの可能性）' };
  }

  const meta = info.extmetadata || {};
  const strip = (v) => String(v ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const license = strip(meta.LicenseShortName?.value);
  const artist = strip(meta.Artist?.value) || strip(meta.Credit?.value);
  const licenseUrl = strip(meta.LicenseUrl?.value);

  if (/fair use|non-?free/i.test(license)) {
    return { rejected: `非自由ライセンス (${license})` };
  }
  if (!license || !artist) {
    return { rejected: '撮影者またはライセンス名が取得できず帰属表示できない' };
  }

  return {
    thumbUrl: info.thumburl || info.url,
    artist, license,
    licenseUrl: licenseUrl || null,
    sourcePage: descUrl,
  };
}

/** Wikidata の P569 (生年) を取る。 */
async function birthDate(wikidataId) {
  if (!wikidataId) return null;
  try {
    const d = await api('www.wikidata.org', {
      action: 'wbgetclaims', entity: wikidataId, property: 'P569',
    });
    const t = d?.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time; // "+1997-11-16T00:00:00Z"
    if (!t) return null;
    const m = t.match(/^[+-](\d{4})-(\d{2})-(\d{2})/);
    if (!m || m[2] === '00' || m[3] === '00') return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  } catch (e) {
    console.warn(`  Wikidata 取得失敗 (${wikidataId}): ${e.message}`);
    return null;
  }
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`画像取得 ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

const exists = (p) => access(p).then(() => true, () => false);

/** 1人ぶんのレコードを組み立てる。写真が使えない場合は noPhoto + 理由を返す。 */
async function buildRecord(key, player) {
  const record = { checkedAt: new Date().toISOString() };

  const resolved = await resolveTitle(player.name, player.nameJa);
  if (!resolved) return { ...record, noPhoto: true, reason: 'Wikipedia記事が見つからない' };
  record.wikiPage = `https://${resolved.host}/wiki/${encodeURIComponent(resolved.title.replace(/ /g, '_'))}`;

  const meta = await pageMeta(resolved.host, resolved.title);
  await sleep(300);
  record.birthDate = await birthDate(meta?.wikidataId);
  await sleep(300);

  if (!meta?.file) return { ...record, noPhoto: true, reason: '記事に代表画像がない' };

  const fi = await fileInfo(resolved.host, meta.file);
  if (!fi || fi.rejected) {
    return { ...record, noPhoto: true, reason: fi?.rejected || 'ファイル情報を取得できない' };
  }

  const ext = (fi.thumbUrl.match(/\.(jpe?g|png|webp)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase();
  const slug = key.normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
    || `p${[...key].reduce((a, c) => a + c.charCodeAt(0), 0)}`;
  const fileName = `${slug}.${ext}`;

  await download(fi.thumbUrl, path.join(PHOTOS_DIR, fileName));

  return {
    ...record,
    file: fileName,
    artist: fi.artist,
    license: fi.license,
    licenseUrl: fi.licenseUrl,
    sourcePage: fi.sourcePage,
  };
}

async function main() {
  const data = JSON.parse(await readFile(TRANSFERS, 'utf8'));
  await mkdir(PHOTOS_DIR, { recursive: true });

  let photos = {};
  if (await exists(PHOTOS_JSON)) {
    try { photos = JSON.parse(await readFile(PHOTOS_JSON, 'utf8')); } catch { photos = {}; }
  }

  // 同じ選手が複数の噂に出るので名前で重複排除
  const players = new Map();
  for (const it of data.items) {
    const key = it.player.photoKey || it.player.name;
    if (!players.has(key)) players.set(key, it.player);
  }

  let added = 0, kept = 0, failed = 0;

  for (const [key, player] of players) {
    const cached = photos[key];
    if (!FORCE && cached && (cached.file || cached.noPhoto)) {
      // 画像ファイルが実在するかだけ確認する
      if (!cached.file || await exists(path.join(PHOTOS_DIR, cached.file))) { kept++; continue; }
    }

    console.log(`- ${key}`);
    try {
      const rec = await buildRecord(key, player);
      photos[key] = rec;
      if (rec.file) {
        added++;
        console.log(`  → ${rec.file} (${rec.license} / ${rec.artist})`);
      } else {
        failed++;
        console.log(`  → 写真なし: ${rec.reason}`);
      }
    } catch (e) {
      // 1人失敗しても全体を止めない。次回実行で再挑戦できるよう記録は残さない。
      failed++;
      console.log(`  → エラー: ${e.message}`);
    }

    // 途中で落ちても取得済みぶんが失われないよう毎回保存する
    await writeFile(PHOTOS_JSON, JSON.stringify(photos, null, 2) + '\n', 'utf8');
    await sleep(700); // Wikimedia への負荷を抑える
  }

  await writeFile(PHOTOS_JSON, JSON.stringify(photos, null, 2) + '\n', 'utf8');
  console.log(`\n完了: 新規 ${added} / キャッシュ流用 ${kept} / 写真なし ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
