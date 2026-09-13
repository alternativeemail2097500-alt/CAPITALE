(function () {
  const RING_CIRCUMFERENCE = 169.6;

  const els = {
    connBadge: document.getElementById("connBadge"),
    connText: document.getElementById("connText"),
    timerRing: document.getElementById("timerRing"),
    timerNum: document.getElementById("timerNum"),
    roundLabel: document.getElementById("roundLabel"),
    continentLabel: document.getElementById("continentLabel"),
    promptLabel: document.getElementById("promptLabel"),
    hintBox: document.getElementById("hintBox"),
    chatFeed: document.getElementById("chatFeed"),
    leaderboard: document.getElementById("leaderboard"),
    winnerBanner: document.getElementById("winnerBanner"),
    winnerName: document.getElementById("winnerName"),
    winnerPoints: document.getElementById("winnerPoints"),
    winnerAnswer: document.getElementById("winnerAnswer"),
    difficultyLabel: document.getElementById("difficultyLabel"),
  };

  let winnerHideTimeout = null;

  function renderConnection(state) {
    els.connBadge.className = `badge state-${state}`;
    const labels = {
      idle: "Idle",
      connecting: "Connecting…",
      connected: "Live",
      retrying: "Reconnecting…",
      failed: "Connection failed",
      disconnected: "Disconnected",
      streamEnded: "Stream ended",
      error: "Error",
    };
    els.connText.textContent = labels[state] || state;
  }

  function renderTimer(msRemaining, msTotal) {
    const totalSec = Math.round(msTotal / 1000) || 45;
    const remSec = Math.max(0, Math.ceil(msRemaining / 1000));
    els.timerNum.textContent = msTotal ? remSec : "--";
    const frac = msTotal ? Math.max(0, msRemaining / msTotal) : 0;
    const offset = RING_CIRCUMFERENCE * (1 - frac);
    els.timerRing.style.strokeDashoffset = offset.toFixed(1);
    els.timerRing.classList.toggle("low", msTotal > 0 && remSec <= 10);
  }

  function renderRound(round, difficulty) {
    els.difficultyLabel.textContent = difficulty === "easy" ? "Easy (well-known countries)" : "All countries";

    if (!round) {
      els.roundLabel.textContent = "Waiting for host to start a round";
      els.continentLabel.textContent = "";
      els.promptLabel.textContent = "Guess the capital city!";
      els.hintBox.style.display = "none";
      return;
    }

    if (round.solved) {
      els.roundLabel.textContent = "Round solved!";
    } else {
      els.roundLabel.textContent = "Round in progress — guess in chat!";
    }

    const t = round.target;
    els.continentLabel.textContent = t.continent ? `Continent: ${t.continent}` : "";
    if (t.country) {
      els.promptLabel.textContent = `The answer was: ${t.country} (${t.capital})`;
    } else if (t.lettersInCountry) {
      els.promptLabel.textContent = `Which country's capital is this? (${t.lettersInCountry} letters)`;
    } else {
      els.promptLabel.textContent = "Guess the capital city!";
    }

    if (round.hintText) {
      els.hintBox.style.display = "block";
      els.hintBox.textContent = `💡 ${round.hintText}`;
    } else {
      els.hintBox.style.display = "none";
    }
  }

  function addChatLine(username, text) {
    const line = document.createElement("div");
    line.className = "chat-line";
    line.innerHTML = `<b>${escapeHtml(username)}</b>: ${escapeHtml(text)}`;
    els.chatFeed.prepend(line);
    while (els.chatFeed.children.length > 40) {
      els.chatFeed.removeChild(els.chatFeed.lastChild);
    }
  }

  function addGuessResult(entry) {
    const line = document.createElement("div");
    line.className = "chat-line" + (entry.correct ? " correct" : "");
    let chip = "";
    if (entry.correct) {
      chip = `<span class="chip">✅ Correct!</span>`;
    } else if (entry.distanceKm !== null && entry.distanceKm !== undefined) {
      chip = `<span class="chip">${entry.distanceKm.toLocaleString()} km ${entry.direction || ""}</span>`;
    }
    line.innerHTML = `<b>${escapeHtml(entry.username)}</b>: ${escapeHtml(entry.text)} ${chip}`;
    els.chatFeed.prepend(line);
    while (els.chatFeed.children.length > 40) {
      els.chatFeed.removeChild(els.chatFeed.lastChild);
    }
  }

  function renderLeaderboard(list) {
    if (!list || list.length === 0) {
      els.leaderboard.innerHTML = `<div class="lb-empty">No scores yet — first correct guess kicks things off!</div>`;
      return;
    }
    els.leaderboard.innerHTML = list
      .map((p, i) => {
        const rankClass = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
        const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1;
        return `<div class="lb-row ${rankClass}">
          <div class="lb-rank">${medal}</div>
          <div class="lb-name">${escapeHtml(p.username)}</div>
          <div class="lb-score">${p.score} pts</div>
        </div>`;
      })
      .join("");
  }

  function showWinnerBanner(summary) {
    if (!summary || !summary.solved) return;
    els.winnerName.textContent = summary.winner;
    els.winnerPoints.textContent = `+${summary.pointsAwarded} points`;
    els.winnerAnswer.textContent = `${summary.target.country} — ${summary.target.capital}`;
    els.winnerBanner.classList.remove("hidden");
    if (winnerHideTimeout) clearTimeout(winnerHideTimeout);
    winnerHideTimeout = setTimeout(() => {
      els.winnerBanner.classList.add("hidden");
    }, 4500);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str == null ? "" : str);
    return div.innerHTML;
  }

  const socket = createGameSocket(
    (msg) => {
      switch (msg.type) {
        case "snapshot":
          renderConnection(msg.diagnostics.connectionState);
          renderTimer(msg.timeRemainingMs, msg.round ? msg.roundSecondsTotal * 1000 : 0);
          renderRound(msg.round, msg.difficulty);
          renderLeaderboard(msg.leaderboard);
          break;
        case "chat":
          addChatLine(msg.username, msg.text);
          break;
        case "guess":
          addGuessResult(msg.entry);
          break;
        case "roundStarted":
          els.winnerBanner.classList.add("hidden");
          break;
        case "roundEnded":
          showWinnerBanner(msg.summary);
          renderLeaderboard(msg.leaderboard);
          break;
        case "hint":
          els.hintBox.style.display = "block";
          els.hintBox.textContent = `💡 ${msg.hintText}`;
          break;
      }
    },
    (isOpen) => {
      if (!isOpen) renderConnection("disconnected");
    }
  );
})();
