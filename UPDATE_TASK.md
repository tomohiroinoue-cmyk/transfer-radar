# 更新タスク指示書（30分ごとに実行される内容）

このファイルは Claude の定期タスクがそのまま読み込んで実行する手順書です。
`transfer-hub/data/transfers.json` を書き換えることだけが仕事です。

---

## 0. 実行の上限（必ず守る）

- **Web検索は1回の実行で最大 8 クエリまで。** それ以上は次の実行に回す。
- **WebFetch は1回の実行で最大 6 ページまで。**
- 上限に達したら、そこまでで得た情報だけで `transfers.json` を更新して終了する。
  「情報が足りないからもっと調べる」は禁止。次の実行が30分後にある。
- 1回の実行が5分を超えたら、その時点の内容で保存して終了する。

## 1. やること

1. `data/transfers.json` を読み、既存の `items` を把握する。
2. 下の情報源を巡回し、**新しい噂**と**既存の噂の進展**を集める。
3. 各案件の確度を §3 のルーブリックで算出する。
4. `data/transfers.json` を丸ごと書き直す。
5. 新しい選手が追加された場合のみ `node scripts/fetch-photos.mjs` を実行する
   （既存選手だけなら実行不要。Wikimedia への無駄なアクセスを避ける）。

## 2. 情報源

対象は3カテゴリ。**プレミアリーグ全20クラブ**、**その他リーグのビッグクラブ**
（レアル・マドリード / バルセロナ / アトレティコ / バイエルン / ドルトムント /
インテル / ミラン / ユベントス / ナポリ / PSG / アヤックス / ベンフィカ /
ポルト / スポルティング）、**日本人選手の海外移籍**。

優先して当たる先:

| 用途 | URL |
| --- | --- |
| プレミア全体 | https://www.skysports.com/football/live-blog/31771/12476234/transfer-centre-live-football-transfer-news-updates-and-rumours |
| 噂のランキング | https://www.football365.com/news/transfer-window-summer-2026-rumours-ranked |
| 欧州全体 | https://www.besoccer.com/new/latest-transfer-news-football-rumours-confirmed-1412436 |
| プレミア公式（成立分） | https://www.premierleague.com/en/transfers/2026-27/summer |
| 日本人選手 | https://web.ultra-soccer.jp/news/all/28454/ |
| 日本人選手 | https://www.soccer-king.jp/news/world/fixed/ |

検索クエリの例（この中から必要なものを選ぶ。全部やらない）:
`Premier League transfer rumours today` / `Real Madrid Barcelona Bayern transfer news today` /
`日本人選手 海外移籍 移籍情報`

## 3. 確度ルーブリック（サイトの表示と一致させる）

### ステップ1 — 交渉段階でベースを置く

| 段階 | ベース |
| --- | --- |
| 興味・リストアップの報道のみ | 05–20% |
| 打診・代理人接触が報じられた | 20–35% |
| クラブ間で交渉中／オファー提出 | 35–55% |
| 個人条件で合意、クラブ間は未合意 | 55–70% |
| 移籍金でクラブ間が合意 | 70–85% |
| メディカル実施／発表待ち | 85–99% |

### ステップ2 — ソース信頼度で補正

| Tier | 該当 | 補正 |
| --- | --- | --- |
| 1 | クラブ公式・リーグ公式 | そのまま採用 |
| 2 | BBC / Sky Sports / Fabrizio Romano / L'Équipe / Bild / Athletic | ±0 |
| 3 | 全国紙・大手スポーツ紙の追随報道、Football365、超WORLDサッカー等 | −5 |
| 4 | まとめ系・アグリゲーター（CaughtOffside 等） | −15 |

### ステップ3 — 加減算

- 独立した複数の Tier2 が一致 … **+5〜10**
- クラブ／選手が公式に否定 … **−20**
- 該当の報道が5日以上更新されていない … **−10**
- 移籍市場の閉幕まで7日未満で未合意 … **−10**
- 行き先が複数クラブで競合している … 「移籍する確率 × そのクラブを選ぶ確率」で割り引く
- 解除条項が発動された … 交渉段階を飛ばせるので 85–99% の帯に置く

### 上限・下限

- **噂・交渉中の案件は 0〜99 の整数のみ。100 は使わない。**
  まだ成立していない案件を 100% にするのは禁止。推定値の上限は 99。
