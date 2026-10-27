const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const COUNTRIES = require("./data/countries.json");
const MODES = ["capitals", "flags"];

const PORT = process.env.PORT || 3737;
const START_MS = 60_000;
const COUNTDOWN_MS = 3_000;
const TRANSITION_MS = 2_000; // pause after a new country appears (map zoom + toast) before the clock runs
const SKIP_MS = 1_000;
const GRACE_MS = 30_000;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
// Name lists for the guess autocomplete (no country mapping, so they're not an answer key)
app.get("/api/names", (_req, res) =>
  res.json({
    capitals: [...new Set(COUNTRIES.flatMap((c) => c.capitalAccept))].sort((a, b) => a.localeCompare(b)),
    countries: [...new Set(COUNTRIES.flatMap((c) => c.countryAccept))].sort((a, b) => a.localeCompare(b)),
  }));
// Any /room/xyz or /?room=xyz serves the same page
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- answer matching ----------
const norm = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function keysFor(names) {
  const set = new Set();
  for (const a of names) {
    set.add(norm(a));
    set.add(norm(a.replace(/\bcity\b/i, ""))); // "Panama" for "Panama City"
  }
  set.delete("");
  return [...set];
}

for (const c of COUNTRIES) {
  c.capKeys = keysFor(c.capitalAccept);
  c.countryKeys = keysFor(c.countryAccept);
}

function isCorrect(keys, guess) {
  const g = norm(guess);
  if (!g) return false;
  return keys.some((k) => k === g || (k.length >= 5 && g.length >= 5 && lev(k, g) <= 1));
}

// Weighted random pick for the Flags mode, so well-known flags come up more often.
// Falls back to a plain shuffled deck for Capitals (every country is seen equally often).
const TOTAL_WEIGHT = COUNTRIES.reduce((s, c) => s + c.weight, 0);
function weightedPick(avoidId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let r = Math.random() * TOTAL_WEIGHT;
    let pick = COUNTRIES[COUNTRIES.length - 1];
    for (const c of COUNTRIES) {
      r -= c.weight;
      if (r <= 0) { pick = c; break; }
    }
    if (pick.id !== avoidId || COUNTRIES.length === 1) return pick;
  }
  return COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
}

// ---------- rooms ----------
const rooms = new Map();

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getRoom(id) {
  let r = rooms.get(id);
  if (!r) {
    r = {
      id,
      players: [],
      mode: "capitals", // capitals | flags — set by the room creator, fixed for the game
      phase: "lobby", // lobby | playing | over
      turn: 0,
      deck: [],
      current: null,
      runningSince: null, // server ms when the active clock starts/started; null = stopped
      lockedUntil: 0,
      reveal: null,
      winner: null,
      paused: false,
      pauseDeadline: null,
      timers: {},
      cleanup: null,
    };
    rooms.set(id, r);
  }
  return r;
}

function clearTimer(r, k) {
  clearTimeout(r.timers[k]);
  delete r.timers[k];
}

function nextCountry(r) {
  if (r.mode === "flags") return weightedPick(r.current?.id);
  if (!r.deck.length) r.deck = shuffle(COUNTRIES);
  return r.deck.pop();
}

function publicState(r, idx) {
  const c = r.current;
  return {
    t: "state",
    room: r.id,
    mode: r.mode,
    you: idx,
    phase: r.phase,
    paused: r.paused,
    turn: r.turn,
    winner: r.winner,
    serverNow: Date.now(),
    runningSince: r.runningSince,
    lockedUntil: r.lockedUntil,
    reveal: r.reveal,
    country: c ? { id: c.id, cca2: c.cca2, lat: c.lat, lng: c.lng } : null,
    players: r.players.map((p) => ({
      name: p.name,
      connected: !!p.ws,
      remaining: p.remaining,
      score: p.score,
      rematch: p.rematch,
    })),
  };
}

function broadcast(r) {
  r.players.forEach((p, i) => {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(publicState(r, i)));
  });
}

// Subtract elapsed time from the active player's clock and stop it.
function stopClock(r) {
  const p = r.players[r.turn];
  if (r.runningSince !== null) {
    p.remaining = Math.max(0, p.remaining - Math.max(0, Date.now() - r.runningSince));
    r.runningSince = null;
  }
  clearTimer(r, "expire");
}

function startClockAt(r, at) {
  r.runningSince = at;
  clearTimer(r, "expire");
  const p = r.players[r.turn];
  r.timers.expire = setTimeout(() => timeUp(r), Math.max(0, at + p.remaining - Date.now()) + 5);
}

const answerOf = (r) => (r.mode === "flags" ? r.current.country : r.current.capital);
const keysOf = (r) => (r.mode === "flags" ? r.current.countryKeys : r.current.capKeys);

function timeUp(r) {
  if (r.phase !== "playing") return;
  stopClock(r);
  r.players[r.turn].remaining = 0;
  r.phase = "over";
  r.winner = 1 - r.turn;
  r.reveal = { kind: "timeup", text: answerOf(r) };
  r.lockedUntil = 0;
  clearTimer(r, "skip");
  broadcast(r);
}

