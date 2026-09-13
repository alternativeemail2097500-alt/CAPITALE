/**
 * gameEngine.js
 *
 * All CAPITALE game rules live here: picking countries, matching guesses
 * (with typo tolerance), distance/direction hints (Globle/Travle style),
 * scoring, streaks, the leaderboard, and a self-contained Test Mode that
 * needs no TikTok connection at all.
 */

const fs = require("fs");
const path = require("path");

const ALL_COUNTRIES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "capitals.json"), "utf8")
);

// A handful of common nicknames / abbreviations viewers actually type in chat.
const ALIASES = {
  usa: "United States",
  us: "United States",
  "united states of america": "United States",
  america: "United States",
  uk: "United Kingdom",
  england: "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  uae: "United Arab Emirates",
  "emirates": "United Arab Emirates",
  drc: "Democratic Republic of the Congo",
  congo: "Democratic Republic of the Congo",
  "ivory coast": "Ivory Coast",
  "cote d'ivoire": "Ivory Coast",
  "cote divoire": "Ivory Coast",
  ussr: "Russia",
  russia: "Russia",
  "south korea": "South Korea",
  korea: "South Korea",
  "north korea": "North Korea",
  holland: "Netherlands",
  czech: "Czechia",
  "czech republic": "Czechia",
  micronesia: "Micronesia",
  eswatini: "Eswatini",
  swaziland: "Eswatini",
  "cape verde": "Cabo Verde",
  burma: "Myanmar",
  dc: "United States",
  "washington dc": "United States",
};

// Curated pool of well-known countries for "Easy" difficulty.
const EASY_POOL = new Set([
  "United States", "United Kingdom", "France", "Germany", "Italy", "Spain",
  "Japan", "China", "India", "Russia", "Canada", "Australia", "Brazil",
  "Mexico", "Egypt", "South Korea", "North Korea", "Thailand", "Vietnam",
  "Greece", "Turkey", "South Africa", "Nigeria", "Kenya", "Argentina",
  "Netherlands", "Portugal", "Switzerland", "Sweden", "Norway", "Poland",
  "Indonesia", "Philippines", "Saudi Arabia", "Iran", "Iraq", "Israel",
  "New Zealand", "Ireland", "Cuba", "Colombia", "Peru", "Chile",
  "Ukraine", "Austria", "Belgium", "Morocco", "Pakistan", "Bangladesh",
]);

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Simple Levenshtein distance for typo tolerance on short guesses.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function fuzzyEquals(guessNorm, targetNorm) {
  if (!guessNorm || !targetNorm) return false;
  if (guessNorm === targetNorm) return true;
  // Allow small typos, scaled to word length (short words need exact match).
  const maxDist = targetNorm.length <= 4 ? 0 : targetNorm.length <= 7 ? 1 : 2;
  return levenshtein(guessNorm, targetNorm) <= maxDist;
}

// Build a fast lookup of normalized country/capital names -> country record.
const LOOKUP = [];
for (const rec of ALL_COUNTRIES) {
  LOOKUP.push({ norm: normalize(rec.country), rec });
  LOOKUP.push({ norm: normalize(rec.capital), rec });
}
for (const [alias, countryName] of Object.entries(ALIASES)) {
  const rec = ALL_COUNTRIES.find((r) => r.country === countryName);
  if (rec) LOOKUP.push({ norm: normalize(alias), rec });
}

/** Resolve free-text guess to a known country record, fuzzy-matched. Returns null if nothing plausible. */
function resolveGuess(text) {
  const norm = normalize(text);
  if (!norm || norm.length < 2) return null;

  // exact match first (fast path)
  for (const entry of LOOKUP) {
    if (entry.norm === norm) return entry.rec;
  }
  // fuzzy fallback for typos
  let best = null;
  let bestDist = Infinity;
  for (const entry of LOOKUP) {
    const maxDist = entry.norm.length <= 4 ? 0 : entry.norm.length <= 7 ? 1 : 2;
    const dist = levenshtein(norm, entry.norm);
    if (dist <= maxDist && dist < bestDist) {
      best = entry.rec;
      bestDist = dist;
    }
  }
  return best;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingCompass(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  brng = (brng + 360) % 360;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(brng / 45) % 8];
}

const ROUND_SECONDS = 45;
const HINT_AT_SECONDS_REMAINING = 25; // auto-hint once 20s have elapsed
const MAX_RECENT_GUESSES = 10;

class GameEngine {
  constructor() {
    this.difficulty = "all"; // 'all' | 'easy'
    this.usedIndices = new Set();
    this.round = null; // active round state
    this.leaderboard = new Map(); // username -> { score, streak, correctCount }
    this.roundHistory = [];
  }

  getPool() {
    if (this.difficulty === "easy") {
      return ALL_COUNTRIES.filter((c) => EASY_POOL.has(c.country));
    }
    return ALL_COUNTRIES;
  }

  setDifficulty(level) {
    this.difficulty = level === "easy" ? "easy" : "all";
  }

  pickNextTarget() {
    const pool = this.getPool();
    if (this.usedIndices.size >= pool.length) this.usedIndices.clear();
    let idx;
    do {
      idx = Math.floor(Math.random() * pool.length);
    } while (this.usedIndices.has(idx));
    this.usedIndices.add(idx);
    return pool[idx];
  }

