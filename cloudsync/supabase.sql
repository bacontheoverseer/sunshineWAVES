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

CREATE TABLE IF NOT EXISTS public.lemonsqueezy_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  license_key TEXT NOT NULL DEFAULT '',
  email_lower TEXT NOT NULL DEFAULT '',
  user_name_lower TEXT NOT NULL DEFAULT '',
  custom_username_lower TEXT NOT NULL DEFAULT '',
  claimed_username_lower TEXT NOT NULL DEFAULT '',
  variant_id TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  tier_name TEXT NOT NULL DEFAULT 'Cookie Master',
  status TEXT NOT NULL DEFAULT 'active',
  customer_portal_url TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 2,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ NULL
);

ALTER TABLE public.lemonsqueezy_subscriptions ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS public.app_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;
