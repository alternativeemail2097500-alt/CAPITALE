/**
 * tiktokClient.js
 *
 * Wraps tiktok-live-connector with:
 *  - REQUIRED signing key setup (eulerstream.com) -- no silent "no-key" fallback
 *  - Raw shape logging of the first few incoming events of every type,
 *    so we can see exactly what the currently-installed library version
 *    actually sends, before any parsing logic is trusted
 *  - 2-3 retries with short backoff on connection failure
 *  - Every event handler wrapped in try/catch so one bad/odd message
 *    can never crash the process
 */

// The exported class name has changed between library versions
// (WebcastPushConnection in v1, TikTokLiveConnection from v2 onward).
// We resolve whichever one actually exists at runtime instead of hardcoding
// one -- exactly the "don't trust one name" principle this whole file follows.
const tiktokLib = require("tiktok-live-connector");
const ConnectionClass = tiktokLib.TikTokLiveConnection || tiktokLib.WebcastPushConnection;
if (!ConnectionClass) {
  throw new Error(
    "Could not find TikTokLiveConnection or WebcastPushConnection export in " +
    "the installed tiktok-live-connector package. The library's API may have " +
    "changed again -- check https://www.npmjs.com/package/tiktok-live-connector"
  );
}

const RAW_LOG_LIMIT_PER_EVENT = 5; // how many raw events per type to fully log/keep for diagnostics
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2500;

class TikTokClient {
  /**
   * @param {object} opts
   * @param {string} opts.signApiKey - REQUIRED eulerstream.com signing key
   * @param {function} onEvent - (eventType, rawData) => void, called for every raw event, always
   * @param {function} onStatus - (statusObject) => void, called on connect/disconnect/error/retry
   */
  constructor({ signApiKey }, onEvent, onStatus) {
    this.signApiKey = signApiKey;
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.connection = null;
    this.currentUsername = null;
    this.rawLogCounts = {}; // eventType -> count logged so far
    this.connected = false;
    this.connecting = false;
  }

  _safeOnEvent(eventType, data) {
    try {
      // Log the FULL raw shape for the first few events of each type.
      // This is step 1: never trust documented field names, see the truth first.
      const countSoFar = this.rawLogCounts[eventType] || 0;
      if (countSoFar < RAW_LOG_LIMIT_PER_EVENT) {
        this.rawLogCounts[eventType] = countSoFar + 1;
        console.log(
          `[RAW:${eventType}] (#${countSoFar + 1}) ${safeStringify(data)}`
        );
      }
      this.onEvent(eventType, data);
    } catch (err) {
      console.error(`[tiktokClient] handler error for event "${eventType}":`, err);
      // Never rethrow -- one bad message must never take down the process.
    }
  }

  async connect(username) {
    if (!this.signApiKey) {
      const msg =
        "Missing SIGN_API_KEY. A eulerstream.com signing key is REQUIRED " +
        "before connecting to TikTok LIVE -- set it in Render's Environment " +
        "tab as SIGN_API_KEY.";
      this.onStatus({ state: "error", message: msg });
      throw new Error(msg);
    }

    if (this.connecting) return;
    this.connecting = true;
    this.currentUsername = username;

    let attempt = 0;
    let lastError = null;

    while (attempt < MAX_RETRIES) {
      attempt += 1;
      try {
        this.onStatus({
          state: "connecting",
          message: `Connecting to @${username} (attempt ${attempt}/${MAX_RETRIES})...`,
          attempt,
        });

        // Tear down any previous connection first.
        if (this.connection) {
          try {
            this.connection.disconnect();
          } catch {
            /* ignore */
          }
        }

        this.connection = new ConnectionClass(username, {
          signApiKey: this.signApiKey,
          enableExtendedGiftInfo: false,
        });

        this._wireEvents();

        await this.connection.connect();

        this.connected = true;
        this.connecting = false;
        this.onStatus({
          state: "connected",
          message: `Connected to @${username}'s LIVE.`,
        });
        return;
      } catch (err) {
        lastError = err;
        console.error(`[tiktokClient] connect attempt ${attempt} failed:`, err && err.message);
        this.onStatus({
          state: "retrying",
          message: `Connection attempt ${attempt} failed (${err && err.message}). ` +
            (attempt < MAX_RETRIES ? "Retrying..." : "Giving up."),
          attempt,
        });
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
        }
      }
    }

    this.connecting = false;
    this.connected = false;
    this.onStatus({
      state: "failed",
      message:
        `Could not connect to @${username}'s LIVE after ${MAX_RETRIES} attempts. ` +
        `Most common causes: the account is not currently LIVE, the username is ` +
        `misspelled, or the signing key is invalid. Last error: ${lastError && lastError.message}`,
    });
    throw lastError;
  }

  _wireEvents() {
    const c = this.connection;

    // Every event type we might plausibly receive. We forward ALL of them
    // to onEvent (for the raw-diagnostics counter) but only "chat" carries
    // guesses for the game itself -- filtering happens further upstream.
    const eventTypes = [
      "chat",
      "member",
      "gift",
      "like",
      "social",
      "connected",
      "disconnected",
      "streamEnd",
      "questionNew",
      "linkMicBattle",
      "roomUser",
    ];

    eventTypes.forEach((type) => {
      c.on(type, (data) => this._safeOnEvent(type, data));
    });

    c.on("disconnected", () => {
      this.connected = false;
      try {
        this.onStatus({ state: "disconnected", message: "Disconnected from TikTok LIVE." });
      } catch (err) {
        console.error("[tiktokClient] onStatus error:", err);
      }
    });

    c.on("streamEnd", () => {
      this.connected = false;
      try {
        this.onStatus({ state: "streamEnded", message: "The TikTok LIVE stream ended." });
      } catch (err) {
        console.error("[tiktokClient] onStatus error:", err);
      }
    });

    c.on("error", (err) => {
      console.error("[tiktokClient] connection error event:", err);
    });
  }

  disconnect() {
    this.connected = false;
    this.connecting = false;
    if (this.connection) {
      try {
        this.connection.disconnect();
      } catch (err) {
        console.error("[tiktokClient] error during disconnect:", err);
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeStringify(obj) {
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      obj,
      (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        if (typeof value === "bigint") return value.toString();
        return value;
      },
      0
    ).slice(0, 4000); // keep logs readable
  } catch {
    return "[unstringifiable event]";
  }
}

module.exports = { TikTokClient };
