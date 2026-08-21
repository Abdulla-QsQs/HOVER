import assert from "node:assert/strict";
import test from "node:test";
import scheduler from "../src/index.js";

const env = {
  HOVER_API_URL: "https://hover.example.test",
  SCHEDULER_SECRET: "scheduler-secret-for-tests",
};

test("exposes health without exposing the dispatch secret", async () => {
  const response = await scheduler.fetch(new Request("https://scheduler.test/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, schedule: "every minute" });
});

test("protects manual dispatch and forwards only the server secret", async () => {
  const rejected = await scheduler.fetch(new Request("https://scheduler.test/dispatch", { method: "POST" }), env);
  assert.equal(rejected.status, 403);

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (request, init) => {
    calls += 1;
    assert.equal(String(request), "https://hover.example.test/api/notifications/dispatch");
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${env.SCHEDULER_SECRET}`);
    return Response.json({ delivered: 1 });
  };
  try {
    const response = await scheduler.fetch(new Request("https://scheduler.test/dispatch", {
      method: "POST",
      headers: { authorization: `Bearer ${env.SCHEDULER_SECRET}` },
    }), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { delivered: 1 });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runs the same protected dispatch from the minute trigger", async () => {
  const originalFetch = globalThis.fetch;
  let waitPromise;
  globalThis.fetch = async () => Response.json({ delivered: 0 });
  try {
    await scheduler.scheduled({}, env, { waitUntil: (promise) => { waitPromise = promise; } });
    await waitPromise;
  } finally {
    globalThis.fetch = originalFetch;
  }
});