- **クラブが公式発表した案件だけが `probability: 100` / `status: "成立"`。**
  `reasoning` には「公式発表済みのため確度の推定対象外。表示上は100%に固定」と書く。
- つまり **100 は「推定」ではなく「事実」を意味する**。この境界を崩さないこと。

## 4. 出力フォーマット

`data/transfers.json` を次の形で丸ごと書き直す。**キー名を変えてはいけない**
（`assets/app.js` が直接参照している）。

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "<今のUTC時刻 ISO8601>",
  "nextUpdateAt": "<generatedAt + 30分>",
  "updateSchedule": { /* 既存の値をそのままコピーする。書き換えない */ },
  "window": { "name": "...", "closesAt": "...", "note": "..." },
  "items": [
    {
      "id": "player-from-to",            // 半角小文字ケバブ。既存案件は変えない
      "tags": ["premier"],               // "premier" | "bigclub" | "japanese" から1つ以上
      "player": {
        "name": "Latin Name",            // ラテン文字表記
        "nameJa": "日本語表記",
        "position": "GK|DF|MF|FW",       // 自信がなければキーを省く
        "nationality": "日本語の国名"
      },
      "from": { "club": "English Club Name", "clubJa": "日本語クラブ名", "league": "Premier League" },
      "to":   { "club": "English Club Name", "clubJa": "日本語クラブ名", "league": "LaLiga" },
      "fee": "£40m + ボーナス",           // 不明なら "非公表"
      "type": "permanent|loan|loan-to-buy|free",
      "probability": 72,                  // 噂は 0-99 の整数 / 公式発表済みは 100
      "trend": "up|down|flat",            // 前回の値との比較。+3以上=up, -3以下=down
      "status": "メディカル",              // 短い日本語。カード上のバッジになる
      "summaryJa": "報道内容の要約2〜3文。",
      "reasoning": "確度の根拠。ベースの帯 → 加減算 → 最終値の順で書く。",
      "sources": [
        { "outlet": "Sky Sports", "tier": 2, "title": "記事見出し", "url": "https://...", "publishedAt": "2026-08-06" }
      ],
      "updatedAt": "<この案件を確認したUTC時刻>"
    }
  ]
}
```

### `tags` の付け方

- 移籍元／移籍先のどちらかがプレミアリーグのクラブ … `"premier"`
- 移籍元／移籍先のどちらかが §2 のビッグクラブ … `"bigclub"`
- 選手が日本人 … `"japanese"`
- 複数該当する場合は全部入れる（例: シティ→レアルなら `["premier","bigclub"]`）。

### `clubJa` は必須ではないが推奨

`clubJa` が無い場合はカードに `club`（英語名）が出る。クラブカラーの参照は
`club`（英語名）で行うので、**`club` は `assets/app.js` の `CLUB_COLORS` に
あるキーと綴りを揃える**。未登録クラブは名前から自動生成した色になる。

## 5. 禁止事項

- **報道されていない情報を書かない。** 移籍金・年齢・ポジションを推測で埋めない。
  不明なものはキーを省くか `"非公表"` にする。
- **年齢（`player.age`）は書かない。** 年齢は `fetch-photos.mjs` が Wikidata の
  生年月日から計算して `photos.json` に入れ、サイト側が表示する。
- 記事本文を転載しない。`summaryJa` は自分の言葉で要約する。
- 出典URLを持たない案件を `items` に入れない。
- 前回あった案件を、根拠なく消さない。動きがなければ `updatedAt` を据え置き、
  §3の「5日以上更新なし = −10」を適用する。7日以上動きがなく確度が10%未満に
  なった案件は削除してよい。
- `items` は 45 件までに抑える（確度の高い順・更新の新しい順で残す）。

## 6. 終了時の自己チェック

- [ ] `node -e "JSON.parse(require('fs').readFileSync('data/transfers.json','utf8'))"` が通る
- [ ] `generatedAt` を現在時刻に更新した
- [ ] `nextUpdateAt` = `generatedAt` + 30分
- [ ] `updateSchedule` を前の値からそのまま引き継いだ（消すとサイトが誤警告を出す）
- [ ] すべての `probability` が整数で、100 なのは `status: "成立"` の案件だけ
- [ ] すべての item に `sources` が1件以上あり、URLが実在する
- [ ] `tags` が空の item がない
