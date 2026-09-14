# TikTok LIVE Game Platform

One deployed link, a game-selector home screen, and three independent
games — **Flagle Live**, **TRAVLE Live**, and **Capitale Live** — each
reading your TikTok LIVE chat directly as guesses. You never touch code;
follow the steps below.

## What changed from before

Capitale Live is added as a third game, built the same way Flagle and
TRAVLE already work:

```
public/
  index.html        <- UPDATED: home screen now lists all three games
  flagle/            <- unchanged
  travle/            <- unchanged
  capitale/          <- NEW: Capitale Live
server/
  flagle.js          <- unchanged
  travle.js          <- unchanged
  capitale.js        <- NEW: Capitale's server logic, its own namespace
server.js             <- UPDATED: also wires in Capitale
package.json          <- unchanged (Capitale needs no new dependencies)
```

Capitale is fully self-contained, exactly like the other two — its own
HTML/CSS/JS, its own TikTok connection, its own Socket.IO namespace
(`/capitale`), and its own per-host session, so multiple hosts can each
run Capitale simultaneously from the same link (same model as Flagle).

---

## Applying this update to your existing repo

1. Open your repo on github.com.
2. **Add** the new files: the whole `server/capitale.js` file, and the
   whole `public/capitale/` folder (with `index.html`, `style.css`,
   `app.js`, `capitals.json` inside it) — use **Add file → Upload files**
   and drag them in, keeping the folder structure.
3. **Replace** two existing files with the updated versions you were
   given: `server.js` (root level) and `public/index.html` (the home
   screen) — open each file on GitHub, click the pencil (✏️) icon, delete
   the old contents, paste in the new version, and commit. Or use
   **Upload files** again with the same filename/path to overwrite it.
4. Leave `public/flagle/`, `public/travle/`, `server/flagle.js`,
   `server/travle.js`, and `package.json` exactly as they are — nothing
   in them needs to change.
5. Commit changes. Render redeploys automatically within a minute or two.

**Starting fresh instead?** Just upload the full folder structure as one
new repo — same steps as before.

---

## Render deployment (unchanged)

If this is your first time deploying, or you're starting a fresh repo:

1. **render.com** → **New +** → **Web Service** → connect your repo.
2. **Runtime:** Node · **Build Command:** `npm install` · **Start
   Command:** `npm start`.
3. Add environment variable **Key** `TIKTOK_SIGN_API_KEY`, **Value** from
   eulerstream.com. This one key works for **all three games**.
4. **Create Web Service.** Your address is the same shape as before, e.g.
   `https://your-app.onrender.com`.

If you already have this deployed, you don't need to touch Render at all
— pushing the file changes above to GitHub triggers an automatic
redeploy on its own.

> Free-tier sleep warning still applies — open the link a minute or two
> before going live, or upgrade to the cheapest paid tier if you stream
> often.

---

## TikTok auto-chat key (if you don't already have one)

1. **eulerstream.com** → free account → copy your API key.
2. Render → your service → **Environment** → add `TIKTOK_SIGN_API_KEY` →
   **Save Changes** (auto-redeploys).

---

## Using the platform

1. Open your Render link. You'll land on a **home screen** with three
   game cards: **Flagle Live**, **TRAVLE Live**, and **Capitale Live**.
2. Tap one to open it — each game is its own self-contained page with its
   own address (`/flagle/`, `/travle/`, or `/capitale/`), so you can also
   bookmark a game directly and skip the home screen if you always play
   the same one.
3. Inside a game, tap a mode tab first: **Live** (connect to your real
   TikTok stream), **Test** (short automated rounds with no TikTok
   needed — great for checking things still work after any change), or
   **Offline** (play solo at normal pace, typing your own guesses).
4. Going live on TikTok: open the game's page in your browser, start
   TikTok LIVE in **Mobile Gaming** mode pointed at that tab, then tap
   **Go live & connect** and enter your username.
5. **Switching games mid-stream:** just navigate to another game's
   `/flagle/`, `/travle/`, or `/capitale/` address in the same browser
   tab you're broadcasting. Each game reconnects to TikTok independently
   when you open it.

## Sharing with your friend

She opens your link, picks a game, and connects her own TikTok username.
Flagle and Capitale both support multiple hosts running *simultaneously*
on the same link (each browser tab gets its own independent connection).
TRAVLE currently supports one active TikTok connection at a time — same
as documented before.

---

## All three games, briefly

**Flagle Live** — guess the blurred flag before time runs out; the flag
sharpens continuously and wrong guesses add a distance-and-direction hint.
Live top-10 ticker, Top Likes/Gifters tabs, host hint button, celebration
animation, full-screen toggle. 198 countries including Palestine.

**TRAVLE Live** — two random countries are picked; chat calls out any
country that could form a land-border chain between them, building inward
from both ends, no guess limit. Scored 3/1/0 points depending on whether
the guess is on the shortest path, a valid-but-longer connection, or
neither. Free outline and initials hints. Real country shapes on a
draggable, zoomable 3D globe.

**Capitale Live** — a mystery country is picked; its name is shown as
blank letter tiles that fill in automatically as the round goes on, and
chat can guess either the **country** or its **capital city** (small
typos are forgiven). A wrong-but-real guess triggers a "hot/cold"
distance-in-km and compass-direction hint toward the real answer, plus a
running "closest guess so far" readout. First correct guess wins the
round — faster answers score more, and a personal streak bonus rewards
players who keep getting it right round after round. Same live top-10
ticker and Top Likes/Gifters panel as Flagle. Difficulty can be set to
**All countries** (~197) or a curated **Easy** list of ~50 well-known
countries, from the setup screen before connecting.

Full details for TRAVLE's own mechanics are documented inside that game
if you tap **?** — Flagle's and Capitale's rules are visible directly on
their own setup screens.

---

## A note on Capitale's visuals

Flagle and Capitale share the same lightweight decorative "radar" — a
pure CSS/SVG spinning globe-grid with no external files to load, so it
appears instantly with zero risk of a slow or failed load during a
broadcast. TRAVLE's real interactive 3D globe (`globe.js`, using d3 +
a country-shapes file fetched from a CDN) is heavier and was built
specifically around TRAVLE's border-chain mechanic (coloring the actual
shortest-path countries on the map).

I kept Capitale on the lightweight radar rather than forking TRAVLE's 3D
globe for it, so Capitale keeps the "loads instantly, never lags"
guarantee even on a slow connection mid-stream. If you'd like a real
rotating globe for Capitale too — for example, highlighting each guessed
country by how close it is to the answer — that's a reasonable follow-up
and reuses most of what `globe.js` already does; just ask and it can be
added as an enhancement on top of this version.
