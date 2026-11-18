# Pi デプロイ（AGO 側テストプレイ版）

Vercel の公開版とは完全分離で、AGO BOT の Raspberry Pi 上にもう1つ
TAKASUMI WORLD BOX を動かすための資材。アプリは systemd サービス
`takasumi-web` として常駐し、DB は Pi のローカル Postgres の専用
データベースを使う（Neon には接続しない）。

## 配置

| パス | 役割 |
| --- | --- |
| `~/takasumi-web/app` | この repo の clone（ビルド元） |
| `~/takasumi-web/env` | 環境変数ファイル（systemd の EnvironmentFile） |
| `~/takasumi-web/releases/` | ビルド済みリリース（直近3つを保持） |
| `~/takasumi-web/current` | 稼働中リリースへのシンボリックリンク |

## 初回セットアップ

1. clone を置く。

   ```sh
   git clone https://github.com/TakasumiBOT/takasumi-worldbox-test ~/takasumi-web/app
   ```

2. ローカル Postgres に専用データベースと接続ユーザーを作る
   （Vercel 版の Neon とは別の、まっさらな世界になる）。

3. `~/takasumi-web/env` を作る。キーは以下（値は実環境のものを書くこと。
   秘密の値をこの repo にコミットしない）。

   - `PORT=3200`（ラッパーが受ける公開ポート）
   - `TAKASUMIBOT_NEXT_PORT=3201`（内包する Next 本体のポート）
   - `HOSTNAME=127.0.0.1`
   - `DATABASE_URL`（手順2のローカル Postgres の接続文字列。ホストが
     Neon でなければ `pg` ドライバで接続される）
   - `DISCORD_REDIRECT_URI`（Discord ログインを使う場合。テスプレ版の
     公開 URL の `/api/auth/discord/callback`。`lib/deploy-config.ts`
     より env が優先される）

4. スキーマを適用する。

   ```sh
   cd ~/takasumi-web/app
   set -a; . ~/takasumi-web/env; set +a
   npm install
   npm run setup:db
   ```

5. systemd ユニットをインストールする。

   ```sh
   sudo cp ~/takasumi-web/app/deploy/pi/takasumi-web.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable takasumi-web
   ```

6. 初回デプロイ。

   ```sh
   bash ~/takasumi-web/app/deploy/pi/deploy.sh
   ```

7. 公開は Cloudflare Tunnel 側の作業: テスプレ用サブドメインを
   `127.0.0.1:3200` へ向ける（Pi の `~/.cloudflared/config.yml` の
   ingress 追加と、Cloudflare 側の DNS が別途必要）。

## 更新

```sh
git -C ~/takasumi-web/app pull
bash ~/takasumi-web/app/deploy/pi/deploy.sh
```

deploy.sh はビルド→リリース組み立て→`current` の原子的な切り替え→
`sudo systemctl restart takasumi-web` までを行う。再起動だけ失敗した
場合は、組み立てと切り替えは完了した状態で、終了コードと標準エラー
へのメッセージで失敗が分かる。

## ロールバック

`current` の向き先を `releases/` 内の旧リリースへ切り替えて再起動する。

```sh
ln -s ~/takasumi-web/releases/<旧リリース> ~/takasumi-web/current.tmp
mv -T ~/takasumi-web/current.tmp ~/takasumi-web/current
sudo systemctl restart takasumi-web
```
