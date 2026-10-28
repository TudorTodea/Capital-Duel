const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");

const COUNTRIES = require("./data/countries.json");
const QUESTION_BANK = require("./data/millionaire.json");
const MODES = ["capitals", "flags", "millionaire"];

const PORT = process.env.PORT || 3737;
const START_MS = 60_000;
const COUNTDOWN_MS = 3_000;
const TRANSITION_MS = 2_000; // pause after a new country appears (map zoom + toast) before the clock runs
const SKIP_MS = 1_000;
const GRACE_MS = 30_000;

// ---------- Millionaire (co-op) mode ----------
const LADDER = [100, 200, 300, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 125_000, 250_000, 500_000, 1_000_000];
const MILESTONES = [4, 9]; // ladder indices that are guaranteed minimums once passed ($1,000 and $32,000)
const M_CORRECT_DELAY = 2_200;
const M_WRONG_DELAY = 3_200;

function bandFor(qIndex) {
  return qIndex < 5 ? "easy" : qIndex < 10 ? "medium" : "hard";
}

const money = (n) => n.toLocaleString("ro-RO") + " lei";

function pickQuestion(r, qIndex) {
  const band = bandFor(qIndex);
  const bank = QUESTION_BANK[band];
  let avail = bank.map((_, i) => i).filter((i) => !r.usedQ[band].includes(i));
  if (!avail.length) { r.usedQ[band] = []; avail = bank.map((_, i) => i); }
  const pick = avail[Math.floor(Math.random() * avail.length)];
  r.usedQ[band].push(pick);
  const item = bank[pick];
  return { text: item.q, options: item.options, answer: item.a };
}

function sysChat(r, text) {
  const msg = { by: -1, name: "", text, ts: Date.now(), sys: true };
  r.chat.push(msg);
  if (r.chat.length > 150) r.chat = r.chat.slice(-150);
  chatBroadcast(r, msg);
}

function chatBroadcast(r, msg) {
  r.players.forEach((p) => { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: "chat", msg })); });
}

function startMillionaire(r) {
  r.qIndex = 0;
  r.chat = [];
  r.eliminated = [];
  r.lifeline = { fifty: true };
  r.usedQ = { easy: [], medium: [], hard: [] };
  r.mReveal = null;
  r.pending = false;
  r.outcome = null;
  r.wonAmount = 0;
  r.question = pickQuestion(r, 0);
  sysChat(r, "💍 Joc nou! Discutați, apoi oricare dintre voi poate răspunde. Baftă, echipă!");
}

function millionaireSafeAmount(qIndexFailedAt) {
  let safe = 0;
  for (const m of MILESTONES) if (m < qIndexFailedAt) safe = Math.max(safe, LADDER[m]);
  return safe;
}

function handleAnswer(r, idx, optIndex) {
  if (r.mode !== "millionaire" || r.phase !== "playing" || r.paused || r.pending) return;
  if (!Number.isInteger(optIndex) || optIndex < 0 || optIndex > 3) return;
  if (r.eliminated.includes(optIndex)) return;
  const q = r.question;
  const correct = optIndex === q.answer;
  r.pending = true;
  r.mReveal = { by: idx, option: optIndex, answer: q.answer, correct, amount: LADDER[r.qIndex] };
  sysChat(r, `🎯 ${r.players[idx].name} a ales: ${q.options[optIndex]}`);
  broadcast(r);
  r.timers.mReveal = setTimeout(() => {
    delete r.timers.mReveal;
    r.pending = false;
    r.mReveal = null;
    if (correct) {
      sysChat(r, `✅ Corect! +${money(LADDER[r.qIndex])}`);
      r.qIndex++;
      if (r.qIndex >= LADDER.length) {
        r.phase = "over";
        r.outcome = "won";
        r.wonAmount = LADDER[LADDER.length - 1];
        r.question = null;
        sysChat(r, "🏆 Ați răspuns corect la tot — sunteți Milionari în Dragoste!");
      } else {
        r.eliminated = [];
        r.question = pickQuestion(r, r.qIndex);
      }
    } else {
      r.phase = "over";
      r.outcome = "lost";
      r.wonAmount = millionaireSafeAmount(r.qIndex);
      r.question = null;
      sysChat(r, `❌ Nu chiar — răspunsul corect era „${q.options[q.answer]}”. Plecați cu ${money(r.wonAmount)}.`);
    }
    broadcast(r);
  }, correct ? M_CORRECT_DELAY : M_WRONG_DELAY);
  broadcast(r);
}

function handleWalk(r, idx) {
  if (r.mode !== "millionaire" || r.phase !== "playing" || r.paused || r.pending || r.qIndex === 0) return;
  r.phase = "over";
  r.outcome = "walked";
  r.wonAmount = LADDER[r.qIndex - 1];
  r.question = null;
  sysChat(r, `💝 ${r.players[idx].name} a ales să vă opriți aici, cu ${money(r.wonAmount)}.`);
  broadcast(r);
}

