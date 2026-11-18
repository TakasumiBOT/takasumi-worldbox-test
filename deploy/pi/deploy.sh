#!/usr/bin/env bash
# TAKASUMI WORLD BOX（AGO 側テストプレイ版）を Pi 上でビルドしてリリースを切り替える。
# 使い方: Pi 上でユーザー luna として `bash deploy/pi/deploy.sh` を実行する。
# 前提: systemd ユニット takasumi-web（deploy/pi/takasumi-web.service）が
#       インストール済みで、$HOME/takasumi-web/env に環境変数が置いてあること。
set -euo pipefail

SRC="$HOME/takasumi-web/app"
ROOT="$HOME/takasumi-web"
RELEASE="$ROOT/releases/$(date +%Y%m%d%H%M%S)"
BUILD="$ROOT/build"

mkdir -p "$ROOT/releases"

echo "== build from $SRC ($(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo unknown))"

# ビルド用コピー（.git / node_modules / .next は持ち込まない）
rm -rf "$BUILD"
mkdir -p "$BUILD"
cp -a "$SRC/." "$BUILD/"
rm -rf "$BUILD/.git" "$BUILD/node_modules" "$BUILD/.next"
cd "$BUILD"
# この repo のロックファイルは bun.lock で package-lock.json は無いため ci は使わない
npm install
npm run build

# リリースを組み立てる（standalone 本体 + .next/static + public）
mkdir -p "$RELEASE"
cp -a "$BUILD/.next/standalone/." "$RELEASE/"
mkdir -p "$RELEASE/.next/static"
cp -a "$BUILD/.next/static/." "$RELEASE/.next/static/"
cp -a "$BUILD/public" "$RELEASE/public"

# リアルタイム中継ラッパーを設置する（standalone の server.js を内包し、
# /api/worldbox/realtime の WebSocket だけをラッパーが受ける）。
mv "$RELEASE/server.js" "$RELEASE/next-server.js"
cp -a "$BUILD/realtime-server.js" "$RELEASE/server.js"
cp -a "$BUILD/realtime" "$RELEASE/realtime"
mkdir -p "$RELEASE/node_modules/ws"
cp -a "$BUILD/node_modules/ws/." "$RELEASE/node_modules/ws/"

# current を新しいリリースへ原子的に切り替える
ln -s "$RELEASE" "$ROOT/current.tmp"
mv -T "$ROOT/current.tmp" "$ROOT/current"
echo "== current -> $RELEASE"

# 再起動。失敗しても組み立てと切り替えは完了として扱い、
# 終了コードとログで失敗が分かるようにする。
RESTART_RC=0
sudo systemctl restart takasumi-web || RESTART_RC=$?

# 古いリリースは新しい順に3つだけ残す（切り替え済みの current は削除対象にしない）
cd "$ROOT/releases"
ls -1dt */ | tail -n +4 | while read -r old; do
  old="${old%/}"
  if [ "$(readlink -f "$ROOT/current")" != "$ROOT/releases/$old" ]; then
    rm -rf -- "$ROOT/releases/$old"
  fi
done

if [ "$RESTART_RC" -ne 0 ]; then
  echo "エラー: takasumi-web の再起動に失敗しました (exit $RESTART_RC)。" >&2
  echo "リリースの組み立てと current の切り替えは完了しています。systemctl status takasumi-web で状態を確認してください。" >&2
  exit "$RESTART_RC"
fi
echo "== deploy complete: $RELEASE"
