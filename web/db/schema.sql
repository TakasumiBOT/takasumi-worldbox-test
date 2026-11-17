-- takasumi-worldbox-test 独立環境の DB スキーマ（Neon Postgres）。
--
-- AGO 側の docs/sql/bot_kv.sql / economy_pool.sql / proposed_transfer_coins.sql
-- が定義していたテーブル形をそのまま移植したもの。以後の正はこのファイル。
-- RPC 4本（economy_pool_pay_house / economy_pool_refund_house /
-- economy_pool_add_loss / transfer_coins）は SQL 関数として作らず、
-- web/lib/botapi-server.ts がトランザクション + 行ロックで実装する
-- （意味論は AGO 側 SQL 定義と一致）。
--
-- 何度実行しても安全（冪等）。適用は web/scripts/setup-db.mjs から行う。

begin;

-- ---------------------------------------------------------------------------
-- bot_kv: 全ゲーム状態（名前空間 × キー → jsonb）。AGO の bot_kv.sql と同一形。
-- ---------------------------------------------------------------------------
create table if not exists public.bot_kv (
  namespace text not null,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (namespace, key)
);

-- ---------------------------------------------------------------------------
-- users: コイン残高。economy-bridge-online.ts が user_id / balance / debt
-- だけを使う（api/app.py の許可列もこの3列）。
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  user_id text primary key,
  balance bigint not null default 0,
  debt bigint not null default 0
);

-- ---------------------------------------------------------------------------
-- transaction_history: 送受金履歴。proposed_transfer_coins.sql の insert 形
-- （sender_id, receiver_id, amount, reason）に合わせる。
-- ---------------------------------------------------------------------------
create table if not exists public.transaction_history (
  id bigserial primary key,
  sender_id text not null,
  receiver_id text not null,
  amount bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- economy_pool_state: 損失還流プール＋国庫。状態は id=1 の1行だけが持つ
-- （economy_pool.sql の定義と同一形）。
-- ---------------------------------------------------------------------------
create table if not exists public.economy_pool_state (
  id smallint primary key default 1 check (id = 1),
  pool bigint not null default 0,
  treasury bigint not null default 0,
  total_recycled bigint not null default 0,
  total_paid bigint not null default 0,
  total_released bigint not null default 0,
  total_boosted bigint not null default 0,
  lottery_boost_pending bigint not null default 0,
  total_house_paid bigint not null default 0,
  last_release_date text,
  updated_at timestamptz not null default now()
);

-- 初期行（seed）。★要調整パラメータ: 原資プールの初期資金。
-- 独立環境は pool=0 だと earn / gamble の払い出しが一切できないため、
-- 当面 1,000,000 で開始し運用で調整する（DESIGN.md の未決定事項）。
-- 既に行があれば何もしない（再実行で残高を巻き戻さない）。
insert into public.economy_pool_state (id, pool, treasury)
values (1, 1000000, 0)
on conflict (id) do nothing;

commit;