function handleLifeline(r, idx, which) {
  if (r.mode !== "millionaire" || r.phase !== "playing" || r.paused || r.pending) return;
  if (which !== "fifty" || !r.lifeline.fifty || r.eliminated.length) return;
  r.lifeline.fifty = false;
  const wrong = shuffle([0, 1, 2, 3].filter((i) => i !== r.question.answer)).slice(0, 2);
  r.eliminated = wrong.sort((a, b) => a - b);
  sysChat(r, `✨ ${r.players[idx].name} a folosit 50:50 — două răspunsuri greșite au fost eliminate.`);
  broadcast(r);
}

function handleChat(r, idx, text) {
  text = String(text || "").trim().slice(0, 200);
  if (!text) return;
  const msg = { by: idx, name: r.players[idx].name, text, ts: Date.now(), sys: false };
  r.chat.push(msg);
  if (r.chat.length > 150) r.chat = r.chat.slice(-150);
  chatBroadcast(r, msg);
}

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
      mode: "capitals", // capitals | flags | millionaire — set by the room creator, fixed for the game
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
      // millionaire-only state (harmless/unused in the other modes)
      qIndex: 0,
      question: null,
      eliminated: [],
      lifeline: { fifty: true },
      usedQ: { easy: [], medium: [], hard: [] },
      pending: false,
      mReveal: null,
      outcome: null,
      wonAmount: 0,
      chat: [],
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
    millionaire: r.mode !== "millionaire" ? undefined : {
      qIndex: r.qIndex,
      question: r.question ? { text: r.question.text, options: r.question.options } : null,
      eliminated: r.eliminated,
      lifeline: r.lifeline,
      pending: r.pending,
      reveal: r.mReveal,
      outcome: r.outcome,
      wonAmount: r.wonAmount,
    },
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
  r.phase = "playing";
  r.winner = null;
  r.reveal = null;
  r.lockedUntil = 0;
  r.paused = false;
  if (r.mode === "millionaire") {
    startMillionaire(r);
    broadcast(r);
    return;
  }
  r.deck = shuffle(COUNTRIES);
  r.turn = Math.floor(Math.random() * 2);
  r.current = nextCountry(r);
  startClockAt(r, Date.now() + COUNTDOWN_MS);
  broadcast(r);
}

function pause(r) {
  if (r.phase !== "playing" || r.paused) return;
  if (r.mode === "millionaire") {
    clearTimer(r, "mReveal");
    r.pending = false;
    r.mReveal = null;
  } else {
    stopClock(r);
    if (r.lockedUntil) {
      clearTimer(r, "skip");
      r.lockedUntil = 0;
      r.reveal = null;
      r.current = nextCountry(r);
    }
  }
  r.paused = true;
  r.pauseDeadline = Date.now() + GRACE_MS;
  r.timers.grace = setTimeout(() => {
    if (r.phase !== "playing" || !r.paused) return;
    const gone = r.players.findIndex((p) => !p.ws);
    r.phase = "over";
    if (r.mode === "millionaire") {
      r.outcome = "left";
      r.wonAmount = r.qIndex > 0 ? LADDER[r.qIndex - 1] : 0;
      r.question = null;
    } else {
      r.winner = gone === -1 ? null : 1 - gone;
      r.reveal = { kind: "forfeit", text: "" };
    }
    broadcast(r);
  }, GRACE_MS);
  broadcast(r);
}

function resume(r) {
  if (!r.paused) return;
  clearTimer(r, "grace");
  r.paused = false;
  r.pauseDeadline = null;
  if (r.mode !== "millionaire") startClockAt(r, Date.now() + 1500);
  broadcast(r);
}

function handleGuess(r, idx, text) {
  if (r.mode === "millionaire" || r.phase !== "playing" || r.paused || idx !== r.turn) return;
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
  if (r.mode === "millionaire" || r.phase !== "playing" || r.paused || idx !== r.turn) return;
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
      if (r.mode === "millionaire") ws.send(JSON.stringify({ t: "chatHistory", chat: r.chat }));
      if (r.phase === "lobby" && r.players.length === 2 && r.players.every((q) => q.ws)) startGame(r);
      else if (r.paused && r.players.every((q) => q.ws)) resume(r);
      else broadcast(r);
      return;
    }

    if (!room) return;
    if (m.t === "guess") handleGuess(room, idx, String(m.text || "").slice(0, 60));
    else if (m.t === "skip") handleSkip(room, idx);
    else if (m.t === "rematch") handleRematch(room, idx);
    else if (m.t === "answer") handleAnswer(room, idx, m.option);
    else if (m.t === "walk") handleWalk(room, idx);
    else if (m.t === "lifeline") handleLifeline(room, idx, m.which);
    else if (m.t === "chat") handleChat(room, idx, m.text);
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
