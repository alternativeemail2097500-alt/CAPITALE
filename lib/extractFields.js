/**
 * extractFields.js
 *
 * TikTok's LIVE chat data shape is NOT officially documented and drifts
 * between library versions (the libraries are reverse-engineered).
 * Never trust one hardcoded field name. Every value we need is pulled
 * through a "fallback chain" of every plausible location it has been
 * seen in across tiktok-live-connector v1 / v2 and similar libraries.
 *
 * If TikTok changes shape again, add one more candidate path below --
 * nothing else in the app needs to change.
 */

// Safely walk a dotted path like "user.uniqueId" against an object.
function getPath(obj, path) {
  try {
    return path.split(".").reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[key];
    }, obj);
  } catch {
    return undefined;
  }
}

// Try a list of candidate paths against a list of candidate root objects,
// return the first non-empty value found.
function firstMatch(roots, paths) {
  for (const root of roots) {
    if (!root) continue;
    for (const p of paths) {
      const val = getPath(root, p);
      if (val !== undefined && val !== null && val !== "") {
        return val;
      }
    }
  }
  return undefined;
}

// Candidate "root" objects a raw event might nest its real payload under.
function candidateRoots(evt) {
  return [
    evt,
    evt && evt.data,
    evt && evt.data && evt.data.data,
    evt && evt.msg,
    evt && evt.detail,
    evt && evt.payload,
  ];
}

const USERNAME_PATHS = [
  "uniqueId",
  "user.uniqueId",
  "user.unique_id",
  "userId",
  "user.userId",
  "nickname",
  "user.nickname",
  "user.nickName",
  "userDetails.uniqueId",
  "sender.uniqueId",
  "sender.nickname",
  "author.uniqueId",
  "author.nickname",
];

const DISPLAY_NAME_PATHS = [
  "nickname",
  "user.nickname",
  "user.nickName",
  "displayName",
  "user.displayName",
];

const COMMENT_TEXT_PATHS = [
  "comment",
  "content",
  "text",
  "message",
  "data.comment",
  "chatMessage",
  "msg",
  "body",
];

const PROFILE_PIC_PATHS = [
  "profilePictureUrl",
  "user.profilePictureUrl",
  "user.avatarThumb.urlList.0",
  "user.avatarThumb.url_list.0",
  "profilePicture.url",
  "avatarUrl",
];

const USER_ID_PATHS = [
  "userId",
  "user.userId",
  "user.id",
  "userDetails.userId",
];

function normalizeUsername(raw) {
  if (raw === undefined || raw === null) return null;
  return String(raw).trim();
}

/**
 * Extracts a normalized {username, displayName, text, userId, profilePic}
 * object out of ANY raw chat-like event, regardless of which shape the
 * currently-installed library version happens to emit.
 *
 * Returns null fields (never throws) when nothing plausible is found --
 * callers decide what to do with a partially-empty result.
 */
function extractChatFields(rawEvent) {
  const roots = candidateRoots(rawEvent);

  const username = normalizeUsername(firstMatch(roots, USERNAME_PATHS));
  const displayName = normalizeUsername(firstMatch(roots, DISPLAY_NAME_PATHS)) || username;
  const textRaw = firstMatch(roots, COMMENT_TEXT_PATHS);
  const text = textRaw === undefined ? null : String(textRaw);
  const profilePic = firstMatch(roots, PROFILE_PIC_PATHS) || null;
  const userId = firstMatch(roots, USER_ID_PATHS) || null;

  return {
    username: username || null,
    displayName: displayName || null,
    text,
    profilePic,
    userId: userId ? String(userId) : null,
    // true only if we found BOTH a username and some text --
    // used by diagnostics to distinguish "arriving" vs "arriving but unrecognized"
    isFullyRecognized: Boolean(username && text !== null && text !== ""),
  };
}

module.exports = { extractChatFields, getPath, firstMatch };
