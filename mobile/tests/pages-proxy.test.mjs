import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker/pages-proxy.js";

const upstreamOrigin = "https://hover-cloud.example.test";

test("neutral Pages origin rewrites pairing links while preserving the cloud session", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let upstreamRequest;
  globalThis.fetch = async (input) => {
    upstreamRequest = input;
    return Response.json({
      code: "HVR7K2",
      secret: "pair-secret",
      pairUrl: `${upstreamOrigin}/?pair=HVR7K2&secret=pair-secret`,
    });
  };

  const response = await worker.fetch(
    new Request("https://hover-reminder.pages.dev/api/pair/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "ios" }),
    }),
    { HOVER_CLOUD_ORIGIN: upstreamOrigin, ASSETS: { fetch: () => new Response("asset") } },
  );
  const payload = await response.json();

  assert.equal(new URL(String(upstreamRequest)).origin, upstreamOrigin);
  assert.equal(payload.pairUrl, "https://hover-reminder.pages.dev/?pair=HVR7K2&secret=pair-secret");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("static HOVER assets receive standalone-app security headers", async () => {
  const response = await worker.fetch(
    new Request("https://hover-reminder.pages.dev/"),
    { ASSETS: { fetch: () => new Response("HOVER", { headers: { "content-type": "text/html" } }) } },
  );

  assert.equal(await response.text(), "HOVER");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy"), /worker-src 'self' blob:/);
});

test("iPhone JSON writes are buffered before forwarding and returning", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_input, init) => {
    assert.ok(init.body instanceof ArrayBuffer);
    assert.equal(new Headers(init.headers).has("content-length"), false);
    const body = JSON.parse(new TextDecoder().decode(init.body));
    assert.equal(body.username, "phone_user");
    return Response.json({ profile: { username: body.username }, token: "phone-token" }, { status: 201 });
  };

  const response = await worker.fetch(
    new Request("https://hover-reminder.pages.dev/api/pair/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mobile Safari" },
      body: JSON.stringify({ code: "ABC123", username: "phone_user" }),
    }),
    { HOVER_CLOUD_ORIGIN: upstreamOrigin, ASSETS: { fetch: () => new Response("asset") } },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { profile: { username: "phone_user" }, token: "phone-token" });
});
