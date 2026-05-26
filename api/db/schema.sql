-- TabMargin schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

create table public.notes (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index notes_user_updated_idx
  on public.notes (user_id, updated_at desc)
  where deleted_at is null;

alter table public.notes enable row level security;

create policy "users select own notes"
  on public.notes for select
  using (auth.uid() = user_id);

create policy "users insert own notes"
  on public.notes for insert
  with check (auth.uid() = user_id);

create policy "users update own notes"
  on public.notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users delete own notes"
  on public.notes for delete
  using (auth.uid() = user_id);

-- ----- Subscriptions -----
-- Source of truth is Stripe; this table is a local mirror updated by webhook.
-- Only the service role writes; users only ever read their own row.

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text not null unique,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;

create policy "users select own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);


