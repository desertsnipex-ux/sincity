const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CONTENT_FILE = path.join(DATA_DIR, "content.json");
const APPLICATIONS_FILE = path.join(DATA_DIR, "applications.json");
const RUNTIME_FILE = path.join(DATA_DIR, "runtime.json");
const PORT = Number(process.env.PORT || 4173);
const REQUIRE_ADMIN_KEY = process.env.SINCITY_REQUIRE_ADMIN_KEY === "true";
const ADMIN_KEY = process.env.SINCITY_ADMIN_KEY || "sincity-admin";
const DISCORD_WEBHOOK_URL = process.env.SINCITY_DISCORD_WEBHOOK || "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const sseClients = new Set();

let content = readJson(CONTENT_FILE);
let applications = readJson(APPLICATIONS_FILE);
let runtime = readJson(RUNTIME_FILE);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[extension] || "application/octet-stream";
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    response.writeHead(200, { "Content-Type": type });
    response.end(data);
  });
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error("Body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function normalizeApplications(list) {
  return list.slice().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
}

function getPublicState() {
  return {
    content,
    runtime: {
      ...runtime,
      localMode: true,
      adminProtected: REQUIRE_ADMIN_KEY,
      applicationCount: applications.length,
      pendingApplications: applications.filter((item) => item.status === "pending").length
    }
  };
}

function broadcast(type, payload) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

function requireAdmin(request, response) {
  if (!REQUIRE_ADMIN_KEY) {
    return true;
  }
  const key = request.headers["x-admin-key"];
  if (key !== ADMIN_KEY) {
    sendJson(response, 401, { error: "Admin key required." });
    return false;
  }
  return true;
}

