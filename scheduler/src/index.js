const DISPATCH_PATH = "/api/notifications/dispatch";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, schedule: "every minute" });
    }
    if (request.method === "POST" && url.pathname === "/dispatch") {
      if (!env.SCHEDULER_SECRET || !constantTimeEqual(bearerToken(request), env.SCHEDULER_SECRET)) {
        return Response.json({ error: "Authorization rejected." }, { status: 403 });
      }
      return dispatch(env);
    }
    return Response.json({ error: "Not found." }, { status: 404 });
  },

  async scheduled(_controller, env, context) {
    context.waitUntil(dispatch(env).then((response) => {
      if (!response.ok) throw new Error(`HOVER dispatch returned ${response.status}`);
    }));
  },
};

async function dispatch(env) {
  if (!env.HOVER_API_URL || !env.SCHEDULER_SECRET) {
    return Response.json({ error: "Scheduler configuration is incomplete." }, { status: 503 });
  }
  const response = await fetch(new URL(DISPATCH_PATH, env.HOVER_API_URL), {
    method: "POST",
    headers: { authorization: `Bearer ${env.SCHEDULER_SECRET}` },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") || "application/json; charset=utf-8" },
  });
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
