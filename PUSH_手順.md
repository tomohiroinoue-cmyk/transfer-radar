# push（公開への反映）が失敗したときの手順

Claude 側から実行した push が認証で止まる場合は、**自分のターミナルで実行**すれば
Git の認証ウィンドウが正しく表示されます。これが一番確実です。

---

## 方法A: 自分のターミナルで push する（推奨）

### 1. PowerShell を開く

`Windows キー` を押して `powershell` と入力し、Enter。黒い（または青い）窓が開きます。

### 2. 下の2行をコピーして貼り付け、Enter

```powershell
cd "C:\Users\Tomohiro Inoue\projects\transfer-radar"
git push -u origin main
```

> 貼り付けは `Ctrl+V` または右クリックです。

### 3. 認証する

初回だけ「Git Credential Manager」の窓が開きます。

- **「Browser」** を選ぶ → ブラウザで GitHub にログイン → `Authorize` を押す
- 窓が見えない場合は `Alt+Tab` で探す

### 4. 成功したときの表示

```
Enumerating objects: 50, done.
...
To https://github.com/tomohiroinoue-cmyk/transfer-radar.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

`* [new branch] main -> main` が出れば成功です。

---

## 方法B: Personal Access Token を使う（方法Aがうまくいかないとき）

ブラウザ認証が通らない環境ではこちらを使います。

### 1. トークンを作る

https://github.com/settings/tokens/new を開く

| 項目 | 設定 |
| --- | --- |
| Note | `transfer-radar` |
| Expiration | `No expiration`（または90日以上） |
| Select scopes | **`repo` にチェック**（これだけでよい） |

`Generate token` を押すと `ghp_...` で始まる文字列が表示されます。
**この画面を閉じると二度と表示されません。** メモしてください。

### 2. PowerShell で push する

```powershell
cd "C:\Users\Tomohiro Inoue\projects\transfer-radar"
git push -u origin main
```

- `Username` を聞かれたら → `tomohiroinoue-cmyk`
- `Password` を聞かれたら → **さきほどの `ghp_...` トークンを貼る**
  （GitHub のログインパスワードではありません）

### ⚠ トークンの扱い

- **トークンは誰にも教えないでください。Claude にも貼らないでください。**
  リポジトリへの書き込み権限がそのまま渡ってしまいます。
- リモートURLに埋め込む方法（`https://ユーザー名:トークン@github.com/...`）は
  **やらないでください。** `.git/config` に平文で残り、事故の原因になります。
  上の「Password を聞かれたら貼る」方式なら Windows の資格情報マネージャーに
  安全に保存されます。
- 漏れた・不要になったときは https://github.com/settings/tokens で `Delete` できます。

---

## push できたあとの確認

### 1. GitHub Pages を有効にする

https://github.com/tomohiroinoue-cmyk/transfer-radar/settings/pages

| 項目 | 設定 |
| --- | --- |
| Source | `Deploy from a branch` |
| Branch | `main` / `(root)` |

`Save` を押す。

### 2. 1〜2分待って公開URLを開く

https://tomohiroinoue-cmyk.github.io/transfer-radar/

---

## 2回目以降

定期タスクが30分ごとに自動で push するので、**もう何もしなくてよくなります。**
手動で反映したいときはこれだけです。

```powershell
cd "C:\Users\Tomohiro Inoue\projects\transfer-radar"
node scripts/deploy.mjs
```

## push が失敗したとき

**`git push --force` は絶対に使わないでください。** 履歴が壊れます。
エラーメッセージをそのまま Claude に貼れば対応します。