  startRound() {
    const target = this.pickNextTarget();
    this.round = {
      target,
      startedAt: Date.now(),
      durationMs: ROUND_SECONDS * 1000,
      solved: false,
      winner: null,
      guesses: [], // { username, text, distanceKm, direction, correct, ts }
      participants: new Set(),
      hintGiven: false,
      hintText: null,
      ended: false,
    };
    return this.getPublicRoundState();
  }

  /** Reveal a progressively-more-generous hint. */
  giveHint() {
    if (!this.round || this.round.ended) return null;
    const t = this.round.target;
    if (!this.round.hintGiven) {
      this.round.hintGiven = true;
      this.round.hintText = `Continent: ${t.continent} • Starts with "${t.country[0]}" • ${t.country.length} letters`;
    } else {
      this.round.hintText = `It's "${t.country[0]}${t.country
        .slice(1)
        .replace(/[a-zA-Z]/g, "_")}" (${t.country.length} letters) — capital starts with "${t.capital[0]}"`;
    }
    return this.round.hintText;
  }

  timeRemainingMs() {
    if (!this.round) return 0;
    const elapsed = Date.now() - this.round.startedAt;
    return Math.max(0, this.round.durationMs - elapsed);
  }

  /**
   * Process one chat guess. Never throws -- always returns a result object.
   * Safe to call even if there's no active round (returns ignored:true).
   */
  submitGuess(username, rawText) {
    if (!this.round || this.round.ended) {
      return { ignored: true, reason: "no-active-round" };
    }
    if (!username || !rawText) {
      return { ignored: true, reason: "missing-fields" };
    }

    this.round.participants.add(username);
    const target = this.round.target;
    const matched = resolveGuess(rawText);

    const isCorrect =
      matched && matched.country === target.country;

    let distanceKm = null;
    let direction = null;
    if (matched && !isCorrect) {
      distanceKm = Math.round(
        haversineKm(matched.lat, matched.lon, target.lat, target.lon)
      );
      direction = bearingCompass(matched.lat, matched.lon, target.lat, target.lon);
    }

    const entry = {
      username,
      text: rawText,
      matchedCountry: matched ? matched.country : null,
      distanceKm,
      direction,
      correct: Boolean(isCorrect),
      ts: Date.now(),
    };

    this.round.guesses.unshift(entry);
    if (this.round.guesses.length > MAX_RECENT_GUESSES) {
      this.round.guesses.length = MAX_RECENT_GUESSES;
    }

    if (isCorrect && !this.round.solved) {
      this.round.solved = true;
      this.round.winner = username;
      this._awardRoundWin(username);
    }

    return { ignored: false, entry, roundSolved: this.round.solved };
  }

  _awardRoundWin(username) {
    const elapsedSec = (Date.now() - this.round.startedAt) / 1000;
    const speedScore = Math.max(100 - Math.floor(elapsedSec * 2), 20);
    const player = this._getOrCreatePlayer(username);
    player.streak += 1;
    const streakBonus = Math.min(player.streak * 5, 50);
    const total = speedScore + streakBonus;
    player.score += total;
    player.correctCount += 1;
    this.round.pointsAwarded = total;
  }

  _getOrCreatePlayer(username) {
    if (!this.leaderboard.has(username)) {
      this.leaderboard.set(username, { username, score: 0, streak: 0, correctCount: 0 });
    }
    return this.leaderboard.get(username);
  }

  /** Call when a round ends (time up or host skip) to reset streaks of non-winners who guessed. */
  endRound() {
    if (!this.round) return null;
    this.round.ended = true;
    if (!this.round.solved) {
      // Everyone who guessed but didn't solve it loses their streak.
      for (const username of this.round.participants) {
        const player = this._getOrCreatePlayer(username);
        player.streak = 0;
      }
    } else {
      // Non-winners who participated also lose streak.
      for (const username of this.round.participants) {
        if (username === this.round.winner) continue;
        const player = this._getOrCreatePlayer(username);
        player.streak = 0;
      }
    }
    const summary = {
      target: this.round.target,
      solved: this.round.solved,
      winner: this.round.winner,
      pointsAwarded: this.round.pointsAwarded || 0,
    };
    this.roundHistory.unshift(summary);
    if (this.roundHistory.length > 20) this.roundHistory.length = 20;
    return summary;
  }

  getTopLeaderboard(n = 10) {
    return [...this.leaderboard.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  getPublicRoundState() {
    if (!this.round) return null;
    return {
      startedAt: this.round.startedAt,
      durationMs: this.round.durationMs,
      solved: this.round.solved,
      winner: this.round.winner,
      hintText: this.round.hintText,
      guesses: this.round.guesses,
      // Reveal the answer only once the round has actually ended.
      target: this.round.ended
        ? this.round.target
        : { continent: this.round.target.continent, lettersInCountry: this.round.target.country.length },
    };
  }

  resetAll() {
    this.usedIndices.clear();
    this.round = null;
    this.leaderboard.clear();
    this.roundHistory = [];
  }
}

module.exports = {
  GameEngine,
  resolveGuess,
  haversineKm,
  bearingCompass,
  normalize,
  ALL_COUNTRIES,
  ROUND_SECONDS,
};
