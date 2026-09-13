/**
 * server.js
 *
 * CAPITALE - TikTok LIVE interactive capital-guessing game.
 *
 * Responsibilities:
 *  - Serve the game display page and the host control page
 *  - Connect to TikTok LIVE (via lib/tiktokClient.js) with required signing key + retries
 *  - Run the game (via lib/gameEngine.js): rounds, scoring, leaderboard
 *  - Broadcast live state to all connected browser tabs over WebSocket
 *  - Provide a fully self-contained Test Mode that needs no TikTok connection
 *  - Never crash: every handler is wrapped, plus process-level safety nets
 */

require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const { TikTokClient } = require("./lib/tiktokClient");
const { GameEngine, ROUND_SECONDS } = require("./lib/gameEngine");
const { extractChatFields } = require("./lib/extractFields");

// ---------------------------------------------------------------------------
// Process-level safety nets (requirement #5) -- one bad message, one bad
// event, or one unexpected rejection must NEVER take the whole server down.
// ---------------------------------------------------------------------------
process.on("uncaughtException", (err) => {
  console.error("[FATAL-CAUGHT] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL-CAUGHT] unhandledRejection:", reason);
});

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const SIGN_API_KEY = process.env.SIGN_API_KEY || "";
const DEFAULT_TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || "";

const game = new GameEngine();

const diagnostics = {
  rawEventCount: 0, // increments on EVERY raw event from TikTok, matched or not
  lastReceived: null, // { username, text, recognized, ts }
  connectionState: "idle", // idle | connecting | connected | retrying | failed | disconnected | streamEnded
  connectionMessage: "Not connected yet.",
  testMode: false,
  serverStartedAt: Date.now(),
};

let tiktokClient = null;
let testModeTimer = null;
let roundTimer = null;
let broadcastTimer = null;

// ---------------------------------------------------------------------------
// Express + static files
// ---------------------------------------------------------------------------
const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/host", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "host.html"));
});

app.get("/healthz", (req, res) => res.status(200).send("ok"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------------------------------------------------------------------------
// WebSocket broadcast helpers
// ---------------------------------------------------------------------------
function broadcast(obj) {
  const payload = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    try {
      if (client.readyState === 1) client.send(payload);
    } catch (err) {
      console.error("[ws] send error:", err);
    }
  });
}

function buildSnapshot() {
  return {
    type: "snapshot",
    diagnostics: {
      rawEventCount: diagnostics.rawEventCount,
      lastReceived: diagnostics.lastReceived,
      connectionState: diagnostics.connectionState,
      connectionMessage: diagnostics.connectionMessage,
      testMode: diagnostics.testMode,
      uptimeSec: Math.floor((Date.now() - diagnostics.serverStartedAt) / 1000),
    },
    round: game.getPublicRoundState(),
    roundSecondsTotal: ROUND_SECONDS,
    timeRemainingMs: game.timeRemainingMs(),
    leaderboard: game.getTopLeaderboard(10),
    difficulty: game.difficulty,
  };
}

function broadcastSnapshot() {
  try {
    broadcast(buildSnapshot());
  } catch (err) {
    console.error("[server] broadcastSnapshot error:", err);
  }
}

// ---------------------------------------------------------------------------
// Central "a chat-like message arrived" handler -- used by BOTH the real
// TikTok client and Test Mode, so the game logic is identical either way.
// ---------------------------------------------------------------------------
function handleIncomingChat(username, text, recognized) {
  try {
    diagnostics.rawEventCount += 1;
    diagnostics.lastReceived = {
      username: username || "(unknown)",
      text: text || "(empty)",
      recognized: Boolean(recognized),
      ts: Date.now(),
    };

    if (!recognized) return; // arrived but we couldn't parse a username+text out of it

    broadcast({ type: "chat", username, text, ts: Date.now() });

    const result = game.submitGuess(username, text);
    if (!result.ignored && result.entry) {
      broadcast({ type: "guess", entry: result.entry });
      if (result.roundSolved) {
        finishRound();
      }
    }
  } catch (err) {
    console.error("[server] handleIncomingChat error:", err);
  }
}

// ---------------------------------------------------------------------------
// TikTok connection lifecycle
// ---------------------------------------------------------------------------
function onTikTokEvent(eventType, rawData) {
  try {
    if (eventType !== "chat") {
      // Still counts toward "something arrived" diagnostics for non-chat
      // events (gifts/likes/etc.) but doesn't get parsed as a guess.
      return;
    }
    const fields = extractChatFields(rawData);
    handleIncomingChat(fields.username, fields.text, fields.isFullyRecognized);
  } catch (err) {
    console.error("[server] onTikTokEvent error:", err);
  }
}

function onTikTokStatus(status) {
  try {
    diagnostics.connectionState = status.state;
    diagnostics.connectionMessage = status.message;
    broadcastSnapshot();
  } catch (err) {
    console.error("[server] onTikTokStatus error:", err);
  }
}

async function connectToTikTok(username) {
  if (tiktokClient) {
    tiktokClient.disconnect();
  }
  tiktokClient = new TikTokClient({ signApiKey: SIGN_API_KEY }, onTikTokEvent, onTikTokStatus);
  try {
    await tiktokClient.connect(username);
  } catch (err) {
    // Already reported via onStatus; swallow here so server stays up.
    console.error("[server] connectToTikTok failed permanently:", err && err.message);
  }
}

function disconnectFromTikTok() {
  if (tiktokClient) {
    tiktokClient.disconnect();
  }
  diagnostics.connectionState = "disconnected";
  diagnostics.connectionMessage = "Disconnected by host.";
  broadcastSnapshot();
}

