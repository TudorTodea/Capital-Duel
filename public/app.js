(() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let roomId = (params.get("room") || "").toLowerCase();

  // identity: per tab, so two tabs on one machine can play each other
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch { return null; } },
    setS: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} },
    setL: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  let token = (() => { try { return sessionStorage.getItem("cd-token"); } catch { return null; } })();
  if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.setS("cd-token", token); }

  // ---------- screens ----------
  const cards = ["joinCard", "lobbyCard", "overCard", "msgCard"];
  function showCard(name, dim = true) {
    cards.forEach((c) => ($(c).hidden = c !== name));
    $("overlay").classList.toggle("dim", !!name && dim);
  }

  $("nameInput").value = (() => { try { return localStorage.getItem("cd-name") || ""; } catch { return ""; } })();
  if (roomId) {
    $("joinBtn").textContent = "Join game";
    $("joinHint").textContent = "You were invited to a game.";
  }
  showCard("joinCard");

  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("nameInput").value.trim();
    if (!name) return;
    store.setL("cd-name", name);
    if (!roomId) {
      roomId = Math.random().toString(36).slice(2, 8);
      history.replaceState(null, "", `?room=${roomId}`);
    }
    myName = name;
    connect();
  });

  // ---------- map ----------
  const svg = d3.select("#map");
  const gRoot = svg.append("g");
  const gLand = gRoot.append("g");
  const gPin = gRoot.append("g").attr("class", "pin").style("display", "none");
  gPin.append("circle").attr("class", "ring").attr("r", 10);
  gPin.append("path").attr("class", "drop").attr("d", "M0 0C-9-12-13-18-13-26a13 13 0 0 1 26 0C13-18 9-12 0 0Z")
    .attr("fill", "#ff3b5c").attr("stroke", "#fff").attr("stroke-width", 2);
  gPin.append("circle").attr("cy", -26).attr("r", 5).attr("fill", "#fff");

  const projection = d3.geoNaturalEarth1();
  const path = d3.geoPath(projection);
  let W = 0, H = 0, features = [], featById = new Map(), paths, view, shown = null, animToken = 0;

  fetch("/data/countries-110m.json").then((r) => r.json()).then((topo) => {
    features = topojson.feature(topo, topo.objects.countries).features.filter((f) => f.id !== "010");
    featById = new Map(features.map((f) => [f.id, f]));
    paths = gLand.selectAll("path").data(features).join("path").attr("class", "land");
    layout();
    if (state) render();
  });

  function layout() {
    const r = $("stage").getBoundingClientRect();
    W = r.width; H = r.height;
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    projection.fitSize([W, H], { type: "Sphere" });
    if (paths) paths.attr("d", path);
    view = [W / 2, H / 2, W];
    applyView(view);
    if (shown && state && state.country) showCountry(state.country, true);
  }
  addEventListener("resize", layout);

  function applyView(v) {
    const k = W / v[2];
    gRoot.attr("transform", `translate(${W / 2},${H / 2}) scale(${k}) translate(${-v[0]},${-v[1]})`);
    return k;
  }

  function targetView(c) {
    const feat = featById.get(c.id);
    const cap = [c.lng, c.lat];
    const polys = feat.geometry.type === "Polygon" ? [feat.geometry.coordinates] : feat.geometry.coordinates;
    const pf = polys.map((p) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: p } }));
    let best = pf.find((p) => d3.geoContains(p, cap));
    if (!best) best = pf.reduce((a, b) => (d3.geoDistance(d3.geoCentroid(a), cap) <= d3.geoDistance(d3.geoCentroid(b), cap) ? a : b));
    const [[x0, y0], [x1, y1]] = path.bounds(best);
    const [px, py] = projection(cap);
    const ax = Math.min(x0, px), bx = Math.max(x1, px), ay = Math.min(y0, py), by = Math.max(y1, py);
    const minW = W / 5;
    let w = Math.max((bx - ax) * 2.2, minW);
    let h = Math.max((by - ay) * 2.2, minW * H / W);
    w = Math.max(w, h * W / H);
    return [(ax + bx) / 2, (ay + by) / 2, w];
  }

  function showCountry(c, instant = false) {
    if (!c || !paths) return;
    const token = ++animToken;
    shown = c.id;
    paths.classed("hi", (d) => d.id === c.id);
    gPin.style("display", "none");
    const target = targetView(c);
    const [px, py] = projection([c.lng, c.lat]);
    const place = () => {
      if (token !== animToken) return;
      gPin.style("display", null).attr("transform", `translate(${px},${py}) scale(${1 / (W / target[2])})`);
      // restart pin animations
      gPin.selectAll(".drop,.ring").style("animation", "none");
      void gPin.node().getBoundingClientRect();
      gPin.selectAll(".drop,.ring").style("animation", null);
    };
    gRoot.interrupt();
    if (instant) { view = target; applyView(view); place(); return; }
    const interp = d3.interpolateZoom(view, target);
    const dur = Math.max(900, Math.min(1500, interp.duration));
    gRoot.transition().duration(dur).ease(d3.easeCubicInOut)
      .tween("zoom", () => (t) => { view = interp(t); applyView(view); })
      .on("end", () => { view = target; place(); });
  }

  // ---------- network ----------
  let ws, state = null, offset = 0, joined = false, myName = "";

  function connect() {
    joined = true;
    showCard("msgCard");
    $("msgTitle").textContent = "Connecting…";
    $("msgSub").textContent = "";
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
    ws.onopen = () => ws.send(JSON.stringify({ t: "join", room: roomId, name: myName, token }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "state") {
        offset = m.serverNow - Date.now();
        state = m;
        render();
      } else if (m.t === "wrong") {
        wrong();
      } else if (m.t === "error") {
        joined = false;
        ws.onclose = null;
        $("joinHint").textContent = m.msg;
        showCard("joinCard");
      }
    };
    ws.onclose = () => {
      if (!joined) return;
      showCard("msgCard");
      $("msgTitle").textContent = "Connection lost";
      $("msgSub").textContent = "Reconnecting…";
      setTimeout(connect, 1000);
    };
  }

  const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
  const now = () => Date.now() + offset;

  // ---------- render ----------
  let lastRevealKey = null, lastPhase = null, toastTimer;

  function toast(text, kind, ms) {
    const t = $("toast");
    clearTimeout(toastTimer);
    t.textContent = text;
    t.className = `show ${kind}`;
    if (ms) toastTimer = setTimeout(() => (t.className = ""), ms);
  }

  function wrong() {
    const g = $("guess");
    g.classList.remove("shake");
    void g.offsetWidth;
    g.classList.add("shake");
    g.select();
    toast("Not quite", "bad", 700);
  }

  function render() {
    const s = state;
    const me = s.you, other = 1 - me;
    const P = s.players;

    // overlays
    if (s.phase === "lobby") {
      $("shareLink").value = `${location.origin}/?room=${s.room}`;
      showCard("lobbyCard");
    } else if (s.phase === "over") {
      renderOver();
    } else if (s.paused) {
      showCard("msgCard", false);
      $("msgTitle").textContent = "Opponent disconnected";
      $("msgSub").textContent = "Game paused — waiting up to 30s for them to return…";
    } else {
      showCard(null);
    }

    const inGame = s.phase !== "lobby";
    $("hud").hidden = !inGame;
    $("controls").hidden = !inGame;
    if (inGame) {
      [0, 1].forEach((i) => {
        const el = $("p" + i);
        el.querySelector(".pname").textContent = P[i] ? P[i].name : "—";
        el.classList.toggle("me", i === me);
        el.classList.toggle("off", P[i] && !P[i].connected);
      });
    }

    if (s.phase === "playing" || s.phase === "over") {
      if (s.country && (shown !== s.country.id || lastPhase === "lobby" || (lastPhase === "over" && s.phase === "playing"))) {
        showCountry(s.country, !shown);
      }
    }
    lastPhase = s.phase;

    // toasts
    const key = JSON.stringify(s.reveal) + P.map((p) => p.score).join(",");
    if (key !== lastRevealKey) {
      lastRevealKey = key;
      const r = s.reveal;
      if (r && r.kind === "correct") toast(`✓ ${r.text}`, "good", 1800);
      else if (r && r.kind === "skip") toast(`Skipped — it was ${r.text}`, "skip");
      else if (r && r.kind === "timeup") toast(`Time's up! It was ${r.text}`, "bad");
      else if ($("toast").className.includes("skip")) $("toast").className = "";
    }
    paint();
  }

  function renderOver() {
    const s = state, me = s.you, P = s.players;
    const won = s.winner === me;
    $("overTitle").textContent = s.winner == null ? "Game over" : won ? "You win! 🎉" : `${P[s.winner].name} wins`;
    const r = s.reveal;
    $("overSub").textContent = !r ? "" :
      r.kind === "forfeit" ? "Your opponent left the game." :
      `${P[1 - s.winner].name} ran out of time. The answer was ${r.text}.`;
    $("finalScore").innerHTML = P.map((p) => `<div>${esc(p.name)}<b>${p.score}</b></div>`).join("");
    $("rematch").disabled = P[me].rematch || P.some((p) => !p.connected);
    $("rematch").textContent = P[me].rematch ? "Waiting…" : "Rematch";
    $("rematchHint").textContent = P.some((p) => !p.connected) ? "Your opponent has left." : P[1 - me].rematch ? "Opponent wants a rematch!" : "";
    showCard("overCard", false);
    $("overlay").classList.add("dim");
  }

  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- clock + controls (runs every frame) ----------
  let wasEnabled = false;
  function tick() {
    paint();
    requestAnimationFrame(tick);
  }
  function paint() {
    const s = state;
    if (!s || s.phase === "lobby") return;
    const t = now();
    const running = s.phase === "playing" && !s.paused && s.runningSince != null;
    [0, 1].forEach((i) => {
      let rem = s.players[i].remaining;
      if (running && i === s.turn) rem -= Math.max(0, t - s.runningSince);
      rem = Math.max(0, rem);
      const el = $("p" + i);
      el.querySelector(".ptime").textContent = (rem / 1000).toFixed(1);
      el.querySelector(".pscore").textContent = `${s.players[i].score} correct`;
      el.classList.toggle("active", s.phase === "playing" && i === s.turn);
      el.classList.toggle("low", rem < 10000 && rem > 0 || (rem === 0 && s.phase === "over" && i === s.turn));
    });

    const live = running && t >= s.runningSince;
    const locked = t < s.lockedUntil;
    const myTurn = s.turn === s.you;
    const enabled = live && !locked && myTurn;
    $("guess").disabled = !enabled;
    $("skip").disabled = !enabled;
    document.querySelector("#guessForm .primary").disabled = !enabled;
    if (enabled && !wasEnabled) { $("guess").value = ""; $("guess").focus(); }
    if (!enabled) sug.hidden = true;
    wasEnabled = enabled;

    let msg = "";
    if (s.phase === "playing" && !s.paused) {
      const who = myTurn ? "Your" : s.players[s.turn].name + "'s";
      if (!live) msg = `${who} turn in ${Math.max(1, Math.ceil((s.runningSince - t) / 1000))}…`;
      else msg = myTurn ? "What is the capital of this country?" : `${s.players[s.turn].name} is guessing…`;
    }
    $("banner").textContent = msg;
  }

  // ---------- autocomplete ----------
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
  let names = [], sel = -1, matches = [];
  fetch("/api/capitals").then((r) => r.json()).then((n) => (names = n.map((x) => [x, norm(x)])));
  const sug = $("suggest");

  function suggest() {
    const q = norm($("guess").value).trim();
    sel = -1;
    if (!q || $("guess").disabled) matches = [];
    else {
      const starts = names.filter(([, n]) => n.startsWith(q));
      const words = names.filter(([, n]) => !n.startsWith(q) && n.split(" ").some((w) => w.startsWith(q)));
      const contains = names.filter(([, n]) => !n.startsWith(q) && !words.some((w) => w[0] === n) && n.includes(q));
      matches = [...starts, ...words, ...contains].slice(0, 6).map(([x]) => x);
    }
    sug.innerHTML = "";
    matches.forEach((m, i) => {
      const li = document.createElement("li");
      li.textContent = m;
      li.addEventListener("pointerdown", (e) => { e.preventDefault(); pick(i); });
      sug.appendChild(li);
    });
    sug.hidden = !matches.length;
  }
  function pick(i) {
    $("guess").value = matches[i];
    sug.hidden = true;
    matches = [];
    $("guess").focus();
  }
  function highlight() {
    [...sug.children].forEach((li, i) => li.classList.toggle("sel", i === sel));
  }
  $("guess").addEventListener("input", suggest);
  $("guess").addEventListener("blur", () => (sug.hidden = true));
  $("guess").addEventListener("keydown", (e) => {
    if (!matches.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % matches.length; highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + matches.length) % matches.length; highlight(); }
    else if (e.key === "Tab" && matches.length) { e.preventDefault(); pick(sel >= 0 ? sel : 0); }
    else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); pick(sel); }
  });

  // ---------- inputs ----------
  $("guessForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("guess").value.trim();
    if (!v || $("guess").disabled) return;
    sug.hidden = true;
    send({ t: "guess", text: v });
  });
  $("skip").addEventListener("click", () => !$("skip").disabled && send({ t: "skip" }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("skip").disabled) send({ t: "skip" });
  });
  $("rematch").addEventListener("click", () => send({ t: "rematch" }));
  $("copyBtn").addEventListener("click", async () => {
    const v = $("shareLink").value;
    try { await navigator.clipboard.writeText(v); } catch { $("shareLink").select(); document.execCommand("copy"); }
    $("copyBtn").textContent = "Copied!";
    setTimeout(() => ($("copyBtn").textContent = "Copy"), 1500);
  });
  $("shareLink").addEventListener("focus", (e) => e.target.select());
  tick();
})();
