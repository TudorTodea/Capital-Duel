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
  const cards = ["joinCard", "lobbyCard", "overCard", "mOverCard", "msgCard"];
  function showCard(name, dim = true) {
    cards.forEach((c) => ($(c).hidden = c !== name));
    $("overlay").classList.toggle("dim", !!name && dim);
  }

  $("nameInput").value = (() => { try { return localStorage.getItem("cd-name") || ""; } catch { return ""; } })();
  let pickedMode = "capitals";
  if (roomId) {
    $("joinBtn").textContent = "Join game";
    $("joinHint").textContent = "You were invited to a game.";
    $("modepick").hidden = true; // the room creator already chose the mode
  } else {
    $("modepick").addEventListener("click", (e) => {
      const btn = e.target.closest(".mode");
      if (!btn) return;
      pickedMode = btn.dataset.mode;
      [...$("modepick").children].forEach((b) => b.classList.toggle("active", b === btn));
      $("joinSub").textContent =
        pickedMode === "flags" ? "Two players. 60 seconds each. Name the country shown." :
        pickedMode === "millionaire" ? "Team up, chat it out, and see how far you can climb together 💕" :
        "Two players. 60 seconds each. Name the capital.";
    });
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

  // ---------- flag ----------
  const flagWrap = $("flagWrap"), flagImg = $("flagImg");
  let shownFlag = null;
  function showFlag(c) {
    if (!c) return;
    shownFlag = c.id;
    flagImg.style.animation = "none";
    flagImg.src = `/vendor/flags/4x3/${c.cca2.toLowerCase()}.svg`;
    void flagImg.offsetWidth;
    flagImg.style.animation = "";
  }

  // ---------- network ----------
  let ws, state = null, offset = 0, joined = false, myName = "";

  function connect() {
    joined = true;
    showCard("msgCard");
    $("msgTitle").textContent = "Connecting…";
    $("msgSub").textContent = "";
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
    ws.onopen = () => ws.send(JSON.stringify({ t: "join", room: roomId, name: myName, token, mode: pickedMode }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "state") {
        offset = m.serverNow - Date.now();
        state = m;
        render();
      } else if (m.t === "wrong") {
        wrong();
      } else if (m.t === "chat") {
        addChatBubble(m.msg);
      } else if (m.t === "chatHistory") {
        $("mChatLog").innerHTML = "";
        m.chat.forEach((c) => addChatBubble(c, true));
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
  let lastRevealKey = null, lastPhase = null;

  function makeToaster(id) {
    const el = $(id);
    let timer;
    return (text, kind, ms) => {
      clearTimeout(timer);
      el.textContent = text;
      el.className = `toastbubble show ${kind}`;
      if (ms) timer = setTimeout(() => (el.className = "toastbubble"), ms);
    };
  }
  const toast = makeToaster("toast");
  const mToast = makeToaster("mToast");

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
    const isM = s.mode === "millionaire";
    const newRound = lastPhase === "lobby" || (lastPhase === "over" && s.phase === "playing");
    lastPhase = s.phase;

    // overlays
    if (s.phase === "lobby") {
      $("shareLink").value = `${location.origin}/?room=${s.room}`;
      $("lobbyTitle").textContent = isM ? "Waiting for your partner 💕" : "Waiting for opponent…";
      showCard("lobbyCard");
    } else if (s.phase === "over") {
      isM ? renderMillionaireOver() : renderOver();
    } else if (s.paused) {
      showCard("msgCard", false);
      $("msgTitle").textContent = isM ? "Your partner stepped away" : "Opponent disconnected";
      $("msgSub").textContent = `Game paused — waiting up to 30s for ${isM ? "them to come back" : "them to return"}…`;
    } else {
      showCard(null);
    }

    const inGame = s.phase !== "lobby";
    $("stage").hidden = isM;
    $("hud").hidden = !inGame || isM;
    $("controls").hidden = !inGame || isM;
    $("mStage").hidden = !inGame || !isM;
    if (isM) { renderMillionaire(s, newRound); return; }

    const me = s.you;
    const P = s.players;
    $("guess").placeholder = s.mode === "flags" ? "Country name…" : "Capital city…";
    if (inGame) {
      [0, 1].forEach((i) => {
        const el = $("p" + i);
        el.querySelector(".pname").textContent = P[i] ? P[i].name : "—";
        el.classList.toggle("me", i === me);
        el.classList.toggle("off", P[i] && !P[i].connected);
      });
    }

    const isFlags = s.mode === "flags";
    flagWrap.hidden = !isFlags;
    $("map").style.display = isFlags ? "none" : "";
    if (s.phase === "playing" || s.phase === "over") {
      if (s.country && isFlags && (shownFlag !== s.country.id || newRound)) showFlag(s.country);
      if (s.country && !isFlags && (shown !== s.country.id || newRound)) showCountry(s.country, !shown);
    }

    // toasts
    const key = JSON.stringify(s.reveal) + P.map((p) => p.score).join(",");
    if (key !== lastRevealKey) {
      lastRevealKey = key;
      const r = s.reveal;
      if (r && r.kind === "correct") toast(`✓ ${r.text}`, "good", 1800);
      else if (r && r.kind === "skip") toast(`Skipped — it was ${r.text}`, "skip");
      else if (r && r.kind === "timeup") toast(`Time's up! It was ${r.text}`, "bad");
      else if ($("toast").className.includes("skip")) $("toast").className = "toastbubble";
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

  // ---------- millionaire ----------
  const LADDER = [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 250000, 500000, 1000000];
  const MILESTONES = [4, 9];
  const money = (n) => "$" + n.toLocaleString("en-US");
  const optBtns = [...document.querySelectorAll("#mOptions .opt")];

  $("mLadder").innerHTML = LADDER.map((amt, i) => `<div class="rung${MILESTONES.includes(i) ? " milestone" : ""}" data-i="${i}">${i + 1}. ${money(amt)}</div>`).join("");
  const rungs = [...$("mLadder").children];

  let mRenderedQIndex = null, mScrolledQIndex = null, lastMRevealKey = null;

  function renderMillionaire(s, newRound) {
    const m = s.millionaire;
    if (newRound) mRenderedQIndex = mScrolledQIndex = lastMRevealKey = null;

    rungs.forEach((el, i) => {
      el.classList.toggle("done", i < m.qIndex);
      el.classList.toggle("current", i === m.qIndex && s.phase === "playing");
    });
    if (m.qIndex !== mScrolledQIndex) {
      mScrolledQIndex = m.qIndex;
      rungs[Math.min(m.qIndex, rungs.length - 1)]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }

    if (s.phase !== "playing") return; // frozen on the last question's colors, under the dim over-card

    $("mAmountLabel").textContent = `Question ${m.qIndex + 1} of ${LADDER.length}`;
    $("mAmount").textContent = money(LADDER[m.qIndex]);

    if (m.question && mRenderedQIndex !== m.qIndex) {
      mRenderedQIndex = m.qIndex;
      $("mQText").textContent = m.question.text;
      optBtns.forEach((btn, i) => { btn.className = "opt"; btn.querySelector(".optText").textContent = m.question.options[i]; });
      $("mToast").className = "toastbubble";
    }

    optBtns.forEach((btn, i) => btn.classList.toggle("eliminated", m.eliminated.includes(i)));

    const mKey = JSON.stringify(m.reveal);
    if (mKey !== lastMRevealKey) {
      lastMRevealKey = mKey;
      if (m.reveal) mToast(m.reveal.correct ? `✅ Correct! +${money(m.reveal.amount)}` : "❌ Not this time…", m.reveal.correct ? "good" : "bad", 2000);
    }
    if (m.reveal) {
      optBtns[m.reveal.option]?.classList.add("chosen", m.reveal.correct ? "correct" : "wrong");
      if (!m.reveal.correct) optBtns[m.reveal.answer]?.classList.add("correct");
    }

    const locked = m.pending || s.phase !== "playing" || s.paused;
    optBtns.forEach((btn, i) => (btn.disabled = locked || m.eliminated.includes(i)));
    $("mFifty").disabled = locked || !m.lifeline.fifty;
    $("mWalk").disabled = locked || m.qIndex === 0;
  }

  function renderMillionaireOver() {
    const s = state, me = s.you, P = s.players, m = s.millionaire;
    const titles = { won: "🏆 You're Love Millionaires!", lost: "💔 So close!", walked: "💝 Nicely banked!", left: "👋 Round ended" };
    const subs = {
      won: "You answered every question together.",
      lost: "Don't worry — you can always try again.",
      walked: "You two decided to walk away together.",
      left: "Your partner left before the round finished.",
    };
    $("mOverTitle").textContent = titles[m.outcome] || "Game over";
    $("mOverSub").textContent = subs[m.outcome] || "";
    $("mWonAmt").textContent = money(m.wonAmount);
    $("mRematch").disabled = P[me].rematch || P.some((p) => !p.connected);
    $("mRematch").textContent = P[me].rematch ? "Waiting…" : "Play again";
    $("mRematchHint").textContent = P.some((p) => !p.connected) ? "Your partner has left." : P[1 - me].rematch ? "Your partner wants to play again!" : "";
    showCard("mOverCard", false);
    $("overlay").classList.add("dim");
  }

  // ---------- millionaire: chat ----------
  let chatOpen = false, unread = 0;
  function openChat() {
    chatOpen = true; unread = 0;
    $("mChatBadge").hidden = true;
    $("mChatScrim").hidden = false;
    $("mChatDrawer").hidden = false;
    $("mChatLog").scrollTop = $("mChatLog").scrollHeight;
    $("mChatInput").focus();
  }
  function closeChat() {
    chatOpen = false;
    $("mChatScrim").hidden = true;
    $("mChatDrawer").hidden = true;
  }
  function addChatBubble(msg, silent = false) {
    const log = $("mChatLog");
    const div = document.createElement("div");
    if (msg.sys) {
      div.className = "cmsg sys";
      div.textContent = msg.text;
    } else {
      div.className = `cmsg ${msg.by === state?.you ? "me" : ""}`;
      div.innerHTML = `<span class="cname">${esc(msg.name)}</span>${esc(msg.text)}`;
    }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    if (!chatOpen && !msg.sys && !silent) {
      unread++;
      $("mChatBadge").textContent = unread;
      $("mChatBadge").hidden = false;
    }
  }
  $("mChatBtn").addEventListener("click", openChat);
  $("mChatClose").addEventListener("click", closeChat);
  $("mChatScrim").addEventListener("click", closeChat);
  $("mChatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("mChatInput").value.trim();
    if (!v) return;
    send({ t: "chat", text: v });
    $("mChatInput").value = "";
  });
  optBtns.forEach((btn) => btn.addEventListener("click", () => !btn.disabled && send({ t: "answer", option: Number(btn.dataset.i) })));
  $("mFifty").addEventListener("click", () => !$("mFifty").disabled && send({ t: "lifeline", which: "fifty" }));
  $("mWalk").addEventListener("click", () => !$("mWalk").disabled && send({ t: "walk" }));
  $("mRematch").addEventListener("click", () => send({ t: "rematch" }));

  // ---------- clock + controls (runs every frame, duel modes only) ----------
  let wasEnabled = false;
  function tick() {
    paint();
    requestAnimationFrame(tick);
  }
  function paint() {
    const s = state;
    if (!s || s.phase === "lobby" || s.mode === "millionaire") return;
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
      else if (myTurn) msg = s.mode === "flags" ? "Which country is this?" : "What is the capital of this country?";
      else msg = `${s.players[s.turn].name} is guessing…`;
    }
    $("banner").textContent = msg;
  }

  // ---------- autocomplete ----------
  const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
  let nameLists = { capitals: [], countries: [] }, sel = -1, matches = [];
  fetch("/api/names").then((r) => r.json()).then((d) => {
    nameLists.capitals = d.capitals.map((x) => [x, norm(x)]);
    nameLists.countries = d.countries.map((x) => [x, norm(x)]);
  });
  const sug = $("suggest");

  function suggest() {
    const q = norm($("guess").value).trim();
    const names = nameLists[state && state.mode === "flags" ? "countries" : "capitals"];
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
