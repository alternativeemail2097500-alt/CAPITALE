// ===================================================================
// CAPITALE LIVE — game module
// Registered on its own Socket.IO namespace ("/capitale"). Mirrors
// Flagle's per-socket session model (each connected browser tab gets its
// own independent TikTok connection, round state, and scores), so
// multiple hosts can each run their own Capitale session simultaneously
// from the same deployed link.
// ===================================================================

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { TikTokLiveConnection, WebcastEvent, SignConfig } from "tiktok-live-connector";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.TIKTOK_SIGN_API_KEY) {
  SignConfig.apiKey = process.env.TIKTOK_SIGN_API_KEY;
}
const HAS_SIGN_KEY = Boolean(process.env.TIKTOK_SIGN_API_KEY);

const COUNTRIES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "public", "capitale", "capitals.json"), "utf8")
);

// ---------------------------------------------------------------------
// Text matching: normalize + alias lookup + small typo tolerance.
// Every guess is checked against BOTH the country name and its capital
// city name, plus each country's alias list (e.g. "usa", "holland").
// ---------------------------------------------------------------------
function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

const LOOKUP = [];
for (const rec of COUNTRIES) {
  LOOKUP.push({ norm: normalize(rec.country), rec });
  LOOKUP.push({ norm: normalize(rec.capital), rec });
  for (const alias of rec.aliases || []) {
    LOOKUP.push({ norm: normalize(alias), rec });
  }
}

function maxDistFor(len) {
  return len <= 4 ? 0 : len <= 7 ? 1 : 2;
}

function resolveGuess(text) {
  const norm = normalize(text);
  if (!norm || norm.length < 2) return null;
  for (const entry of LOOKUP) {
    if (entry.norm === norm) return entry.rec;
  }
  let best = null, bestDist = Infinity;
  for (const entry of LOOKUP) {
    const d = levenshtein(norm, entry.norm);
    if (d <= maxDistFor(entry.norm.length) && d < bestDist) {
      best = entry.rec;
      bestDist = d;
    }
  }
  return best;
}

function toRad(d) { return (d * Math.PI) / 180; }

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function bearingCompass(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;
  const dirs = ["North", "North East", "East", "South East", "South", "South West", "West", "North West"];
  return { compass: dirs[Math.round(brng / 45) % 8], degrees: brng };
}

// Curated pool for "Easy" difficulty.
const EASY_NAMES = new Set([
  "United States", "United Kingdom", "France", "Germany", "Italy", "Spain",
  "Japan", "China", "India", "Russia", "Canada", "Australia", "Brazil",
  "Mexico", "Egypt", "South Korea", "North Korea", "Thailand", "Vietnam",
  "Greece", "Turkey", "South Africa", "Nigeria", "Kenya", "Argentina",
  "Netherlands", "Portugal", "Switzerland", "Sweden", "Norway", "Poland",
  "Indonesia", "Philippines", "Saudi Arabia", "Iran", "Iraq", "Israel",
  "New Zealand", "Ireland", "Cuba", "Colombia", "Peru", "Chile",
  "Ukraine", "Austria", "Belgium", "Morocco", "Pakistan", "Bangladesh",
]);

const ROUND_SECONDS = 45;
const ROUND_SECONDS_TEST = 15;
const REVEAL_PAUSE_MS = 6000;
const AUTO_LETTER_REVEAL_MS = 5000; // one extra letter unlocked automatically this often
const TEST_FAKE_GUESS_MS = 2200;

const FAKE_USERNAMES = ["geo_fan22", "quiz_wizard", "traveler.jane", "capital_king", "mapmaster", "sunny_days", "roamer_x", "curious_cat"];
const FAKE_CHATTER = ["hi!", "lol", "GG", "let's go", "hmm", "🔥🔥🔥", "nice one", "wait what"];

