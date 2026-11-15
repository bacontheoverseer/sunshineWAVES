CREATE TABLE IF NOT EXISTS public.cloudsync_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  username_lower TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cloudsync_sync (
  user_id BIGINT PRIMARY KEY REFERENCES public.cloudsync_users(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cloudsync_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloudsync_sync ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.kofi_subscriptions (
  transaction_id TEXT PRIMARY KEY,
  email_lower TEXT NOT NULL DEFAULT '',
  from_name_lower TEXT NOT NULL DEFAULT '',
  message_username_lower TEXT NOT NULL DEFAULT '',
  claimed_username_lower TEXT NOT NULL DEFAULT '',
  tier_name TEXT NOT NULL DEFAULT 'Cookie Master',
  amount NUMERIC NOT NULL DEFAULT 2,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.kofi_subscriptions ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS public.app_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;
