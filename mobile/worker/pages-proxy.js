export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return proxyCloudRequest(request, url, env.HOVER_CLOUD_ORIGIN);
    }

    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.method === "GET" && request.headers.get("accept")?.includes("text/html")) {
      response = await env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
    }

    return withSecurityHeaders(response);
  },
};

const MAX_API_BODY_BYTES = 64 * 1024;

async function proxyCloudRequest(request, publicUrl, configuredOrigin) {
  const cloudOrigin = secureOrigin(configuredOrigin);
  if (!cloudOrigin) return json({ error: "HOVER cloud is not configured." }, 503);
  const upstreamUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, cloudOrigin);
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("host");
  headers.delete("origin");
  headers.delete("referer");
  headers.delete("content-length");
  headers.delete("connection");
  headers.delete("transfer-encoding");
  headers.delete("accept-encoding");

  let response;
  let responseBody;
  try {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > MAX_API_BODY_BYTES) return json({ error: "That HOVER request is too large." }, 413);
    response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
    });
    responseBody = await response.arrayBuffer();
  } catch {
    return json({ error: "HOVER cloud is temporarily unavailable." }, 502);
  }

  if (request.method === "POST" && publicUrl.pathname === "/api/pair/sessions" && response.ok) {
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(responseBody));
    } catch {
      return json({ error: "HOVER cloud returned an invalid pairing response." }, 502);
    }
    if (typeof payload.pairUrl === "string") {
      const pairUrl = new URL(payload.pairUrl);
      payload.pairUrl = `${publicUrl.origin}${pairUrl.pathname}${pairUrl.search}`;
    }
    return json(payload, response.status);
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("set-cookie");
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(responseBody, { status: response.status, statusText: response.statusText, headers: responseHeaders });
}

function secureOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; manifest-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.set("permissions-policy", "camera=(self), microphone=(), geolocation=()");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
