(function () {
  const el = (id) => document.getElementById(id);

  const els = {
    connBadge: el("connBadge"),
    connText: el("connText"),
    diagCount: el("diagCount"),
    diagConn: el("diagConn"),
    diagLast: el("diagLast"),
    usernameInput: el("usernameInput"),
    connectBtn: el("connectBtn"),
    disconnectBtn: el("disconnectBtn"),
    connMsg: el("connMsg"),
    testModeToggle: el("testModeToggle"),
    roundStatus: el("roundStatus"),
    timerText: el("timerText"),
    answerReveal: el("answerReveal"),
    hintLog: el("hintLog"),
    diffAll: el("diffAll"),
    diffEasy: el("diffEasy"),
    hostNameInput: el("hostNameInput"),
    hostTextInput: el("hostTextInput"),
    hostSendBtn: el("hostSendBtn"),
    guessLog: el("guessLog"),
    miniLeaderboard: el("miniLeaderboard"),
    startRoundBtn: el("startRoundBtn"),
    hintBtn: el("hintBtn"),
    skipRoundBtn: el("skipRoundBtn"),
    resetBtn: el("resetBtn"),
  };

  const CONN_LABELS = {
    idle: "Idle",
    connecting: "Connecting…",
    connected: "Live",
    retrying: "Reconnecting…",
    failed: "Connection failed",
    disconnected: "Disconnected",
    streamEnded: "Stream ended",
    error: "Error",
  };

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str == null ? "" : str);
    return div.innerHTML;
  }

  function renderDiagnostics(diag) {
    els.diagCount.textContent = diag.rawEventCount;
    els.diagConn.textContent = CONN_LABELS[diag.connectionState] || diag.connectionState;
    els.connBadge.className = `badge state-${diag.connectionState}`;
    els.connText.textContent = CONN_LABELS[diag.connectionState] || diag.connectionState;
    els.connMsg.textContent = diag.connectionMessage || "";
    if (diag.lastReceived) {
      const r = diag.lastReceived;
      const tag = r.recognized ? "" : " (not recognized as a guess)";
      els.diagLast.textContent = `${r.username}: "${r.text}"${tag}`;
    } else {
      els.diagLast.textContent = "Nothing yet";
    }
    els.testModeToggle.checked = Boolean(diag.testMode);
  }

  function renderRound(round, timeRemainingMs, roundSecondsTotal) {
    if (!round) {
      els.roundStatus.textContent = "No round active";
      els.timerText.textContent = "";
      els.answerReveal.style.display = "none";
      return;
    }
    els.roundStatus.textContent = round.solved ? `Solved by ${round.winner}` : "Round in progress";
    const remSec = Math.max(0, Math.ceil(timeRemainingMs / 1000));
    els.timerText.textContent = round.solved ? "" : `${remSec}s left`;

    if (round.target && round.target.country) {
      els.answerReveal.style.display = "block";
      els.answerReveal.textContent = `Answer: ${round.target.country} — ${round.target.capital}`;
    } else {
      els.answerReveal.style.display = "none";
    }
    els.hintLog.textContent = round.hintText ? `💡 ${round.hintText}` : "";
  }

  function renderGuessLog(entries) {
    if (!entries || entries.length === 0) {
      els.guessLog.innerHTML = `<div class="small-note">No guesses yet.</div>`;
      return;
    }
    els.guessLog.innerHTML = entries
      .map((e) => {
        const detail = e.correct
          ? "✅ correct"
          : e.distanceKm != null
          ? `${e.distanceKm.toLocaleString()} km ${e.direction || ""}`
          : "not a country/capital";
        return `<div class="guess-row ${e.correct ? "correct" : ""}"><b>${escapeHtml(e.username)}</b>: ${escapeHtml(e.text)} — ${detail}</div>`;
      })
      .join("");
  }

  function renderMiniLeaderboard(list) {
    if (!list || list.length === 0) {
      els.miniLeaderboard.innerHTML = `<div class="small-note">No scores yet.</div>`;
      return;
    }
    els.miniLeaderboard.innerHTML = list
      .map((p, i) => `<div class="mini-lb-row"><span>${i + 1}. ${escapeHtml(p.username)}</span><span>${p.score} pts</span></div>`)
      .join("");
  }

  const socket = createGameSocket(
    (msg) => {
      switch (msg.type) {
        case "snapshot":
          renderDiagnostics(msg.diagnostics);
          renderRound(msg.round, msg.timeRemainingMs, msg.roundSecondsTotal);
          renderGuessLog(msg.round ? msg.round.guesses : []);
          renderMiniLeaderboard(msg.leaderboard);
          break;
        case "roundEnded":
          renderMiniLeaderboard(msg.leaderboard);
          break;
      }
    },
    (isOpen) => {
      if (!isOpen) {
        els.connText.textContent = "Page disconnected — reconnecting…";
      }
    }
  );

  els.connectBtn.addEventListener("click", () => {
    const username = els.usernameInput.value.trim();
    if (!username) {
      els.connMsg.textContent = "Type a TikTok username first.";
      return;
    }
    socket.send({ type: "host:connectTikTok", username });
  });

  els.disconnectBtn.addEventListener("click", () => {
    socket.send({ type: "host:disconnectTikTok" });
  });

  els.testModeToggle.addEventListener("change", () => {
    socket.send({ type: "host:toggleTestMode", enabled: els.testModeToggle.checked });
  });

  els.startRoundBtn.addEventListener("click", () => socket.send({ type: "host:startRound" }));
  els.hintBtn.addEventListener("click", () => socket.send({ type: "host:giveHint" }));
  els.skipRoundBtn.addEventListener("click", () => socket.send({ type: "host:skipRound" }));
  els.resetBtn.addEventListener("click", () => {
    if (confirm("Reset the whole game? This clears the leaderboard.")) {
      socket.send({ type: "host:resetGame" });
    }
  });

  els.diffAll.addEventListener("click", () => socket.send({ type: "host:setDifficulty", level: "all" }));
  els.diffEasy.addEventListener("click", () => socket.send({ type: "host:setDifficulty", level: "easy" }));

  function sendHostComment() {
    const text = els.hostTextInput.value.trim();
    if (!text) return;
    const username = els.hostNameInput.value.trim() || "Host";
    socket.send({ type: "host:testComment", username, text });
    els.hostTextInput.value = "";
  }
  els.hostSendBtn.addEventListener("click", sendHostComment);
  els.hostTextInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendHostComment();
  });
})();
