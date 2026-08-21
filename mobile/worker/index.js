import { sendPushNotification, topicFromString, WebPushError } from "@mmmike/web-push/send";

const API_VERSION = "2026-08-21.3";
const PAIR_TTL_MS = 10 * 60 * 1000;
const TOKEN_BYTES = 32;
const PAIR_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const DELIVERY_GRACE_MS = 10 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 3;
const schemaReady = new WeakMap();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    recovery_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices(user_id)`,
  `CREATE TABLE IF NOT EXISTS pair_sessions (
    code TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL,
    desktop_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    user_id TEXT,
    desktop_token TEXT,
    claim_key_hash TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    claimed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS pair_sessions_expires_at_idx ON pair_sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    date_key TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    color TEXT NOT NULL,
    repeat_rule TEXT NOT NULL DEFAULT 'none',
    alarm INTEGER NOT NULL DEFAULT 1,
    alarm_minutes INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    next_fire_at TEXT,
    next_fire_date_key TEXT,
    last_notification_at TEXT,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS reminders_user_date_idx ON reminders(user_id, date_key)`,
  `CREATE INDEX IF NOT EXISTS reminders_next_fire_idx ON reminders(next_fire_at) WHERE alarm = 1 AND deleted_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS completions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    reminder_id TEXT NOT NULL,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    date_key TEXT NOT NULL,
    color TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS completions_user_date_idx ON completions(user_id, date_key)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
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
  )`,
  `CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id, disabled_at)`,
  `CREATE INDEX IF NOT EXISTS push_subscriptions_device_idx ON push_subscriptions(device_id, disabled_at)`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
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
  )`,
  `CREATE INDEX IF NOT EXISTS notification_deliveries_lookup_idx ON notification_deliveries(reminder_id, occurrence_at, status)`,
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
      if (!env.DB) return json({ error: "Cloud storage is not configured." }, 503);
      try {
        await ensureSchema(env.DB);
        return await handleApi(request, env, url);
      } catch (error) {
        console.error("HOVER API error", error);
        return json({ error: "The HOVER cloud could not complete that request." }, 500);
      }
    }

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
  async scheduled(_controller, env, context) {
    if (!env.DB) return;
    context.waitUntil((async () => {
      await ensureSchema(env.DB);
      await dispatchDueReminders(env.DB, env);
    })());
  },
};

