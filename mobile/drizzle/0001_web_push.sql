ALTER TABLE reminders ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE reminders ADD COLUMN next_fire_at TEXT;
ALTER TABLE reminders ADD COLUMN next_fire_date_key TEXT;
ALTER TABLE reminders ADD COLUMN last_notification_at TEXT;

CREATE INDEX IF NOT EXISTS reminders_next_fire_idx
ON reminders(next_fire_at)
WHERE alarm = 1 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx
ON push_subscriptions(user_id, disabled_at);

CREATE INDEX IF NOT EXISTS push_subscriptions_device_idx
ON push_subscriptions(device_id, disabled_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  occurrence_at TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  UNIQUE (reminder_id, subscription_id, occurrence_at)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_lookup_idx
ON notification_deliveries(reminder_id, occurrence_at, status);

PRAGMA optimize;