function topN(map, n = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function newSession(socket) {
  return {
    socket,
    mode: "live",
    difficulty: "all",
    tiktokConnection: null,
    tiktokUsername: null,
    scores: new Map(),
    streaks: new Map(),
    likes: new Map(),
    gifts: new Map(),
    usedCountries: new Set(),
    round: null,
    roundActive: false,
    fakeGuessTimer: null,
    commentsSeen: 0,
  };
}

function pool(session) {
  if (session.difficulty === "easy") {
    const p = COUNTRIES.filter((c) => EASY_NAMES.has(c.country));
    return p.length ? p : COUNTRIES;
  }
  return COUNTRIES;
}

function pickCountry(session) {
  const p = pool(session);
  let available = p.filter((c) => !session.usedCountries.has(c.country));
  if (available.length === 0) {
    session.usedCountries.clear();
    available = p;
  }
  const country = available[Math.floor(Math.random() * available.length)];
  session.usedCountries.add(country.country);
  return country;
}

function leaderboard(session) {
  return topN(session.scores).map(([username, score]) => ({ username, score }));
}

function fanStats(session) {
  return {
    likes: topN(session.likes).map(([username, count]) => ({ username, count })),
    gifts: topN(session.gifts).map(([username, value]) => ({ username, value })),
  };
}

// Builds the blank-tile representation of the country name, e.g.
// "United States" -> "_ _ _ _ _ _   _ _ _ _ _ _" with revealed indices filled in.
function buildTiles(name, revealedIdx) {
  return name
    .split("")
    .map((ch, i) => {
      if (ch === " ") return " ";
      if (ch === "-") return "-";
      return revealedIdx.has(i) ? ch : "_";
    })
    .join("");
}

function clearRoundTimer(session) {
  if (session.round) {
    if (session.round.timer) clearTimeout(session.round.timer);
    if (session.round.letterTimer) clearInterval(session.round.letterTimer);
  }
}

function clearFakeGuessTimer(session) {
  if (session.fakeGuessTimer) {
    clearInterval(session.fakeGuessTimer);
    session.fakeGuessTimer = null;
  }
}

function startRound(session) {
  clearRoundTimer(session);
  const country = pickCountry(session);
  const roundSeconds = session.mode === "test" ? ROUND_SECONDS_TEST : ROUND_SECONDS;
  const revealedIdx = new Set();

  session.round = {
    country,
    revealedIdx,
    guessCount: 0,
    hintsGiven: 0,
    startedAt: Date.now(),
    closestKm: null,
  };
  session.roundActive = true;

  session.socket.emit("round-start", {
    continent: country.continent,
    tiles: buildTiles(country.country, revealedIdx),
    roundSeconds,
    answer: session.mode === "test" ? `${country.country} (${country.capital})` : undefined,
  });

  // Automatic, steady letter reveal — mirrors Flagle's continuous
  // "clarity increases over time" tension, adapted for a text answer.
  session.round.letterTimer = setInterval(() => {
    revealOneLetter(session);
  }, AUTO_LETTER_REVEAL_MS);

  session.round.timer = setTimeout(() => endRound(session, null), roundSeconds * 1000);

  // Test Mode auto-generates fake chat so the whole round can resolve
  // with zero manual typing — verifies the full game loop after any change.
  clearFakeGuessTimer(session);
  if (session.mode === "test") {
    session.fakeGuessTimer = setInterval(() => {
      if (!session.roundActive || !session.round) return;
      const user = FAKE_USERNAMES[Math.floor(Math.random() * FAKE_USERNAMES.length)];
      const roll = Math.random();
      let text;
      if (roll < 0.25) text = session.round.country.country;
      else if (roll < 0.75) {
        const p = pool(session);
        text = p[Math.floor(Math.random() * p.length)].country;
      } else {
        text = FAKE_CHATTER[Math.floor(Math.random() * FAKE_CHATTER.length)];
      }
      const isCorrect = processGuess(session, user, text);
      session.socket.emit("comment-feed", { username: user, text, correct: isCorrect });
    }, TEST_FAKE_GUESS_MS);
  }
}

function revealOneLetter(session) {
  if (!session.round) return;
  const name = session.round.country.country;
  const letterIdx = [...name].map((c, i) => i).filter((i) => /[a-zA-Z]/.test(name[i]) && !session.round.revealedIdx.has(i));
  if (letterIdx.length <= 1) return; // always leave at least one letter hidden until reveal
  const pick = letterIdx[Math.floor(Math.random() * letterIdx.length)];
  session.round.revealedIdx.add(pick);
  session.socket.emit("tiles-update", { tiles: buildTiles(name, session.round.revealedIdx) });
}

function endRound(session, winner) {
  if (!session.roundActive) return;
  clearRoundTimer(session);
  clearFakeGuessTimer(session);
  session.roundActive = false;
  const country = session.round.country;

  session.socket.emit("round-end", {
    countryName: country.country,
    capitalName: country.capital,
    continent: country.continent,
    winner: winner ? winner.username : null,
    points: winner ? winner.points : 0,
    leaderboard: leaderboard(session),
  });

  setTimeout(() => {
    if (session.socket.connected) startRound(session);
  }, REVEAL_PAUSE_MS);
}

function processGuess(session, username, rawText) {
  if (!session.roundActive || !session.round || !rawText) return false;
  const guessed = resolveGuess(rawText);
  if (!guessed) return false;

  const target = session.round.country;
  session.round.guessCount += 1;

  if (guessed.country === target.country) {
    const elapsedSec = (Date.now() - session.round.startedAt) / 1000;
    const speedScore = Math.max(100 - Math.floor(elapsedSec * 2), 20);
    const streak = (session.streaks.get(username) || 0) + 1;
    session.streaks.set(username, streak);
    const streakBonus = Math.min(streak * 5, 50);
    const points = speedScore + streakBonus;
    session.scores.set(username, (session.scores.get(username) || 0) + points);
    endRound(session, { username, points });
    return true;
  }

  // Wrong but resolvable guess -> distance + direction hint, TRAVLE/Globle style.
  const distanceKm = haversineKm(guessed.lat, guessed.lon, target.lat, target.lon);
  const { compass } = bearingCompass(guessed.lat, guessed.lon, target.lat, target.lon);
  if (session.round.closestKm === null || distanceKm < session.round.closestKm) {
    session.round.closestKm = distanceKm;
  }
  session.socket.emit("wrong-guess", {
    guessedName: guessed.country,
    distanceKm,
    direction: compass,
    guessCount: session.round.guessCount,
    closestKm: session.round.closestKm,
  });

  // Reset this player's streak on their OWN wrong-but-real guess so streak
  // bonuses reward consistently fast/correct players, not lucky one-offs.
  session.streaks.set(username, 0);
  return false;
}

function friendlyError(err, username) {
  const raw = err?.message || String(err);
  const lower = raw.toLowerCase();
  if (
    err?.name === "UserOfflineError" ||
    lower.includes("offline") || lower.includes("not found") ||
    lower.includes("not currently live") || lower.includes("room id") ||
    lower.includes("room_id") || lower.includes("roomid") ||
    lower.includes("user_not_found") || lower.includes("failed to retrieve")
  ) {
    return `TikTok reports no live room found for @${username} right now — almost always because the account isn't currently broadcasting. That's expected, not a problem with your setup. (If you're certain you WERE live, it's occasionally a temporary detection hiccup on TikTok's side — try again in a minute.)`;
  }
  if (lower.includes("rate") || lower.includes("429") || lower.includes("too many")) {
    return "Hit a rate limit reading TikTok chat. Wait ~30 seconds and try again — or add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README).";
  }
  if (lower.includes("captcha") || lower.includes("blocked") || lower.includes("forbidden") || lower.includes("403")) {
    return "TikTok is blocking this connection attempt right now. Add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README).";
  }
  if (lower.includes("processinitialdata") || lower.includes("cannot read properties of undefined")) {
    return "Hit a known bug in the free demo path. Add a free key from eulerstream.com as TIKTOK_SIGN_API_KEY on Render (see README) — this fixes it.";
  }
  return `Connection attempt failed for a reason other than "not live" (${err?.name || "error"}: ${raw}). Worth reporting if this keeps happening while you ARE live.`;
}

export function registerCapitale(io) {
  const nsp = io.of("/capitale");

  nsp.on("connection", (socket) => {
    const session = newSession(socket);

    socket.on("connect-tiktok", async ({ username }) => {
      session.mode = "live";
      if (!username || typeof username !== "string") {
        socket.emit("tiktok-error", { message: "Please enter a valid TikTok username." });
        return;
      }
      const clean = username.trim().replace(/^@/, "").toLowerCase();

      if (!HAS_SIGN_KEY) {
        socket.emit("tiktok-status", {
          message: "Connecting without a saved key — this can be flaky. See README for the 2-minute free fix.",
        });
      }

      const MAX_ATTEMPTS = 3;
      let lastErr = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          if (session.tiktokConnection) {
            try { await session.tiktokConnection.disconnect(); } catch (e) {}
          }

          const connection = new TikTokLiveConnection(clean, {
            processInitialData: true,
            fetchRoomInfoOnConnect: true,
          });
          session.tiktokConnection = connection;
          session.tiktokUsername = clean;
          session.commentsSeen = 0;

          await connection.connect();
          socket.emit("session-started", { mode: "live", label: "@" + clean });

          session.watchdog = setTimeout(() => {
            if (session.commentsSeen === 0) {
              socket.emit("tiktok-status", {
                message: "⚠️ Connected, but no chat messages received yet from your live audience. Ask a viewer to comment a country or capital name, or see README troubleshooting.",
              });
            }
          }, 25000);

          const chatHandler = (data) => {
            try {
              const commenter =
                data.user?.uniqueId || data.user?.nickname ||
                data.uniqueId || data.nickname || "viewer";
              const text =
                (typeof data.comment === "string" && data.comment) ||
                (typeof data.content === "string" && data.content) ||
                (typeof data.text === "string" && data.text) ||
                (typeof data.message === "string" && data.message) || "";

              session.commentsSeen = (session.commentsSeen || 0) + 1;
              console.log(`[capitale:${clean}] chat #${session.commentsSeen} from ${commenter}: "${text}"`);
              if (session.commentsSeen <= 5) {
                console.log(`[capitale:${clean}] raw chat payload:`, JSON.stringify(data).slice(0, 2000));
              }

              socket.emit("chat-heartbeat", { count: session.commentsSeen });
              socket.emit("debug-last-comment", { username: commenter, text });

              const isCorrect = text ? processGuess(session, commenter, text) : false;
              if (text) socket.emit("comment-feed", { username: commenter, text, correct: isCorrect });
            } catch (e) {
              console.error("[capitale] Error handling chat event:", e);
            }
          };
          // Register exactly once — WebcastEvent.CHAT and the plain string
          // "chat" refer to the SAME underlying event, so registering both
          // would fire this handler twice per message (double points,
          // double diagnostics). Prefer the enum when available since it's
          // the modern documented form; fall back to the string only if
          // this installed version doesn't export it.
          connection.on(WebcastEvent && WebcastEvent.CHAT ? WebcastEvent.CHAT : "chat", chatHandler);

          connection.on("disconnected", () => socket.emit("tiktok-disconnected", {}));
          connection.on("streamEnd", () => socket.emit("tiktok-disconnected", { reason: "stream-ended" }));

          connection.on("like", (data) => {
            try {
              const liker = data.user?.uniqueId || data.user?.nickname || data.uniqueId || data.nickname || "viewer";
              const batch = (typeof data.likeCount === "number" && data.likeCount) || (typeof data.count === "number" && data.count) || 1;
              session.likes.set(liker, (session.likes.get(liker) || 0) + batch);
              socket.emit("fan-stats", fanStats(session));
            } catch (e) {
              console.error("[capitale] Error handling like event:", e);
            }
          });

          connection.on("gift", (data) => {
            try {
              const giftDetails = data.giftDetails || {};
              const isStreakable = typeof giftDetails.giftType === "number" ? giftDetails.giftType === 1 : typeof data.giftType === "number" ? data.giftType === 1 : false;
              const repeatEnd = typeof data.repeatEnd === "boolean" ? data.repeatEnd : true;
              if (isStreakable && !repeatEnd) return;
              const gifter = data.user?.uniqueId || data.user?.nickname || data.uniqueId || data.nickname || "viewer";
              const diamondValue = (typeof giftDetails.diamondCount === "number" && giftDetails.diamondCount) || (typeof data.diamondCount === "number" && data.diamondCount) || (typeof data.diamond_count === "number" && data.diamond_count) || 0;
              const repeatCount = (typeof data.repeatCount === "number" && data.repeatCount) || 1;
              session.gifts.set(gifter, (session.gifts.get(gifter) || 0) + diamondValue * repeatCount);
              socket.emit("fan-stats", fanStats(session));
            } catch (e) {
              console.error("[capitale] Error handling gift event:", e);
            }
          });

          connection.on("error", (err) => console.error("[capitale] TikTok connection error:", err?.info || err));

          startRound(session);
          return;
        } catch (err) {
          lastErr = err;
          console.error(`[capitale] Connect attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err?.name, err?.message || err);
          if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }

      socket.emit("tiktok-error", { message: friendlyError(lastErr, clean) });
    });

    socket.on("start-local-mode", ({ mode }) => {
      if (mode !== "test" && mode !== "offline") return;
      session.mode = mode;
      if (session.tiktokConnection) {
        try { session.tiktokConnection.disconnect(); } catch (e) {}
        session.tiktokConnection = null;
      }
      const label = mode === "test" ? "Test Mode" : "Offline Mode";
      session.tiktokUsername = label;
      socket.emit("session-started", { mode, label });
      startRound(session);
    });

    socket.on("host-comment", ({ text }) => {
      if (!text) return;
      const isCorrect = processGuess(session, "HOST (You)", text);
      socket.emit("comment-feed", { username: "HOST (You)", text, correct: isCorrect });
    });

    socket.on("skip-round", () => {
      if (session.roundActive) endRound(session, null);
    });

    socket.on("set-difficulty", ({ level }) => {
      session.difficulty = level === "easy" ? "easy" : "all";
    });

    socket.on("request-hint", () => {
      if (!session.roundActive || !session.round) return;
      session.round.hintsGiven += 1;
      revealOneLetter(session);
      revealOneLetter(session); // host hint = two letters at once, on demand
      const c = session.round.country;
      let message;
      if (session.round.hintsGiven === 1) message = `Hint: the capital starts with "${c.capital[0].toUpperCase()}".`;
      else message = `Hint: the country has ${c.country.replace(/[^A-Za-z]/g, "").length} letters, capital has ${c.capital.replace(/[^A-Za-z]/g, "").length}.`;
      session.socket.emit("host-hint", { message });
    });

    socket.on("disconnect", () => {
      clearRoundTimer(session);
      clearFakeGuessTimer(session);
      if (session.watchdog) clearTimeout(session.watchdog);
      if (session.tiktokConnection) {
        try { session.tiktokConnection.disconnect(); } catch (e) {}
      }
    });
  });

  console.log(`[capitale] registered on namespace /capitale (${COUNTRIES.length} countries loaded)`);
}
