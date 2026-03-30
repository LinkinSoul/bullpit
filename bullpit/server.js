const crypto = require("crypto");
const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  INITIAL_CASH,
  buildGameContext,
  buildLeaderboardEntry,
  buildTeamStateKey,
  createTeamState,
  normalizeTeamState,
  normalizeTradeFeedItem,
  sanitizeTeamStateForClient,
  syncTeamState,
  executeTradeAction,
} = require("./game-engine");

const PORT = Number(process.env.PORT) || 8080;
const GM_PASSWORD = process.env.BULLPIT_GM_PASSWORD || "GMMASTER99";
const PRIVATE_TEAMS_KEY = "secure:teams";
const PUBLIC_TEAMS_KEY = "gm:teams";
const ORDER_FLOW_KEY = "gm:orderflow";
const LEADERBOARD_PREFIX = "lb:";
const TRADE_FEED_PREFIX = "cd:trade:";
const store = {};
const clients = [];
const sessions = new Map();

const DEFAULT_TEAMS = [
  { id: "t1", name: "Alpha Squad", password: "alpha123", color: "#00f5c4" },
  { id: "t2", name: "Bull Runners", password: "bull456", color: "#fbbf24" },
  { id: "t3", name: "Bear Force", password: "bear789", color: "#f472b6" },
  { id: "t4", name: "Quantum Traders", password: "quant321", color: "#a78bfa" },
  { id: "t5", name: "Solar Surge", password: "solar654", color: "#38bdf8" },
  { id: "t6", name: "Dark Pool", password: "dark987", color: "#fb923c" },
];

