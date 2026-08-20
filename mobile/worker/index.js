const API_VERSION = "2026-08-21";
const PAIR_TTL_MS = 10 * 60 * 1000;
const TOKEN_BYTES = 32;
const PAIR_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
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
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS reminders_user_date_idx ON reminders(user_id, date_key)`,
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
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
      if (!env.DB) return json({ error: "Cloud storage is not configured." }, 503);
      try {
        await ensureSchema(env.DB);
        return await handleApi(request, env.DB, url);
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
};

async function handleApi(request, db, url) {
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/health") {
    return json({ ok: true, database: true, version: API_VERSION });
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
    if (!code || !username) return json({ error: "Enter a valid pairing code and username." }, 400);
    const session = await db.prepare("SELECT * FROM pair_sessions WHERE code = ?").bind(code).first();
    if (!session || isExpired(session.expires_at)) return json({ error: "That pairing code expired or does not exist." }, 404);
    if (session.status !== "pending") return json({ error: "That pairing code has already been used." }, 409);
    if (body.secret && !(await safeHashMatch(String(body.secret), session.secret_hash))) return json({ error: "The QR pairing secret is invalid." }, 403);
    const existing = await db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").bind(username).first();
    if (existing) return json({ error: "That username already exists. Use its recovery code instead.", code: "USERNAME_TAKEN" }, 409);

    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const recoveryCode = createRecoveryCode();
    const mobileToken = randomToken(TOKEN_BYTES);
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
      db.prepare("UPDATE pair_sessions SET status = 'paired', user_id = ?, desktop_token = ?, claimed_at = ? WHERE code = ? AND status = 'pending'")
        .bind(userId, desktopToken, now, code),
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
    await db.prepare(`INSERT INTO reminders
      (id, user_id, title, notes, date_key, start_time, end_time, color, repeat_rule, alarm, alarm_minutes, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, notes = excluded.notes, date_key = excluded.date_key,
        start_time = excluded.start_time, end_time = excluded.end_time, color = excluded.color,
        repeat_rule = excluded.repeat_rule, alarm = excluded.alarm, alarm_minutes = excluded.alarm_minutes,
        updated_at = excluded.updated_at, deleted_at = NULL
      WHERE reminders.user_id = excluded.user_id`)
      .bind(
        reminder.id, auth.userId, reminder.title, reminder.notes, reminder.dateKey, reminder.startTime,
        reminder.endTime, reminder.color, reminder.repeat, reminder.alarm ? 1 : 0, reminder.alarmMinutes, reminder.updatedAt,
      ).run();
    return json({ reminder });
  }

  if (reminderMatch && request.method === "DELETE") {
    const id = cleanId(decodeURIComponent(reminderMatch[1]));
    const now = new Date().toISOString();
    await db.prepare("UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
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
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const tokenHash = await sha256(match[1]);
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
    alarmMinutes: Number(row.alarm_minutes || 0), updatedAt: row.updated_at,
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
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validIso(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isExpired(value) { return Date.parse(value) <= Date.now(); }