function startGame(r) {
  Object.keys(r.timers).forEach((k) => clearTimer(r, k));
  r.players.forEach((p) => {
    p.remaining = START_MS;
    p.score = 0;
    p.rematch = false;
  });
  r.deck = shuffle(COUNTRIES);
  r.turn = Math.floor(Math.random() * 2);
  r.current = nextCountry(r);
  r.phase = "playing";
  r.winner = null;
  r.reveal = null;
  r.lockedUntil = 0;
  r.paused = false;
  startClockAt(r, Date.now() + COUNTDOWN_MS);
  broadcast(r);
}

function pause(r) {
  if (r.phase !== "playing" || r.paused) return;
  stopClock(r);
  if (r.lockedUntil) {
    clearTimer(r, "skip");
    r.lockedUntil = 0;
    r.reveal = null;
    r.current = nextCountry(r);
  }
  r.paused = true;
  r.pauseDeadline = Date.now() + GRACE_MS;
  r.timers.grace = setTimeout(() => {
    if (r.phase !== "playing" || !r.paused) return;
    const gone = r.players.findIndex((p) => !p.ws);
    r.phase = "over";
    r.winner = gone === -1 ? null : 1 - gone;
    r.reveal = { kind: "forfeit", text: "" };
    broadcast(r);
  }, GRACE_MS);
  broadcast(r);
}

function resume(r) {
  if (!r.paused) return;
  clearTimer(r, "grace");
  r.paused = false;
  r.pauseDeadline = null;
  startClockAt(r, Date.now() + 1500);
  broadcast(r);
}

function handleGuess(r, idx, text) {
  if (r.phase !== "playing" || r.paused || idx !== r.turn) return;
  const now = Date.now();
  if (r.runningSince === null || now < r.runningSince || now < r.lockedUntil) return;
  if (!isCorrect(keysOf(r), text)) {
    r.players[idx].ws?.send(JSON.stringify({ t: "wrong" }));
    return;
  }
  stopClock(r);
  const me = r.players[idx];
  if (me.remaining <= 0) return timeUp(r);
  me.score++;
  r.reveal = { kind: "correct", text: answerOf(r), by: idx };
  r.turn = 1 - r.turn;
  r.current = nextCountry(r);
  startClockAt(r, Date.now() + TRANSITION_MS);
  broadcast(r);
}

function handleSkip(r, idx) {
  if (r.phase !== "playing" || r.paused || idx !== r.turn) return;
  const now = Date.now();
  if (r.runningSince === null || now < r.runningSince || now < r.lockedUntil) return;
  r.lockedUntil = now + SKIP_MS;
  r.reveal = { kind: "skip", text: answerOf(r), by: idx };
  r.timers.skip = setTimeout(() => {
    delete r.timers.skip;
    if (r.phase !== "playing" || r.paused) return;
    r.lockedUntil = 0;
    r.reveal = null;
    r.current = nextCountry(r);
    broadcast(r);
  }, SKIP_MS);
  broadcast(r);
}

function handleRematch(r, idx) {
  if (r.phase !== "over" || r.players.length < 2) return;
  r.players[idx].rematch = true;
  if (r.players.every((p) => p.rematch && p.ws)) startGame(r);
  else broadcast(r);
}

// ---------- sockets ----------
wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  let room = null;
  let idx = -1;

  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }

    if (m.t === "join") {
      const id = String(m.room || "").toLowerCase();
      const name = String(m.name || "").trim().slice(0, 20) || "Player";
      const token = String(m.token || "");
      if (!/^[a-z0-9]{4,16}$/.test(id) || !token) return ws.send(JSON.stringify({ t: "error", msg: "Bad room link." }));
      const r = getRoom(id);
      let i = r.players.findIndex((p) => p.token === token);
      if (i === -1) {
        if (r.players.length >= 2) return ws.send(JSON.stringify({ t: "error", msg: "This room is full." }));
        if (r.players.length === 0 && MODES.includes(m.mode)) r.mode = m.mode;
        r.players.push({ token, name, ws: null, remaining: START_MS, score: 0, rematch: false });
        i = r.players.length - 1;
      } else {
        r.players[i].name = name;
      }
      const p = r.players[i];
      if (p.ws && p.ws !== ws) p.ws.close();
      p.ws = ws;
      room = r;
      idx = i;
      clearTimeout(r.cleanup);
      if (r.phase === "lobby" && r.players.length === 2 && r.players.every((q) => q.ws)) startGame(r);
      else if (r.paused && r.players.every((q) => q.ws)) resume(r);
      else broadcast(r);
      return;
    }

    if (!room) return;
    if (m.t === "guess") handleGuess(room, idx, String(m.text || "").slice(0, 60));
    else if (m.t === "skip") handleSkip(room, idx);
    else if (m.t === "rematch") handleRematch(room, idx);
  });

  ws.on("close", () => {
    if (!room) return;
    const p = room.players[idx];
    if (p && p.ws === ws) {
      p.ws = null;
      if (room.phase === "playing") pause(room);
      else broadcast(room);
    }
    if (room.players.every((q) => !q.ws)) {
      room.cleanup = setTimeout(() => {
        Object.keys(room.timers).forEach((k) => clearTimer(room, k));
        rooms.delete(room.id);
      }, 10 * 60_000);
    }
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25_000);

server.listen(PORT, () => console.log(`Capital Duel running on http://localhost:${PORT}`));
