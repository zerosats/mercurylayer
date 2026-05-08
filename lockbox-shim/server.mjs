import http from "node:http";

const port = Number.parseInt(process.env.LOCKBOX_SHIM_PORT || process.env.PORT || "18080", 10);
const realLockboxUrl = (process.env.REAL_LOCKBOX_URL || "http://lockbox-real:18081").replace(/\/$/, "");

const splitChildren = new Map();

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function proxyHeaders(headers) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (lowerName === "host" || lowerName === "connection" || lowerName === "content-length") {
      continue;
    }
    forwarded[name] = value;
  }
  return forwarded;
}

async function proxyRequest(req, res, body) {
  const target = `${realLockboxUrl}${req.url}`;
  const response = await fetch(target, {
    method: req.method,
    headers: proxyHeaders(req.headers),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    redirect: "manual",
  });

  const responseBody = Buffer.from(await response.arrayBuffer());
  const headers = {};
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "transfer-encoding") {
      headers[name] = value;
    }
  });
  headers["content-length"] = responseBody.length;
  res.writeHead(response.status, headers);
  res.end(responseBody);
}

async function postRealJson(path, payload) {
  const response = await fetch(`${realLockboxUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Real lockbox returned HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) : {};
}

async function deleteReal(path) {
  const response = await fetch(`${realLockboxUrl}${path}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(text || `Real lockbox returned HTTP ${response.status}`);
  }
}

function parseJsonBody(body) {
  if (body.length === 0) {
    return null;
  }
  return JSON.parse(body.toString("utf8"));
}

function validateSplitPrepare(payload) {
  if (!payload || typeof payload !== "object") {
    return "Request body must be JSON.";
  }
  if (typeof payload.split_id !== "string" || payload.split_id.length === 0) {
    return "Invalid parameter: split_id.";
  }
  if (typeof payload.parent_statechain_id !== "string" || payload.parent_statechain_id.length === 0) {
    return "Invalid parameter: parent_statechain_id.";
  }
  if (typeof payload.t !== "string" || payload.t.length === 0) {
    return "Invalid parameter: t.";
  }
  if (!Array.isArray(payload.children) || payload.children.length < 2) {
    return "A split must contain at least two children.";
  }
  for (const [index, child] of payload.children.entries()) {
    if (!child || typeof child.statechain_id !== "string" || child.statechain_id.length === 0) {
      return `Child ${index} must include statechain_id.`;
    }
  }
  return null;
}

async function handleSplitPrepare(res, body) {
  let payload;
  try {
    payload = parseJsonBody(body);
  } catch {
    sendText(res, 400, "Invalid JSON.");
    return;
  }

  const validationError = validateSplitPrepare(payload);
  if (validationError) {
    sendText(res, 400, validationError);
    return;
  }

  if (splitChildren.has(payload.split_id)) {
    sendJson(res, 200, { children: splitChildren.get(payload.split_id) });
    return;
  }

  const children = [];
  try {
    for (const child of payload.children) {
      const realResponse = await postRealJson("/get_public_key", {
        statechain_id: child.statechain_id,
      });
      if (typeof realResponse.server_pubkey !== "string") {
        throw new Error("Real lockbox did not return server_pubkey.");
      }
      children.push({
        statechain_id: child.statechain_id,
        server_pubkey: realResponse.server_pubkey,
      });
    }
  } catch (error) {
    sendText(res, 502, `Failed to prepare split children through real lockbox: ${error.message}`);
    return;
  }

  splitChildren.set(payload.split_id, children);
  sendJson(res, 200, { children });
}

async function handleSplitFinalize(res, body) {
  let payload;
  try {
    payload = parseJsonBody(body);
  } catch {
    sendText(res, 400, "Invalid JSON.");
    return;
  }

  if (!payload || typeof payload.split_id !== "string" || typeof payload.parent_statechain_id !== "string") {
    sendText(res, 400, "Invalid parameters. They must be 'split_id' and 'parent_statechain_id'.");
    return;
  }

  sendJson(res, 200, { finalized: true });
}

async function handleSplitAbort(res, body) {
  let payload;
  try {
    payload = parseJsonBody(body);
  } catch {
    sendText(res, 400, "Invalid JSON.");
    return;
  }

  if (!payload || typeof payload.split_id !== "string" || typeof payload.parent_statechain_id !== "string") {
    sendText(res, 400, "Invalid parameters. They must be 'split_id' and 'parent_statechain_id'.");
    return;
  }

  const children = splitChildren.get(payload.split_id) || [];
  try {
    for (const child of children) {
      await deleteReal(`/delete_statechain/${encodeURIComponent(child.statechain_id)}`);
    }
  } catch (error) {
    sendText(res, 502, `Failed to abort split children through real lockbox: ${error.message}`);
    return;
  }

  splitChildren.delete(payload.split_id);
  sendJson(res, 200, { aborted: true });
}

const server = http.createServer(async (req, res) => {
  try {
    const body = await readBody(req);
    const pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;

    if (req.method === "GET" && pathname === "/") {
      sendText(res, 200, "Mercury lockbox split shim");
      return;
    }

    if (req.method === "POST" && pathname === "/split/prepare") {
      await handleSplitPrepare(res, body);
      return;
    }

    if (req.method === "POST" && pathname === "/split/finalize") {
      await handleSplitFinalize(res, body);
      return;
    }

    if (req.method === "POST" && pathname === "/split/abort") {
      await handleSplitAbort(res, body);
      return;
    }

    await proxyRequest(req, res, body);
  } catch (error) {
    sendText(res, 500, error.stack || error.message);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Lockbox split shim listening on ${port}, proxying to ${realLockboxUrl}`);
});
