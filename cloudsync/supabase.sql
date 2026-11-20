CREATE TABLE IF NOT EXISTS public.cloudsync_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  username_lower TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  last_fingerprint_id TEXT NOT NULL DEFAULT '',
  last_storage_token TEXT NOT NULL DEFAULT '',
  is_shadowbanned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cloudsync_users ADD COLUMN IF NOT EXISTS last_fingerprint_id TEXT NOT NULL DEFAULT '';
ALTER TABLE public.cloudsync_users ADD COLUMN IF NOT EXISTS last_storage_token TEXT NOT NULL DEFAULT '';
ALTER TABLE public.cloudsync_users ADD COLUMN IF NOT EXISTS is_shadowbanned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.banned_devices (
  id BIGSERIAL PRIMARY KEY,
  fingerprint_id TEXT NOT NULL DEFAULT '',
  storage_token TEXT NOT NULL DEFAULT '',
  banned_username TEXT NOT NULL DEFAULT '',
  banned_reason TEXT NOT NULL DEFAULT '',
  high_confidence_spam BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_banned_devices_fp ON public.banned_devices(fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_banned_devices_token ON public.banned_devices(storage_token);
ALTER TABLE public.banned_devices ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cloudsync_sync (
  user_id BIGINT PRIMARY KEY REFERENCES public.cloudsync_users(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cloudsync_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloudsync_sync ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.stripe_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  checkout_session_id TEXT NOT NULL DEFAULT '',
  invoice_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  email_lower TEXT NOT NULL DEFAULT '',
  user_name_lower TEXT NOT NULL DEFAULT '',
  custom_username_lower TEXT NOT NULL DEFAULT '',
  claimed_username_lower TEXT NOT NULL DEFAULT '',
  price_id TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  tier_name TEXT NOT NULL DEFAULT 'Cookie Master',
  status TEXT NOT NULL DEFAULT 'active',
  managed_payments BOOLEAN NOT NULL DEFAULT TRUE,
  customer_portal_url TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 2,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ NULL
);

ALTER TABLE public.stripe_subscriptions ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS public.app_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;
