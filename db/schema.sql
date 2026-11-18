begin;

create table if not exists public.bot_kv (
  namespace text not null,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (namespace, key)
);

create table if not exists public.users (
  user_id text primary key,
  balance bigint not null default 0,
  debt bigint not null default 0
);

create table if not exists public.transaction_history (
  id bigserial primary key,
  sender_id text not null,
  receiver_id text not null,
  amount bigint not null,
  reason text not null,
  created_at timestamptz not null default now()
);

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

insert into public.economy_pool_state (id, pool, treasury)
values (1, 1000000, 0)
on conflict (id) do nothing;

commit;