function createApplication(payload) {
  const now = new Date().toISOString();
  return {
    id: `app-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    discord: String(payload.discord || "").trim(),
    displayName: String(payload.displayName || "").trim(),
    characterAge: String(payload.characterAge || "").trim(),
    timezone: String(payload.timezone || "").trim(),
    playstyle: String(payload.playstyle || "").trim(),
    hours: String(payload.hours || "").trim(),
    concept: String(payload.concept || "").trim(),
    voice: String(payload.voice || "").trim(),
    rules: String(payload.rules || "").trim(),
    availability: String(payload.availability || "").trim(),
    notes: String(payload.notes || "").trim()
  };
}

function validateApplication(application) {
  const required = ["discord", "displayName", "characterAge", "timezone", "playstyle", "hours", "concept", "voice", "rules", "availability"];
  for (const field of required) {
    if (!application[field]) {
      return `Missing ${field}.`;
    }
  }
  return null;
}

function updateRuntimeFromInput(input) {
  runtime = {
    ...runtime,
    online: Number(input.online ?? runtime.online),
    queue: Number(input.queue ?? runtime.queue),
    storyDensity: Number(input.storyDensity ?? runtime.storyDensity),
    heatLevel: String(input.heatLevel ?? runtime.heatLevel),
    economyShift: Number(input.economyShift ?? runtime.economyShift),
    weatherLabel: String(input.weatherLabel ?? runtime.weatherLabel),
    dispatchMood: String(input.dispatchMood ?? runtime.dispatchMood),
    restartAt: String(input.restartAt ?? runtime.restartAt),
    serverTimeZone: String(input.serverTimeZone ?? runtime.serverTimeZone),
    maxPlayers: Number(input.maxPlayers ?? runtime.maxPlayers)
  };
  writeJson(RUNTIME_FILE, runtime);
}

function mutateRuntime() {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  runtime.online = clamp(runtime.online + Math.floor(Math.random() * 7) - 3, 90, runtime.maxPlayers);
  runtime.queue = clamp(runtime.queue + Math.floor(Math.random() * 5) - 2, 8, 70);
  runtime.storyDensity = clamp(runtime.storyDensity + Math.floor(Math.random() * 5) - 2, 88, 100);
  runtime.economyShift = Math.round((runtime.economyShift + (Math.random() * 1.8 - 0.9)) * 10) / 10;

  const heatOptions = ["Low", "Moderate", "Hot", "Messy"];
  if (Math.random() > 0.72) {
    runtime.heatLevel = heatOptions[Math.floor(Math.random() * heatOptions.length)];
  }
  if (Math.random() > 0.75) {
    runtime.weatherLabel = content.weatherModes[Math.floor(Math.random() * content.weatherModes.length)];
  }
  if (Math.random() > 0.76) {
    runtime.dispatchMood = content.dispatchModes[Math.floor(Math.random() * content.dispatchModes.length)];
  }
  writeJson(RUNTIME_FILE, runtime);
  broadcast("runtime", getPublicState().runtime);
}

function injectIncident(input) {
  const nowLabel = input.time || "moments ago";
  const newIncident = {
    id: `evt-${Date.now()}`,
    title: String(input.title || "New incident"),
    severity: ["low", "medium", "high"].includes(input.severity) ? input.severity : "medium",
    time: String(nowLabel),
    details: String(input.details || "Something suspicious happened and the city is pretending not to notice.")
  };
  content.incidents.unshift(newIncident);
  content.incidents = content.incidents.slice(0, 8);
  writeJson(CONTENT_FILE, content);
  broadcast("content", { incidents: content.incidents, bulletins: content.bulletins, gallery: content.gallery });
  return newIncident;
}

function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Snapshot payload is missing.");
  }
  if (!snapshot.content || !snapshot.runtime || !Array.isArray(snapshot.applications)) {
    throw new Error("Snapshot must include content, runtime, and applications.");
  }
  content = snapshot.content;
  runtime = snapshot.runtime;
  applications = snapshot.applications;
  writeJson(CONTENT_FILE, content);
  writeJson(RUNTIME_FILE, runtime);
  writeJson(APPLICATIONS_FILE, applications);
}

function routeStatic(requestPath, response) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath === "/admin" ? "/admin.html" : requestPath;
  const resolvedPath = path.normalize(path.join(ROOT, cleanPath));
  if (!resolvedPath.startsWith(ROOT)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  sendFile(response, resolvedPath);
}

async function sendDiscordWebhook(application) {
  if (!DISCORD_WEBHOOK_URL) return;

  const payload = {
    embeds: [{
      title: "New Whitelist Application",
      color: 0x90ff5f,
      fields: [
        { name: "Discord", value: application.discord, inline: true },
        { name: "Character Name", value: application.displayName, inline: true },
        { name: "Age", value: application.characterAge, inline: true },
        { name: "Playstyle", value: application.playstyle, inline: true },
        { name: "Concept", value: application.concept.substring(0, 1024) }
      ],
      footer: { text: `SinCity | ${application.id}` },
      timestamp: new Date().toISOString()
    }]
  };

  try {
    const url = new URL(DISCORD_WEBHOOK_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    req.write(JSON.stringify(payload));
    req.end();
  } catch (error) {
    console.error("Discord Webhook failed:", error.message);
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname;

  try {
    if (request.method === "GET" && pathname === "/api/bootstrap") {
      sendJson(response, 200, getPublicState());
      return;
    }

    if (request.method === "GET" && pathname === "/api/live") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });
      response.write(`event: bootstrap\ndata: ${JSON.stringify(getPublicState())}\n\n`);
      sseClients.add(response);
      request.on("close", () => {
        sseClients.delete(response);
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/applications") {
      const payload = await parseBody(request);
      const application = createApplication(payload);
      const error = validateApplication(application);
      if (error) {
        sendJson(response, 400, { error });
        return;
      }
      applications.unshift(application);
      writeJson(APPLICATIONS_FILE, applications);
      broadcast("applications", { applications: normalizeApplications(applications), pendingApplications: applications.filter((item) => item.status === "pending").length });
      sendDiscordWebhook(application).catch(() => {});
      sendJson(response, 201, { ok: true, application });
      return;
    }

    if (pathname.startsWith("/api/admin")) {
      if (!requireAdmin(request, response)) {
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/content") {
        sendJson(response, 200, content);
        return;
      }

      if (request.method === "PUT" && pathname === "/api/admin/content") {
        const payload = await parseBody(request);
        content = payload;
        writeJson(CONTENT_FILE, content);
        broadcast("content", { incidents: content.incidents, bulletins: content.bulletins, gallery: content.gallery, quickLinks: content.quickLinks });
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/applications") {
        sendJson(response, 200, normalizeApplications(applications));
        return;
      }

      if (request.method === "PATCH" && pathname.startsWith("/api/admin/applications/")) {
        const applicationId = pathname.split("/").pop();
        const payload = await parseBody(request);
        const application = applications.find((item) => item.id === applicationId);
        if (!application) {
          sendJson(response, 404, { error: "Application not found." });
          return;
        }
        application.status = String(payload.status || application.status);
        application.updatedAt = new Date().toISOString();
        writeJson(APPLICATIONS_FILE, applications);
        broadcast("applications", { applications: normalizeApplications(applications), pendingApplications: applications.filter((item) => item.status === "pending").length });
        sendJson(response, 200, { ok: true, application });
        return;
      }

      if (request.method === "DELETE" && pathname.startsWith("/api/admin/applications/")) {
        const applicationId = pathname.split("/").pop();
        const nextApplications = applications.filter((item) => item.id !== applicationId);
        if (nextApplications.length === applications.length) {
          sendJson(response, 404, { error: "Application not found." });
          return;
        }
        applications = nextApplications;
        writeJson(APPLICATIONS_FILE, applications);
        broadcast("applications", { applications: normalizeApplications(applications), pendingApplications: applications.filter((item) => item.status === "pending").length });
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/runtime") {
        sendJson(response, 200, runtime);
        return;
      }

      if (request.method === "PUT" && pathname === "/api/admin/runtime") {
        const payload = await parseBody(request);
        updateRuntimeFromInput(payload);
        broadcast("runtime", getPublicState().runtime);
        sendJson(response, 200, { ok: true, runtime });
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/incidents") {
        const payload = await parseBody(request);
        const incident = injectIncident(payload);
        sendJson(response, 201, { ok: true, incident });
        return;
      }

      if (request.method === "GET" && pathname === "/api/admin/export") {
        sendJson(response, 200, { content, runtime, applications: normalizeApplications(applications) });
        return;
      }

      if (request.method === "POST" && pathname === "/api/admin/import") {
        const payload = await parseBody(request);
        applySnapshot(payload);
        broadcast("content", {
          incidents: content.incidents,
          bulletins: content.bulletins,
          gallery: content.gallery,
          quickLinks: content.quickLinks
        });
        broadcast("runtime", getPublicState().runtime);
        broadcast("applications", {
          applications: normalizeApplications(applications),
          pendingApplications: applications.filter((item) => item.status === "pending").length
        });
        sendJson(response, 200, { ok: true });
        return;
      }
    }

    routeStatic(pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

setInterval(mutateRuntime, 8000);

server.listen(PORT, () => {
  console.log(`SinCity server running on http://localhost:${PORT}`);
  if (REQUIRE_ADMIN_KEY) {
    console.log(`Admin key protection enabled. Key: ${ADMIN_KEY}`);
  } else {
    console.log("Admin key protection disabled. Local mode is open.");
  }
});
