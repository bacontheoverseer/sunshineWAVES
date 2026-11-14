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
