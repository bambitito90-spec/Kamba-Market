CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '•'
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id), category_id TEXT REFERENCES categories(id),
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price NUMERIC(14,2) NOT NULL CHECK (price >= 0), location TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT 'usado', status TEXT NOT NULL DEFAULT 'pending', featured BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT, phone TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'Outros',
  description TEXT NOT NULL DEFAULT '', price_from NUMERIC(14,2) NOT NULL DEFAULT 0, location TEXT NOT NULL DEFAULT '',
  phone TEXT, status TEXT NOT NULL DEFAULT 'pending', featured BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), buyer_id TEXT NOT NULL REFERENCES users(id), seller_id TEXT NOT NULL REFERENCES users(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0), unit_price NUMERIC(14,2) NOT NULL, total NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_payment', payment_method TEXT, payment_id TEXT, affiliate_id TEXT,
  affiliate_commission NUMERIC(14,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id),
  amount NUMERIC(14,2) NOT NULL, method TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  reference TEXT UNIQUE, provider_reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan_id TEXT NOT NULL, status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS affiliates (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), code TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
  commission_rate NUMERIC(8,6) NOT NULL DEFAULT 0.05 CHECK (commission_rate >= 0 AND commission_rate <= 1),
  clicks BIGINT NOT NULL DEFAULT 0, conversions BIGINT NOT NULL DEFAULT 0, earnings NUMERIC(14,2) NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS affiliate_links (
  id TEXT PRIMARY KEY, affiliate_id TEXT NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  clicks BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (affiliate_id, product_id)
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY, affiliate_id TEXT NOT NULL REFERENCES affiliates(id), user_id TEXT NOT NULL REFERENCES users(id), amount NUMERIC(14,2) NOT NULL CHECK (amount >= 5000),
  method TEXT NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested', admin_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ, paid_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, from_user_id TEXT NOT NULL REFERENCES users(id), to_user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, file_name TEXT NOT NULL, url TEXT NOT NULL, bytes BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL, event_id TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL, PRIMARY KEY(provider,event_id)
);

CREATE INDEX IF NOT EXISTS idx_products_status_created ON products(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  ip TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);