async function handleApi(request, env, url) {
  const db = env.DB;
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/health") {
    return json({ ok: true, database: true, push: pushConfigured(env), version: API_VERSION });
  }

  if (request.method === "GET" && pathname === "/api/push/config") {
    return json({
      configured: pushConfigured(env),
      publicKey: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : "",
    });
  }

  if (request.method === "POST" && pathname === "/api/notifications/dispatch") {
    if (!env.SCHEDULER_SECRET || !constantTimeEqual(bearerToken(request), env.SCHEDULER_SECRET)) {
      return json({ error: "Scheduler authorization rejected." }, 403);
    }
    if (!pushConfigured(env)) return json({ error: "Web Push is not configured." }, 503);
    return json(await dispatchDueReminders(db, env));
  }

  if (request.method === "POST" && pathname === "/api/pair/sessions") {
    const body = await readJson(request);
    const desktopName = cleanText(body.desktopName, 80) || "Windows PC";
    const platform = cleanText(body.platform, 24) || "windows";
    const code = await uniquePairCode(db);
    const secret = randomToken(18);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PAIR_TTL_MS).toISOString();
    await db.prepare(
      "INSERT INTO pair_sessions (code, secret_hash, desktop_name, platform, status, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
    ).bind(code, await sha256(secret), desktopName, platform, now.toISOString(), expiresAt).run();
    const pairUrl = new URL("/", url.origin);
    pairUrl.searchParams.set("pair", code);
    pairUrl.searchParams.set("secret", secret);
    return json({ code, secret, pairUrl: pairUrl.toString(), desktopName, expiresAt }, 201);
  }

  if (request.method === "GET" && pathname === "/api/pair/inspect") {
    const code = normalizePairCode(url.searchParams.get("code"));
    const session = code
      ? await db.prepare("SELECT code, desktop_name, platform, status, expires_at FROM pair_sessions WHERE code = ?").bind(code).first()
      : null;
    if (!session || isExpired(session.expires_at)) return json({ error: "That pairing code expired or does not exist." }, 404);
    return json({ code: session.code, desktopName: session.desktop_name, platform: session.platform, status: session.status, expiresAt: session.expires_at });
  }

  const pairStatusMatch = pathname.match(/^\/api\/pair\/sessions\/([A-Z0-9]+)$/);
  if (request.method === "GET" && pairStatusMatch) {
    const code = normalizePairCode(pairStatusMatch[1]);
    const secret = url.searchParams.get("secret") || request.headers.get("x-hover-pair-secret") || "";
    const session = await db.prepare("SELECT * FROM pair_sessions WHERE code = ?").bind(code).first();
    if (!session || isExpired(session.expires_at)) return json({ error: "That pairing session expired." }, 410);
    if (!(await safeHashMatch(secret, session.secret_hash))) return json({ error: "Pairing secret rejected." }, 403);
    if (session.status !== "paired") {
      return json({ status: "pending", code, desktopName: session.desktop_name, expiresAt: session.expires_at }, 202);
    }
    const profile = await db.prepare("SELECT id, username, created_at, updated_at FROM users WHERE id = ?").bind(session.user_id).first();
    return json({ status: "paired", token: session.desktop_token, profile: mapProfile(profile), ...(await readSync(db, session.user_id)) });
  }

  if (request.method === "POST" && pathname === "/api/pair/claim") {
    const body = await readJson(request);
    const code = normalizePairCode(body.code);
    const username = normalizeUsername(body.username);
    const claimKey = normalizeClaimKey(body.claimKey);
    if (!code || !username) return json({ error: "Enter a valid pairing code and username." }, 400);
    const session = await db.prepare("SELECT * FROM pair_sessions WHERE code = ?").bind(code).first();
    if (!session || isExpired(session.expires_at)) return json({ error: "That pairing code expired or does not exist." }, 404);
    if (session.status !== "pending") {
      if (!claimKey || !session.claim_key_hash || !(await safeHashMatch(claimKey, session.claim_key_hash))) {
        return json({ error: "That pairing code has already been used." }, 409);
      }
      const profile = await db.prepare("SELECT id, username, created_at, updated_at FROM users WHERE id = ?").bind(session.user_id).first();
      if (!profile) return json({ error: "That pairing profile is no longer available." }, 410);
      const credentials = await credentialsForPairClaim(code, claimKey);
      return json({
        token: credentials.mobileToken,
        recoveryCode: credentials.recoveryCode,
        desktop: { name: session.desktop_name, platform: session.platform },
        profile: mapProfile(profile),
        ...(await readSync(db, session.user_id)),
      });
    }
    if (body.secret && !(await safeHashMatch(String(body.secret), session.secret_hash))) return json({ error: "The QR pairing secret is invalid." }, 403);
    const existing = await db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
    if (existing) return json({ error: "That username already exists. Use its recovery code instead.", code: "USERNAME_TAKEN" }, 409);

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const credentials = claimKey
      ? await credentialsForPairClaim(code, claimKey)
      : { recoveryCode: createRecoveryCode(), mobileToken: randomToken(TOKEN_BYTES) };
    const { recoveryCode, mobileToken } = credentials;
    const desktopToken = randomToken(TOKEN_BYTES);
    const mobileDeviceId = crypto.randomUUID();
    const desktopDeviceId = crypto.randomUUID();
    const mobileName = cleanText(body.deviceName, 80) || "HOVER phone";
    const mobileKind = ["ios", "android"].includes(body.kind) ? body.kind : "mobile";

    await db.batch([
      db.prepare("INSERT INTO users (id, username, recovery_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(userId, username, await sha256(normalizeRecoveryCode(recoveryCode)), now, now),
      db.prepare("INSERT INTO devices (id, user_id, kind, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(mobileDeviceId, userId, mobileKind, mobileName, await sha256(mobileToken), now, now),
      db.prepare("INSERT INTO devices (id, user_id, kind, name, token_hash, created_at, last_seen) VALUES (?, ?, 'windows', ?, ?, ?, ?)")
        .bind(desktopDeviceId, userId, session.desktop_name, await sha256(desktopToken), now, now),
      db.prepare("UPDATE pair_sessions SET status = 'paired', user_id = ?, desktop_token = ?, claim_key_hash = ?, claimed_at = ? WHERE code = ? AND status = 'pending'")
        .bind(userId, desktopToken, claimKey ? await sha256(claimKey) : null, now, code),
    ]);

    return json({
      token: mobileToken,
      recoveryCode,
      desktop: { name: session.desktop_name, platform: session.platform },
      profile: { id: userId, username, createdAt: now, updatedAt: now },
      reminders: [],
      history: [],
    }, 201);
  }

  if (request.method === "POST" && pathname === "/api/recovery") {
    const body = await readJson(request);
    const recovery = normalizeRecoveryCode(body.recoveryCode);
    if (!recovery) return json({ error: "Enter a valid HOVER recovery code." }, 400);
    const user = await db.prepare("SELECT id, username, created_at, updated_at FROM users WHERE recovery_hash = ?")
      .bind(await sha256(recovery)).first();
    if (!user) return json({ error: "That recovery code was not recognized." }, 404);
    const token = randomToken(TOKEN_BYTES);
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO devices (id, user_id, kind, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        user.id,
        ["ios", "android", "windows"].includes(body.kind) ? body.kind : "mobile",
        cleanText(body.deviceName, 80) || "Recovered HOVER device",
        await sha256(token),
        now,
        now,
      ).run();
    return json({ token, profile: mapProfile(user), ...(await readSync(db, user.id)) });
  }

  const auth = await authenticate(request, db);
  if (!auth) return json({ error: "A paired HOVER device is required." }, 401);

  if (request.method === "GET" && pathname === "/api/push/status") {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM push_subscriptions
      WHERE device_id = ? AND disabled_at IS NULL`).bind(auth.deviceId).first();
    return json({
      configured: pushConfigured(env),
      enabled: Number(row?.count || 0) > 0,
      subscriptions: Number(row?.count || 0),
    });
  }

  if (request.method === "POST" && pathname === "/api/push/subscriptions") {
    if (!pushConfigured(env)) return json({ error: "Web Push is not configured." }, 503);
    const subscription = normalizePushSubscription(await readJson(request));
    if (!subscription) return json({ error: "That push subscription is incomplete or invalid." }, 400);
    const now = new Date().toISOString();
    const existing = await db.prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?").bind(subscription.endpoint).first();
    const id = existing?.id || crypto.randomUUID();
    await db.prepare(`INSERT INTO push_subscriptions
      (id, user_id, device_id, endpoint, p256dh, auth, expiration_time, timezone, user_agent, created_at, updated_at, disabled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id, device_id = excluded.device_id, p256dh = excluded.p256dh,
        auth = excluded.auth, expiration_time = excluded.expiration_time, timezone = excluded.timezone,
        user_agent = excluded.user_agent, updated_at = excluded.updated_at, disabled_at = NULL`)
      .bind(
        id, auth.userId, auth.deviceId, subscription.endpoint, subscription.p256dh, subscription.auth,
        subscription.expirationTime, subscription.timezone, subscription.userAgent, now, now,
      ).run();
    return json({ enabled: true, subscriptionId: id }, existing ? 200 : 201);
  }

  if (request.method === "DELETE" && pathname === "/api/push/subscriptions") {
    const body = await readJson(request);
    const endpoint = cleanEndpoint(body.endpoint);
    const now = new Date().toISOString();
    if (endpoint) {
      await db.prepare("UPDATE push_subscriptions SET disabled_at = ?, updated_at = ? WHERE device_id = ? AND endpoint = ?")
        .bind(now, now, auth.deviceId, endpoint).run();
    } else {
      await db.prepare("UPDATE push_subscriptions SET disabled_at = ?, updated_at = ? WHERE device_id = ? AND disabled_at IS NULL")
        .bind(now, now, auth.deviceId).run();
    }
    return json({ enabled: false });
  }

  if (request.method === "POST" && pathname === "/api/push/test") {
    if (!pushConfigured(env)) return json({ error: "Web Push is not configured." }, 503);
    const rows = await db.prepare("SELECT * FROM push_subscriptions WHERE device_id = ? AND disabled_at IS NULL")
      .bind(auth.deviceId).all();
    if (!(rows.results || []).length) return json({ error: "Enable notifications on this device first." }, 409);
    let delivered = 0;
    for (const subscription of rows.results || []) {
      const result = await deliverPush(env, subscription, {
        title: "HOVER is ready",
        body: "Background reminder notifications are connected to this device.",
        tag: "hover-test",
        url: "/?screen=planner",
        timestamp: Date.now(),
      });
      if (result.delivered) delivered += 1;
      if (result.gone) await disableSubscription(db, subscription.id);
    }
    if (!delivered) return json({ error: "The phone's push service did not accept the test notification." }, 502);
    return json({ delivered });
  }

  if (request.method === "GET" && pathname === "/api/sync") {
    return json({ profile: auth.profile, ...(await readSync(db, auth.userId)) });
  }

  if (request.method === "PATCH" && pathname === "/api/profile") {
    const body = await readJson(request);
    const username = normalizeUsername(body.username);
    if (!username) return json({ error: "Choose a username with 3 to 24 letters, numbers, or underscores." }, 400);
    const existing = await db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ?")
      .bind(username, auth.userId).first();
    if (existing) return json({ error: "That username already exists.", code: "USERNAME_TAKEN" }, 409);
    const updatedAt = new Date().toISOString();
    await db.prepare("UPDATE users SET username = ?, updated_at = ? WHERE id = ?")
      .bind(username, updatedAt, auth.userId).run();
    return json({ profile: { ...auth.profile, username, updatedAt } });
  }

  const reminderMatch = pathname.match(/^\/api\/reminders\/([^/]+)$/);
  if (reminderMatch && request.method === "PUT") {
    const id = cleanId(decodeURIComponent(reminderMatch[1]));
    const reminder = normalizeReminder(await readJson(request), id);
    if (!reminder) return json({ error: "That reminder is incomplete or invalid." }, 400);
    const schedule = nextReminderSchedule(reminder);
    await db.prepare(`INSERT INTO reminders
      (id, user_id, title, notes, date_key, start_time, end_time, color, repeat_rule, alarm, alarm_minutes,
       timezone, next_fire_at, next_fire_date_key, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, notes = excluded.notes, date_key = excluded.date_key,
        start_time = excluded.start_time, end_time = excluded.end_time, color = excluded.color,
        repeat_rule = excluded.repeat_rule, alarm = excluded.alarm, alarm_minutes = excluded.alarm_minutes,
        timezone = excluded.timezone, next_fire_at = excluded.next_fire_at,
        next_fire_date_key = excluded.next_fire_date_key, updated_at = excluded.updated_at, deleted_at = NULL
      WHERE reminders.user_id = excluded.user_id`)
      .bind(
        reminder.id, auth.userId, reminder.title, reminder.notes, reminder.dateKey, reminder.startTime,
        reminder.endTime, reminder.color, reminder.repeat, reminder.alarm ? 1 : 0, reminder.alarmMinutes,
        reminder.timezone, schedule?.fireAt || null, schedule?.dateKey || null, reminder.updatedAt,
      ).run();
    return json({ reminder: { ...reminder, nextFireAt: schedule?.fireAt || null } });
  }

  if (reminderMatch && request.method === "DELETE") {
    const id = cleanId(decodeURIComponent(reminderMatch[1]));
    const now = new Date().toISOString();
    await db.prepare("UPDATE reminders SET deleted_at = ?, next_fire_at = NULL, next_fire_date_key = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(now, now, id, auth.userId).run();
    return json({ deleted: true, id });
  }

  if (request.method === "POST" && pathname === "/api/completions") {
    const completion = normalizeCompletion(await readJson(request));
    if (!completion) return json({ error: "That completion record is invalid." }, 400);
    await db.prepare(`INSERT INTO completions
      (id, user_id, reminder_id, title, start_time, date_key, color, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, start_time = excluded.start_time, date_key = excluded.date_key,
        color = excluded.color, completed_at = excluded.completed_at
      WHERE completions.user_id = excluded.user_id`)
      .bind(
        completion.id, auth.userId, completion.reminderId, completion.title, completion.startTime,
        completion.dateKey, completion.color, completion.completedAt,
      ).run();
    const scheduledReminder = await db.prepare("SELECT * FROM reminders WHERE id = ? AND user_id = ?")
      .bind(completion.reminderId, auth.userId).first();
    if (scheduledReminder?.next_fire_date_key === completion.dateKey) {
      await advanceReminderSchedule(db, scheduledReminder, new Date().toISOString());
    }
    return json({ completion });
  }

  const completionMatch = pathname.match(/^\/api\/completions\/([^/]+)$/);
  if (completionMatch && request.method === "DELETE") {
    const id = cleanId(decodeURIComponent(completionMatch[1]));
    await db.prepare("DELETE FROM completions WHERE id = ? AND user_id = ?").bind(id, auth.userId).run();
    return json({ deleted: true, id });
  }

  return json({ error: "HOVER API route not found." }, 404);
}

async function ensureSchema(db) {
  if (!schemaReady.has(db)) {
    schemaReady.set(db, db.batch(SCHEMA.map((statement) => db.prepare(statement))).catch((error) => {
      schemaReady.delete(db);
      throw error;
    }));
  }
  return schemaReady.get(db);
}

async function authenticate(request, db) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await db.prepare(`SELECT d.id AS device_id, d.user_id, u.username, u.created_at, u.updated_at
    FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?`).bind(tokenHash).first();
  if (!row) return null;
  await db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").bind(new Date().toISOString(), row.device_id).run();
  return { userId: row.user_id, deviceId: row.device_id, profile: mapProfile({ id: row.user_id, ...row }) };
}

async function readSync(db, userId) {
  const reminderRows = await db.prepare("SELECT * FROM reminders WHERE user_id = ? AND deleted_at IS NULL ORDER BY date_key, start_time")
    .bind(userId).all();
  const deletedRows = await db.prepare("SELECT id FROM reminders WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY updated_at DESC LIMIT 500")
    .bind(userId).all();
  const completionRows = await db.prepare("SELECT * FROM completions WHERE user_id = ? ORDER BY completed_at DESC LIMIT 730")
    .bind(userId).all();
  return {
    reminders: (reminderRows.results || []).map(mapReminder),
    deletedReminderIds: (deletedRows.results || []).map((row) => row.id),
    history: (completionRows.results || []).map(mapCompletion),
  };
}

function mapProfile(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapReminder(row) {
  return {
    id: row.id, title: row.title, notes: row.notes, dateKey: row.date_key, startTime: row.start_time,
    endTime: row.end_time, color: row.color, repeat: row.repeat_rule, alarm: Boolean(row.alarm),
    alarmMinutes: Number(row.alarm_minutes || 0), timezone: row.timezone || "UTC",
    nextFireAt: row.next_fire_at || null, updatedAt: row.updated_at,
  };
}

function mapCompletion(row) {
  return {
    id: row.id, reminderId: row.reminder_id, title: row.title, startTime: row.start_time,
    dateKey: row.date_key, color: row.color, completedAt: row.completed_at,
  };
}

function normalizeReminder(body, id) {
  const title = cleanText(body.title, 160);
  const date = String(body.dateKey || body.date || "");
  const start = String(body.startTime || body.start || "");
  const end = String(body.endTime || body.end || "");
  if (!id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !validTime(start) || !validTime(end)) return null;
  return {
    id, title, notes: cleanText(body.notes, 1000), dateKey: date, startTime: start, endTime: end,
    color: cleanText(body.color, 24) || "sky", repeat: ["none", "daily"].includes(body.repeat) ? body.repeat : "none",
    alarm: body.alarm !== false, alarmMinutes: Math.max(0, Math.min(1440, Number(body.alarmMinutes) || 0)),
    timezone: validTimeZone(body.timezone) ? String(body.timezone) : "UTC",
    updatedAt: validIso(body.updatedAt) ? body.updatedAt : new Date().toISOString(),
  };
}

function normalizeCompletion(body) {
  const reminderId = cleanId(body.reminderId);
  const date = String(body.dateKey || body.date || "");
  const id = cleanId(body.id || `${reminderId}:${date}`);
  const title = cleanText(body.title, 160);
  const startTime = String(body.startTime || body.start || "");
  if (!id || !reminderId || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !validTime(startTime)) return null;
  return {
    id, reminderId, title, startTime, dateKey: date, color: cleanText(body.color, 24) || "sky",
    completedAt: validIso(body.completedAt) ? body.completedAt : new Date().toISOString(),
  };
}

function pushConfigured(env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

function normalizePushSubscription(body) {
  const value = body && typeof body.subscription === "object" ? body.subscription : body;
  const endpoint = cleanEndpoint(value?.endpoint);
  const p256dh = String(value?.keys?.p256dh || "");
  const auth = String(value?.keys?.auth || "");
  if (!endpoint || !validBase64Url(p256dh, 80, 120) || !validBase64Url(auth, 16, 40)) return null;
  const expiration = value.expirationTime;
  return {
    endpoint,
    p256dh,
    auth,
    expirationTime: expiration && !Number.isNaN(Number(expiration)) ? new Date(Number(expiration)).toISOString() : null,
    timezone: validTimeZone(body.timezone) ? String(body.timezone) : "UTC",
    userAgent: cleanText(body.userAgent, 240),
  };
}

async function deliverPush(env, subscription, payload) {
  try {
    const delivered = await sendPushNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      { title: payload.title, body: payload.body, url: payload.url, tag: payload.tag },
      {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT,
      },
      {
        ttl: 24 * 60 * 60,
        urgency: "high",
        topic: await topicFromString(payload.tag || "hover-reminder"),
        timeoutMs: 8_000,
      },
    );
    return { delivered, gone: !delivered, status: delivered ? 201 : 410, error: "" };
  } catch (error) {
    const status = error instanceof WebPushError ? Number(error.statusCode || 0) : 0;
    return {
      delivered: false,
      gone: status === 404 || status === 410,
      status,
      error: cleanText(error instanceof Error ? error.message : "Push delivery failed", 240),
    };
  }
}

async function dispatchDueReminders(db, env, now = new Date()) {
  const nowIso = now.toISOString();
  const due = await db.prepare(`SELECT * FROM reminders
    WHERE alarm = 1 AND deleted_at IS NULL AND next_fire_at IS NOT NULL AND next_fire_at <= ?
    ORDER BY next_fire_at LIMIT 50`).bind(nowIso).all();
  const summary = { scanned: 0, delivered: 0, disabled: 0, waiting: 0, advanced: 0, failed: 0 };

  for (const reminder of due.results || []) {
    summary.scanned += 1;
    const occurrenceAt = reminder.next_fire_at;
    const completed = await db.prepare(`SELECT id FROM completions
      WHERE user_id = ? AND reminder_id = ? AND date_key = ? LIMIT 1`)
      .bind(reminder.user_id, reminder.id, reminder.next_fire_date_key).first();
    if (completed) {
      await advanceReminderSchedule(db, reminder, nowIso);
      summary.advanced += 1;
      continue;
    }

    const subscriptions = await db.prepare(`SELECT * FROM push_subscriptions
      WHERE user_id = ? AND disabled_at IS NULL ORDER BY created_at`).bind(reminder.user_id).all();
    const late = now.getTime() - Date.parse(occurrenceAt) > DELIVERY_GRACE_MS;
    if (!(subscriptions.results || []).length) {
      if (late) {
        await advanceReminderSchedule(db, reminder, nowIso);
        summary.advanced += 1;
      } else {
        summary.waiting += 1;
      }
      continue;
    }

    let unsettled = false;
    for (const subscription of subscriptions.results || []) {
      const deliveryId = await sha256(`${reminder.id}\n${subscription.id}\n${occurrenceAt}`);
      let delivery = await db.prepare("SELECT * FROM notification_deliveries WHERE id = ?").bind(deliveryId).first();
      if (!delivery) {
        await db.prepare(`INSERT OR IGNORE INTO notification_deliveries
          (id, user_id, reminder_id, subscription_id, occurrence_at, status, attempt_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`)
          .bind(deliveryId, reminder.user_id, reminder.id, subscription.id, occurrenceAt, nowIso, nowIso).run();
        delivery = { attempt_count: 0, status: "pending" };
      }
      if (delivery.status === "sent" || Number(delivery.attempt_count || 0) >= MAX_DELIVERY_ATTEMPTS) continue;

      const result = await deliverPush(env, subscription, {
        title: reminder.alarm_minutes
          ? `In ${reminder.alarm_minutes} min · ${reminder.title}`
          : reminder.title,
        body: reminder.notes || `Scheduled for ${reminder.start_time}`,
        tag: `hover-${reminder.id}-${reminder.next_fire_date_key}`,
        url: `/?screen=planner&date=${encodeURIComponent(reminder.next_fire_date_key || reminder.date_key)}`,
      });
      const attempts = Number(delivery.attempt_count || 0) + 1;
      const status = result.delivered ? "sent" : result.gone ? "gone" : "failed";
      await db.prepare(`UPDATE notification_deliveries SET
        status = ?, attempt_count = ?, response_status = ?, last_error = ?, updated_at = ?, sent_at = ? WHERE id = ?`)
        .bind(status, attempts, result.status || null, result.error || null, nowIso, result.delivered ? nowIso : null, deliveryId).run();
      if (result.delivered) summary.delivered += 1;
      if (result.gone) {
        await disableSubscription(db, subscription.id, nowIso);
        summary.disabled += 1;
      } else if (!result.delivered && attempts < MAX_DELIVERY_ATTEMPTS && !late) {
        unsettled = true;
        summary.failed += 1;
      }
    }

    if (!unsettled || late) {
      await advanceReminderSchedule(db, reminder, nowIso);
      summary.advanced += 1;
    } else {
      summary.waiting += 1;
    }
  }

  return summary;
}

async function disableSubscription(db, subscriptionId, timestamp = new Date().toISOString()) {
  await db.prepare("UPDATE push_subscriptions SET disabled_at = ?, updated_at = ? WHERE id = ?")
    .bind(timestamp, timestamp, subscriptionId).run();
}

async function advanceReminderSchedule(db, reminder, timestamp) {
  if (reminder.repeat_rule !== "daily") {
    await db.prepare(`UPDATE reminders SET next_fire_at = NULL, next_fire_date_key = NULL,
      last_notification_at = ? WHERE id = ?`).bind(timestamp, reminder.id).run();
    return;
  }
  const nextDateKey = addDateKey(reminder.next_fire_date_key || reminder.date_key, 1);
  const fireAt = reminderFireAt({
    dateKey: nextDateKey,
    startTime: reminder.start_time,
    alarmMinutes: Number(reminder.alarm_minutes || 0),
    timezone: reminder.timezone || "UTC",
  }, nextDateKey).toISOString();
  await db.prepare(`UPDATE reminders SET next_fire_at = ?, next_fire_date_key = ?,
    last_notification_at = ? WHERE id = ?`).bind(fireAt, nextDateKey, timestamp, reminder.id).run();
}

function nextReminderSchedule(reminder, now = new Date()) {
  if (!reminder.alarm) return null;
  let candidateDate = reminder.dateKey;
  if (reminder.repeat === "daily") {
    const localToday = dateKeyInTimeZone(now, reminder.timezone);
    if (candidateDate < localToday) candidateDate = localToday;
  }
  let fireAt = reminderFireAt(reminder, candidateDate);
  if (reminder.repeat === "daily") {
    while (fireAt.getTime() < now.getTime() - 60_000) {
      candidateDate = addDateKey(candidateDate, 1);
      fireAt = reminderFireAt(reminder, candidateDate);
    }
  } else if (fireAt.getTime() < now.getTime() - DELIVERY_GRACE_MS) {
    return null;
  }
  return { fireAt: fireAt.toISOString(), dateKey: candidateDate };
}

function reminderFireAt(reminder, dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = reminder.startTime.split(":").map(Number);
  const adjusted = new Date(Date.UTC(year, month - 1, day, hour, minute - Number(reminder.alarmMinutes || 0)));
  const adjustedDate = adjusted.toISOString().slice(0, 10);
  const adjustedTime = adjusted.toISOString().slice(11, 16);
  return zonedLocalToUtc(adjustedDate, adjustedTime, reminder.timezone);
}

function zonedLocalToUtc(dateKey, time, timezone) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    );
    const difference = desired - represented;
    guess += difference;
    if (!difference) break;
  }
  return new Date(guess);
}

function dateKeyInTimeZone(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDateKey(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

async function uniquePairCode(db) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = Array.from({ length: 6 }, () => PAIR_ALPHABET[randomNumber(PAIR_ALPHABET.length)]).join("");
    const existing = await db.prepare("SELECT code FROM pair_sessions WHERE code = ?").bind(code).first();
    if (!existing) return code;
  }
  throw new Error("Could not allocate a pairing code");
}

function createRecoveryCode() {
  const group = () => Array.from({ length: 4 }, () => PAIR_ALPHABET[randomNumber(PAIR_ALPHABET.length)]).join("");
  return `HVR-${group()}-${group()}-${group()}`;
}

async function credentialsForPairClaim(code, claimKey) {
  const mobileBytes = await sha256Bytes(`hover-mobile-token\n${code}\n${claimKey}`);
  const recoveryBytes = await sha256Bytes(`hover-recovery-code\n${code}\n${claimKey}`);
  const recoveryCharacters = Array.from(recoveryBytes.slice(0, 12), (value) => PAIR_ALPHABET[value % PAIR_ALPHABET.length]);
  return {
    mobileToken: bytesToBase64Url(mobileBytes),
    recoveryCode: `HVR-${recoveryCharacters.slice(0, 4).join("")}-${recoveryCharacters.slice(4, 8).join("")}-${recoveryCharacters.slice(8, 12).join("")}`,
  };
}

function randomToken(bytes) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return btoa(String.fromCharCode(...values)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomNumber(max) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % max;
}

async function sha256(value) {
  return Array.from(await sha256Bytes(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value) {
  const bytes = new TextEncoder().encode(String(value));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function bytesToBase64Url(values) {
  return btoa(String.fromCharCode(...values)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function safeHashMatch(value, expectedHash) {
  const actual = await sha256(value);
  if (actual.length !== expectedHash.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  return difference === 0;
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) return {};
  try { return await request.json(); } catch { return {}; }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, x-hover-pair-secret",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "x-content-type-options": "nosniff",
  };
}

function normalizeUsername(value) {
  const normalized = String(value || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  return normalized.length >= 3 ? normalized : "";
}

function normalizePairCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function normalizeClaimKey(value) {
  const normalized = String(value || "");
  return validBase64Url(normalized, 43, 43) ? normalized : "";
}

function normalizeRecoveryCode(value) {
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^HVR[A-Z0-9]{12}$/.test(normalized) ? normalized : "";
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function cleanId(value) {
  const id = String(value || "").trim().slice(0, 180);
  return /^[a-zA-Z0-9:_-]+$/.test(id) ? id : "";
}

function cleanEndpoint(value) {
  const endpoint = String(value || "").trim().slice(0, 2048);
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function validBase64Url(value, minimum, maximum) {
  return value.length >= minimum && value.length <= maximum && /^[A-Za-z0-9_-]+$/.test(value);
}

function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function bearerToken(request) {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || "";
}

function constantTimeEqual(left, right) {
  const first = String(left || "");
  const second = String(right || "");
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validIso(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isExpired(value) { return Date.parse(value) <= Date.now(); }