const PUBLIC_READ_KEYS = new Set([
  "gm:state",
  "gm:prices",
  PUBLIC_TEAMS_KEY,
  "gm:disruptions",
  "gm:news",
  "gm:prediction",
  "gm:broadcast",
  "cd:trades",
  ORDER_FLOW_KEY,
]);

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function tryParseJSON(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonStore(key, value) {
  store[key] = JSON.stringify(value);
  return store[key];
}

function readJsonStore(key, fallback = null) {
  const parsed = tryParseJSON(store[key], fallback);
  return parsed == null ? fallback : parsed;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sanitizeTeams(teams = []) {
  return teams.map(({ id, name, color }) => ({ id, name, color }));
}

function normalizeTeam(team, index) {
  const fallback = DEFAULT_TEAMS[index] || {};
  const generatedPassword = crypto.randomBytes(6).toString("hex");
  return {
    id: typeof team?.id === "string" && team.id.trim() ? team.id.trim() : fallback.id || `t${index + 1}`,
    name: typeof team?.name === "string" && team.name.trim() ? team.name.trim() : fallback.name || `Team ${index + 1}`,
    password: typeof team?.password === "string" && team.password.trim()
      ? team.password.trim()
      : fallback.password || generatedPassword,
    color: typeof team?.color === "string" && team.color.trim()
      ? team.color.trim()
      : fallback.color || "#38bdf8",
  };
}

function normalizeTeams(rawTeams) {
  const source = Array.isArray(rawTeams) && rawTeams.length ? rawTeams : DEFAULT_TEAMS;
  return source.map((team, index) => normalizeTeam(team, index));
}

function getStoredTeams() {
  const privateTeams = readJsonStore(PRIVATE_TEAMS_KEY, null);
  if (Array.isArray(privateTeams) && privateTeams.length) {
    return normalizeTeams(privateTeams);
  }

  const legacyTeams = readJsonStore(PUBLIC_TEAMS_KEY, null);
  if (Array.isArray(legacyTeams) && legacyTeams.length) {
    const hasPasswords = legacyTeams.some(team => typeof team?.password === "string" && team.password.trim());
    const upgraded = legacyTeams.map((team, index) => (
      hasPasswords ? team : { ...team, password: DEFAULT_TEAMS[index]?.password || "" }
    ));
    return normalizeTeams(upgraded);
  }

  return normalizeTeams(DEFAULT_TEAMS);
}

function persistTeams(teams) {
  const normalized = normalizeTeams(teams);
  writeJsonStore(PRIVATE_TEAMS_KEY, normalized);
  writeJsonStore(PUBLIC_TEAMS_KEY, sanitizeTeams(normalized));
  return normalized;
}

function getPrivateTeams() {
  return normalizeTeams(readJsonStore(PRIVATE_TEAMS_KEY, DEFAULT_TEAMS));
}

function getTeamByName(name) {
  return getPrivateTeams().find(team => team.name === name) || null;
}

function getTeamById(id) {
  return getPrivateTeams().find(team => team.id === id) || null;
}

function getSessionTeam(session) {
  if (session?.role !== "team") return null;
  return getTeamById(session.teamId) || getTeamByName(session.teamName);
}

function readTeamState(team, context = null) {
  if (!team) return null;
  const activeContext = context || getCurrentGameContext();
  const raw = readJsonStore(buildTeamStateKey(team.id), null);
  return normalizeTeamState(raw, team, activeContext.initCash || INITIAL_CASH);
}

function writeTeamState(team, state) {
  if (!team || !state) return null;
  return writeJsonStore(buildTeamStateKey(team.id), state);
}

function getCurrentGameContext() {
  return buildGameContext({
    gmState: readJsonStore("gm:state", {}),
    pricesPayload: readJsonStore("gm:prices", {}),
    predictionSession: readJsonStore("gm:prediction", { phase: "closed" }),
  });
}

function updateLeaderboardRow(team, state, context) {
  const row = buildLeaderboardEntry(state, context, team);
  writeJsonStore(`${LEADERBOARD_PREFIX}${team.name}`, row);
  return row;
}

function syncSingleTeamState(team, options = {}) {
  if (!team) return null;
  const context = options.context || getCurrentGameContext();
  const raw = readJsonStore(buildTeamStateKey(team.id), null);
  const nextState = syncTeamState(raw, context, team, options);
  writeTeamState(team, nextState);
  updateLeaderboardRow(team, nextState, context);
  return nextState;
}

function syncAllTeamStates(options = {}) {
  const teams = getPrivateTeams();
  const context = options.context || getCurrentGameContext();
  const activeKeys = new Set();

  teams.forEach(team => {
    const state = syncSingleTeamState(team, { ...options, context });
    if (state) activeKeys.add(`${LEADERBOARD_PREFIX}${team.name}`);
  });

  Object.keys(store)
    .filter(key => key.startsWith(LEADERBOARD_PREFIX) && !activeKeys.has(key))
    .forEach(key => { delete store[key]; });
}

function ensureTeamState(team, options = {}) {
  if (!team) return null;
  const context = options.context || getCurrentGameContext();
  const raw = readJsonStore(buildTeamStateKey(team.id), null);
  const seeded = raw ? normalizeTeamState(raw, team, context.initCash || INITIAL_CASH) : createTeamState(team, context.initCash || INITIAL_CASH);
  writeTeamState(team, seeded);
  return syncSingleTeamState(team, { ...options, context });
}

function recordTradeFeedEvent(rawTrade) {
  if (Array.isArray(rawTrade)) {
    rawTrade.forEach(event => recordTradeFeedEvent(event));
    return;
  }
  if (!rawTrade) return;
  const now = Date.now();
  const event = normalizeTradeFeedItem({
    ...rawTrade,
    id: rawTrade?.id || now,
    ts: now,
  });
  if (!event) return;
  const feedKey = `${TRADE_FEED_PREFIX}${event.ts}:${Math.random().toString(36).slice(2, 8)}`;
  store["cd:trades"] = JSON.stringify(event);
  store[feedKey] = JSON.stringify(event);
  broadcastStoreUpdate("cd:trades", store["cd:trades"]);
  broadcastStoreUpdate(feedKey, store[feedKey]);
}

function updateTeamPredictionState(team, votePayload) {
  if (!team || !votePayload) return;
  const context = getCurrentGameContext();
  const state = readTeamState(team, context);
  state.playerPrediction = votePayload.option || null;
  state.playerPredictionRound = Number.isFinite(votePayload.round) ? votePayload.round : null;
  state.playerPredictionSessionId = votePayload.sessionId === null || votePayload.sessionId === undefined || votePayload.sessionId === ""
    ? null
    : String(votePayload.sessionId);
  writeTeamState(team, state);
  syncSingleTeamState(team, { context, accrueCarry: false });
}

function getAuthToken(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const altHeader = req.headers["x-auth-token"];
  return typeof altHeader === "string" ? altHeader.trim() : "";
}

function getSession(req) {
  const token = getAuthToken(req);
  return token ? (sessions.get(token) || null) : null;
}

function createSession(payload) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    ...payload,
    token,
    createdAt: Date.now(),
  });
  return token;
}

function isLeaderboardHidden() {
  const state = readJsonStore("gm:state", {});
  return !!state?.leaderHidden;
}

function canReadKey(session, key) {
  if (!key) return false;
  if (session?.role === "gm") return true;
  if (PUBLIC_READ_KEYS.has(key)) return true;
  if (key.startsWith(TRADE_FEED_PREFIX)) return true;
  if (key.startsWith(LEADERBOARD_PREFIX)) return !isLeaderboardHidden();
  return false;
}

