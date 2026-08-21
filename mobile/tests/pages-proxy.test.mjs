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
});