// ---------------------------------------------------------------------------
// Test Mode -- fully self-contained fake chat generator (requirement #8)
// ---------------------------------------------------------------------------
const FAKE_USERNAMES = [
  "geo_fan22", "quiz_wizard", "traveler.jane", "capital_king", "user48213",
  "mapmaster", "sunny_days", "roamer_x", "night_owl99", "curious_cat",
];
const FAKE_CHATTER = ["hi!", "lol", "GG", "let's go", "hmm", "🔥🔥🔥", "nice one", "wait what"];

function startTestMode() {
  if (testModeTimer) return;
  diagnostics.testMode = true;
  diagnostics.connectionState = "connected";
  diagnostics.connectionMessage = "Test Mode active (no live connection).";
  testModeTimer = setInterval(() => {
    try {
      const user = FAKE_USERNAMES[Math.floor(Math.random() * FAKE_USERNAMES.length)];
      const roll = Math.random();
      let text;
      if (game.round && !game.round.solved && roll < 0.2) {
        // Occasionally send the correct answer so hosts can see a full round resolve.
        text = game.round.target.country;
      } else if (roll < 0.7) {
        // A plausible-but-likely-wrong country/capital guess.
        const pool = game.getPool();
        text = pool[Math.floor(Math.random() * pool.length)].country;
      } else {
        // Non-guess chatter -- exercises the "arriving but not a guess" path.
        text = FAKE_CHATTER[Math.floor(Math.random() * FAKE_CHATTER.length)];
      }
      handleIncomingChat(user, text, true);
    } catch (err) {
      console.error("[testMode] tick error:", err);
    }
  }, 1800);
  broadcastSnapshot();
}

function stopTestMode() {
  if (testModeTimer) {
    clearInterval(testModeTimer);
    testModeTimer = null;
  }
  diagnostics.testMode = false;
  diagnostics.connectionState = "idle";
  diagnostics.connectionMessage = "Test Mode stopped.";
  broadcastSnapshot();
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------
function beginRound() {
  game.startRound();
  broadcast({ type: "roundStarted", round: game.getPublicRoundState() });
  broadcastSnapshot();

  if (roundTimer) clearTimeout(roundTimer);
  roundTimer = setTimeout(() => {
    if (game.round && !game.round.ended) finishRound();
  }, ROUND_SECONDS * 1000 + 200);
}

function finishRound() {
  if (roundTimer) {
    clearTimeout(roundTimer);
    roundTimer = null;
  }
  const summary = game.endRound();
  broadcast({ type: "roundEnded", summary, leaderboard: game.getTopLeaderboard(10) });
  broadcastSnapshot();
}

// ---------------------------------------------------------------------------
// WebSocket connection handling (host controls arrive here)
// ---------------------------------------------------------------------------
wss.on("connection", (ws) => {
  try {
    ws.send(JSON.stringify(buildSnapshot()));
  } catch (err) {
    console.error("[ws] initial snapshot send error:", err);
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleHostMessage(msg, ws);
    } catch (err) {
      console.error("[ws] message handling error:", err);
    }
  });

  ws.on("error", (err) => {
    console.error("[ws] client socket error:", err);
  });
});

function handleHostMessage(msg, ws) {
  const type = msg && msg.type;
  try {
    switch (type) {
      case "host:connectTikTok":
        stopTestMode();
        connectToTikTok(String(msg.username || "").replace(/^@/, "").trim());
        break;

      case "host:disconnectTikTok":
        disconnectFromTikTok();
        break;

      case "host:toggleTestMode":
        if (msg.enabled) {
          disconnectFromTikTok();
          startTestMode();
        } else {
          stopTestMode();
        }
        break;

      case "host:startRound":
        beginRound();
        break;

      case "host:skipRound":
        finishRound();
        break;

      case "host:giveHint": {
        const hint = game.giveHint();
        broadcast({ type: "hint", hintText: hint });
        broadcastSnapshot();
        break;
      }

      case "host:setDifficulty":
        game.setDifficulty(msg.level);
        broadcastSnapshot();
        break;

      case "host:testComment":
        // The host typing a message themselves -- treated exactly like a
        // real viewer comment so the host can test or jump in and answer.
        handleIncomingChat(msg.username || "Host", String(msg.text || ""), true);
        break;

      case "host:resetGame":
        stopTestMode();
        disconnectFromTikTok();
        if (roundTimer) clearTimeout(roundTimer);
        game.resetAll();
        diagnostics.rawEventCount = 0;
        diagnostics.lastReceived = null;
        broadcastSnapshot();
        break;

      default:
        console.warn("[ws] unknown message type:", type);
    }
  } catch (err) {
    console.error("[server] handleHostMessage error for type", type, err);
  }
}

// ---------------------------------------------------------------------------
// Periodic snapshot heartbeat (drives the on-screen round timer smoothly)
// ---------------------------------------------------------------------------
broadcastTimer = setInterval(broadcastSnapshot, 1000);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  console.log(`CAPITALE server listening on port ${PORT}`);
  console.log(`Display page:  http://localhost:${PORT}/`);
  console.log(`Host page:     http://localhost:${PORT}/host`);
  if (!SIGN_API_KEY) {
    console.warn(
      "[WARNING] SIGN_API_KEY is not set. TikTok LIVE connection will fail " +
      "until you set it. Test Mode still works without it."
    );
  }
  if (DEFAULT_TIKTOK_USERNAME) {
    console.log(`A default TikTok username is configured: @${DEFAULT_TIKTOK_USERNAME}`);
  }
});