function getReadableValue(session, key) {
  if (key === PUBLIC_TEAMS_KEY && session?.role === "gm") {
    return store[PRIVATE_TEAMS_KEY] ?? null;
  }
  return store[key] ?? null;
}

function canWriteKey(session, key) {
  if (!key) return false;
  if (session?.role === "gm") return true;
  if (session?.role === "team") {
    const team = getSessionTeam(session);
    if (!team) return false;
    if (key.startsWith("predvote:") && key.endsWith(`:${team.name}`)) return true;
  }
  return false;
}

function canDeleteKey(session) {
  return session?.role === "gm";
}

function normalizePlayerWrite(session, key, value) {
  if (session?.role !== "team") return value;

  const team = getSessionTeam(session);
  if (!team) {
    throw new Error("unknown team");
  }

  if (key.startsWith("predvote:") && key.endsWith(`:${team.name}`)) {
    const parsed = tryParseJSON(value, null);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("invalid prediction payload");
    }
    const parts = key.split(":");
    const sessionId = parts.length >= 3 ? parts[1] : null;
    return JSON.stringify({
      ...parsed,
      team: team.name,
      round: Number.isFinite(parsed.round) ? parsed.round : null,
      sessionId,
    });
  }

  return value;
}

function broadcastStoreUpdate(key, value) {
  const msg = `data: ${JSON.stringify({ key, value })}\n\n`;
  clients.forEach(client => {
    try {
      client.write(msg);
    } catch {}
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function getReachableIPv4s() {
  const { networkInterfaces } = require("os");
  const interfaces = networkInterfaces();
  const preferred = ["en0", "en1", "en2", "en3", "en4"];
  const excludedPrefixes = /^(bridge|utun|awdl|llw|lo)/;

  const toEntries = (names) => names.flatMap(name =>
    (interfaces[name] || [])
      .filter(net => net.family === "IPv4" && !net.internal)
      .map(net => ({ name, address: net.address }))
  );

  const primary = toEntries(preferred);
  const fallback = Object.entries(interfaces).flatMap(([name, nets]) =>
    excludedPrefixes.test(name)
      ? []
      : (nets || [])
          .filter(net => net.family === "IPv4" && !net.internal)
          .map(net => ({ name, address: net.address }))
  );

  const seen = new Set();
  return [...primary, ...fallback].filter(entry => {
    if (!entry?.address || seen.has(entry.address)) return false;
    seen.add(entry.address);
    return true;
  });
}

// Save store to disk every 10 seconds so data survives a restart
function persistStore() {
  fs.writeFileSync("store-backup.json", JSON.stringify(store));
}
setInterval(persistStore, 10000);

// Try to load previous store on startup
try {
  const backup = JSON.parse(fs.readFileSync("store-backup.json", "utf8"));
  Object.assign(store, backup);
  console.log("Loaded previous session data from backup.");
} catch { /* no backup file yet, that's fine */ }

persistTeams(getStoredTeams());
syncAllTeamStates({ accrueCarry: false });

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Auth-Token");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const session = getSession(req);

  // ── Live push stream (SSE) ───────────────────────────────────────────
  if (url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    res.write(":\n\n");
    clients.push(res);
    req.on("close", () => clients.splice(clients.indexOf(res), 1));
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/team") {
    readJsonBody(req).then(({ name, password }) => {
      const team = getPrivateTeams().find(entry => entry.name === name);
      if (!team || !safeEqual(team.password, password)) {
        json(res, 401, { ok: false, error: "Invalid team or password." });
        return;
      }
      const context = getCurrentGameContext();
      ensureTeamState(team, { context, accrueCarry: false });
      const token = createSession({ role: "team", teamId: team.id, teamName: team.name });
      json(res, 200, {
        ok: true,
        token,
        team: sanitizeTeams([team])[0],
      });
    }).catch(() => {
      json(res, 400, { ok: false, error: "Invalid login payload." });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/auth/gm") {
    readJsonBody(req).then(({ password }) => {
      if (!safeEqual(password, GM_PASSWORD)) {
        json(res, 401, { ok: false, error: "Incorrect GM password." });
        return;
      }
      const token = createSession({ role: "gm" });
      json(res, 200, { ok: true, token, role: "gm" });
    }).catch(() => {
      json(res, 400, { ok: false, error: "Invalid login payload." });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/team/state") {
    const team = getSessionTeam(session);
    if (!team) {
      json(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    const context = getCurrentGameContext();
    const state = syncSingleTeamState(team, { context });
    json(res, 200, {
      ok: true,
      team: sanitizeTeams([team])[0],
      state: sanitizeTeamStateForClient(state),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/team/trade") {
    const team = getSessionTeam(session);
    if (!team) {
      json(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    readJsonBody(req).then(payload => {
      const now = Date.now();
      const context = getCurrentGameContext();
      const seeded = syncSingleTeamState(team, { context, now });
      const workingState = normalizeTeamState(seeded, team, context.initCash);
      const result = executeTradeAction(workingState, context, team, payload);
      writeTeamState(team, workingState);
      recordTradeFeedEvent(result?.event);
      const syncedState = syncSingleTeamState(team, { context, now, accrueCarry: false });
      json(res, 200, {
        ok: true,
        team: sanitizeTeams([team])[0],
        state: sanitizeTeamStateForClient(syncedState),
      });
    }).catch(error => {
      json(res, 400, { ok: false, error: error?.message || "Trade rejected." });
    });
    return;
  }

  // ── GET /store?key=xxx  or  GET /store?prefix=xxx ────────────────────
  if (req.method === "GET" && url.pathname === "/store") {
    const key = url.searchParams.get("key");
    const prefix = url.searchParams.get("prefix");
    if (key) {
      if (!canReadKey(session, key)) {
        json(res, 403, { error: "forbidden" });
        return;
      }
      json(res, 200, { value: getReadableValue(session, key) });
    } else {
      const keys = Object.keys(store)
        .filter(candidate => candidate.startsWith(prefix || ""))
        .filter(candidate => canReadKey(session, candidate));
      json(res, 200, { keys });
    }
    return;
  }

  // ── POST /store  { key, value } ──────────────────────────────────────
  if (req.method === "POST" && url.pathname === "/store") {
    readJsonBody(req).then(({ key, value }) => {
      if (!canWriteKey(session, key)) {
        json(res, 403, { ok: false, error: "forbidden" });
        return;
      }

      if (key === PUBLIC_TEAMS_KEY && session?.role === "gm") {
        const teams = normalizeTeams(tryParseJSON(value, []));
        const publicValue = writeJsonStore(PUBLIC_TEAMS_KEY, sanitizeTeams(teams));
        writeJsonStore(PRIVATE_TEAMS_KEY, teams);
        syncAllTeamStates({ accrueCarry: false });
        broadcastStoreUpdate(PUBLIC_TEAMS_KEY, publicValue);
        json(res, 200, { ok: true, value: publicValue });
        return;
      }

      const normalizedValue = normalizePlayerWrite(session, key, value);
      store[key] = normalizedValue;

      if (session?.role === "team" && key.startsWith("predvote:")) {
        const team = getSessionTeam(session);
        updateTeamPredictionState(team, tryParseJSON(normalizedValue, null));
      }

      if (session?.role === "gm" && (key === "gm:state" || key === "gm:prices" || key === "gm:prediction")) {
        syncAllTeamStates();
      }

      broadcastStoreUpdate(key, normalizedValue);
      json(res, 200, { ok: true, value: normalizedValue });
    }).catch((error) => {
      json(res, 400, { ok: false, error: error?.message || "bad json" });
    });
    return;
  }

  // ── DELETE /store?key=xxx ────────────────────────────────────────────
  if (req.method === "DELETE" && url.pathname === "/store") {
    if (!canDeleteKey(session)) {
      json(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    const key = url.searchParams.get("key");
    delete store[key];
    json(res, 200, { ok: true });
    return;
  }

  // ── Serve files from the public/ folder ──────────────────────────────
  let filePath = path.join(__dirname, "public",
    url.pathname === "/" ? "index.html" : url.pathname);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("File not found: " + url.pathname); return; }
    const ext  = path.extname(filePath);
    const mime = {
      ".html": "text/html",
      ".js":   "application/javascript",
      ".jsx":  "application/javascript",
      ".css":  "text/css",
    };
    res.writeHead(200, { "Content-Type": mime[ext] || "text/plain" });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const reachableIPs = getReachableIPv4s();
  const primaryIP = reachableIPs[0]?.address || "localhost";
  console.log("\n====================================");
  console.log("  🐂  BULL PIT SERVER IS RUNNING");
  console.log("====================================");
  console.log(`  Your laptop:   http://localhost:${PORT}`);
  if (reachableIPs.length > 0) {
    reachableIPs.forEach(({ name, address }, index) => {
      const label = index === 0 ? "  Other devices:" : `  Alt address (${name}):`;
      console.log(`${label} http://${address}:${PORT}`);
    });
    console.log(`\n  Share this with teams: http://${primaryIP}:${PORT}`);
  } else {
    console.log("  Other devices: no active LAN/Wi-Fi IPv4 detected");
    console.log("\n  Share this with teams after connecting to Wi-Fi.");
  }
  console.log("====================================\n");
});
