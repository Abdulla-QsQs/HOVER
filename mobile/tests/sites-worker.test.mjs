import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import worker from "../worker/index.js";

class LocalD1Statement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new LocalD1Statement(this.database, this.sql, values);
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }

  async first(column) {
    const row = this.database.prepare(this.sql).get(...this.values) || null;
    return column && row ? row[column] : row;
  }

  async all() {
    return { success: true, results: this.database.prepare(this.sql).all(...this.values) };
  }
}

class LocalD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql) {
    return new LocalD1Statement(this.database, sql);
  }

  async batch(statements) {
    const output = [];
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) output.push(await statement.run());
      this.database.exec("COMMIT");
      return output;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function makeEnv() {
  return {
    DB: new LocalD1(),
    ASSETS: {
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        return new Response(pathname === "/index.html" ? "app" : "missing", {
          status: pathname === "/index.html" ? 200 : 404,
        });
      },
    },
  };
}

async function api(env, pathname, { method = "GET", body, token, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (token) requestHeaders.set("authorization", `Bearer ${token}`);
  const response = await worker.fetch(new Request(`https://hover.test${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { response, data: response.status === 204 ? null : await response.json() };
}

test("serves assets and app routes without swallowing write requests", async () => {
  const env = makeEnv();
  const asset = await worker.fetch(new Request("https://hover.test/assets/app.js"), env);
  assert.equal(asset.status, 404);

  const route = await worker.fetch(new Request("https://hover.test/planner", { headers: { accept: "text/html" } }), env);
  assert.equal(route.status, 200);
  assert.equal(await route.text(), "app");

  const write = await worker.fetch(new Request("https://hover.test/planner", { method: "POST", headers: { accept: "text/html" } }), env);
  assert.equal(write.status, 404);
});

test("health endpoint initializes the D1 schema and returns CORS headers", async () => {
  const env = makeEnv();
  const { response, data } = await api(env, "/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(data, { ok: true, database: true, version: "2026-08-21" });

  const options = await worker.fetch(new Request("https://hover.test/api/sync", { method: "OPTIONS" }), env);
  assert.equal(options.status, 204);
});

test("QR pairing issues separate mobile and desktop tokens and syncs reminders", async () => {
  const env = makeEnv();
  const created = await api(env, "/api/pair/sessions", {
    method: "POST",
    body: { desktopName: "QA-LAPTOP", platform: "windows" },
  });
  assert.equal(created.response.status, 201);
  assert.match(created.data.code, /^[A-Z0-9]{6}$/);
  assert.match(created.data.pairUrl, new RegExp(`pair=${created.data.code}`));

  const inspected = await api(env, `/api/pair/inspect?code=${created.data.code}`);
  assert.equal(inspected.data.desktopName, "QA-LAPTOP");
  assert.equal(inspected.data.status, "pending");

  const wrongSecret = await api(env, `/api/pair/sessions/${created.data.code}?secret=wrong`);
  assert.equal(wrongSecret.response.status, 403);
  const pending = await api(env, `/api/pair/sessions/${created.data.code}?secret=${encodeURIComponent(created.data.secret)}`);
  assert.equal(pending.response.status, 202);
  assert.equal(pending.data.status, "pending");

  const claimed = await api(env, "/api/pair/claim", {
    method: "POST",
    body: {
      code: created.data.code,
      secret: created.data.secret,
      username: "qa_hover",
      kind: "ios",
      deviceName: "QA iPhone",
    },
  });
  assert.equal(claimed.response.status, 201);
  assert.match(claimed.data.recoveryCode, /^HVR-(?:[A-Z0-9]{4}-){2}[A-Z0-9]{4}$/);
  assert.equal(claimed.data.profile.username, "qa_hover");

  const paired = await api(env, `/api/pair/sessions/${created.data.code}?secret=${encodeURIComponent(created.data.secret)}`);
  assert.equal(paired.response.status, 200);
  assert.equal(paired.data.status, "paired");
  assert.notEqual(paired.data.token, claimed.data.token);

  const reminder = {
    id: "release-check",
    title: "Verify HOVER release",
    notes: "Desktop and phone should agree",
    dateKey: "2026-08-21",
    startTime: "15:00",
    endTime: "15:45",
    color: "violet",
    repeat: "none",
    alarm: true,
    alarmMinutes: 10,
    updatedAt: "2026-08-21T10:00:00.000Z",
  };
  const saved = await api(env, "/api/reminders/release-check", { method: "PUT", body: reminder, token: claimed.data.token });
  assert.equal(saved.response.status, 200);

  const syncedDesktop = await api(env, "/api/sync", { token: paired.data.token });
  assert.equal(syncedDesktop.response.status, 200);
  assert.deepEqual(syncedDesktop.data.reminders, [reminder]);

  const renamed = await api(env, "/api/profile", {
    method: "PATCH",
    token: claimed.data.token,
    body: { username: "qa_hover_renamed" },
  });
  assert.equal(renamed.response.status, 200);
  assert.equal(renamed.data.profile.username, "qa_hover_renamed");

  const completion = {
    id: "release-check:2026-08-21",
    reminderId: "release-check",
    title: reminder.title,
    startTime: reminder.startTime,
    dateKey: reminder.dateKey,
    color: reminder.color,
    completedAt: "2026-08-21T15:45:00.000Z",
  };
  const completed = await api(env, "/api/completions", { method: "POST", body: completion, token: paired.data.token });
  assert.equal(completed.response.status, 200);
  const syncedMobile = await api(env, "/api/sync", { token: claimed.data.token });
  assert.deepEqual(syncedMobile.data.history, [completion]);

  const recovered = await api(env, "/api/recovery", {
    method: "POST",
    body: { recoveryCode: claimed.data.recoveryCode, kind: "android", deviceName: "QA Pixel" },
  });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.data.profile.username, "qa_hover_renamed");
  assert.equal(recovered.data.reminders.length, 1);

  const reused = await api(env, "/api/pair/claim", {
    method: "POST",
    body: { code: created.data.code, username: "another_user" },
  });
  assert.equal(reused.response.status, 409);

  await api(env, "/api/completions/release-check%3A2026-08-21", { method: "DELETE", token: claimed.data.token });
  await api(env, "/api/reminders/release-check", { method: "DELETE", token: claimed.data.token });
  const empty = await api(env, "/api/sync", { token: paired.data.token });
  assert.deepEqual(empty.data.reminders, []);
  assert.deepEqual(empty.data.history, []);
});

test("rejects unauthenticated sync and duplicate usernames", async () => {
  const env = makeEnv();
  const unauthorized = await api(env, "/api/sync");
  assert.equal(unauthorized.response.status, 401);

  const first = await api(env, "/api/pair/sessions", { method: "POST", body: { desktopName: "ONE" } });
  const firstClaim = await api(env, "/api/pair/claim", {
    method: "POST",
    body: { code: first.data.code, username: "one_user" },
  });
  assert.equal(firstClaim.response.status, 201);

  const second = await api(env, "/api/pair/sessions", { method: "POST", body: { desktopName: "TWO" } });
  const duplicate = await api(env, "/api/pair/claim", {
    method: "POST",
    body: { code: second.data.code, username: "ONE_USER" },
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.data.code, "USERNAME_TAKEN");
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
  await access(new URL("../dist/.openai/drizzle/0000_hover_cloud.sql", import.meta.url));
  const hosting = JSON.parse(await readFile(new URL("../dist/.openai/hosting.json", import.meta.url), "utf8"));
  assert.equal(hosting.d1, "DB");
});
