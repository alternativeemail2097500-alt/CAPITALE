# CAPITALE — TikTok LIVE Capital-Guessing Game

A fully automated game for your TikTok LIVE streams. Viewers guess the
capital city of a mystery country by typing in your live chat. You (the
host) run everything from one control panel page on your phone or laptop.
Your audience watches the game itself on a second page you put in OBS (or
just share your screen).

**You never need to write or edit any code.** This guide tells you exactly
what to click, in order. It should take about 20–30 minutes the first time.

---

## What you're getting

- `server.js` and the `lib/` folder — the "brain" of the game (Node.js).
- `public/` folder — the two pages people actually look at:
  - `index.html` — the **big display screen** your audience/OBS sees.
  - `host.html` — the **control panel** only you use, built for your phone.
- `data/capitals.json` — every country + capital city used by the game.

You will NOT run this on your own computer long-term. You'll upload it to
GitHub, and Render.com will run it for you, 24/7, at a web address you can
put in OBS.

---

## Part 1 — Get your TikTok signing key (REQUIRED, do this first)

TikTok doesn't offer an official way for outside apps to read LIVE chat.
The library this project uses relies on a free service called
**Euler Stream** to make that connection reliably. Without a key from them,
the connection will be unreliable or fail — so we set this up first, not
as an afterthought.

1. Go to **https://www.eulerstream.com** and create a free account (no
   credit card required).
2. Once logged in, find your **API key** on your dashboard.
3. Copy that key somewhere safe (a notes app) — you'll paste it into Render
   in Part 3.

That's it for this part. Keep this tab open or the key handy.

---

## Part 2 — Put the code on GitHub

You already have a GitHub account, so:

1. Go to **https://github.com/new** to create a new repository.
2. Name it something like `capitale-tiktok-game`. Keep it **Public** or
   **Private** — either works for Render. Do NOT initialize it with a
   README (we already have one) — leave those checkboxes unchecked.
3. Click **Create repository**. GitHub will show you a page with some
   commands — you can ignore those; we're going to upload files using the
   website instead, no command line needed.
4. On that new repository page, click **"uploading an existing file"**
   (it's a link in the middle of the page).
5. Now, from the project files you downloaded from this chat: drag the
   **entire contents** of the project folder into the GitHub upload box —
   that means the `public` folder, the `lib` folder, `data` folder,
   `server.js`, `package.json`, `.gitignore`, `.env.example`, and this
   `README.md`. GitHub lets you drag whole folders in most browsers.
6. Scroll down and click the green **"Commit changes"** button.

Your code is now on GitHub. You won't need to touch GitHub again unless
you want to update the game later (I'll give you updated files to
re-upload the same way, if that ever happens).

---

## Part 3 — Deploy it on Render.com

1. Log in to **https://render.com** (you said you already have an account).
2. Click **New +** (top right) → **Web Service**.
3. Choose **"Build and deploy from a Git repository"** and connect your
   GitHub account if it asks you to. Select the `capitale-tiktok-game`
   repository you just created.
4. Fill in the settings Render asks for:
   - **Name**: anything you like, e.g. `capitale-game`
   - **Region**: pick the one closest to you
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: the **Free** tier works fine to start
5. Scroll to **Environment Variables** and click **Add Environment
   Variable**. Add this one:
   - Key: `SIGN_API_KEY`
   - Value: *(paste the Euler Stream key from Part 1)*
6. Click **Create Web Service**. Render will start building — this takes
   2–5 minutes the first time. You'll see a log scroll by; wait for a
   line like `CAPITALE server listening on port ...` and a status of
   **Live** at the top of the page.
7. Render gives you a web address at the top of the page, something like
   `https://capitale-game.onrender.com`. That's your game's home.

**Two pages live at that address:**
- `https://capitale-game.onrender.com/` → the **display page** (put this
  in OBS as a Browser Source, or open it on a second screen/TV).
- `https://capitale-game.onrender.com/host` → the **host control panel**
  (open this on your phone during the stream).

> ⚠️ Free-tier note: Render's free web services "sleep" after 15 minutes
> with no traffic, and take ~30–60 seconds to wake back up when someone
> visits. Before you go live, open both pages yourself a minute or two
> early so the server is already awake. If this matters a lot to you,
> Render's cheapest paid tier ($7/month at time of writing) keeps it
> always-on — entirely optional, the free tier works fine for testing and
> for most live sessions if you "wake it up" first.

---

## Part 4 — Try it out with Test Mode (no live stream needed)

Before you ever go live, check that everything works:

1. Open your host panel: `https://YOUR-RENDER-ADDRESS.onrender.com/host`
2. Flip on the **"Test Mode"** switch. You'll immediately see the
   **"Raw events received"** counter start climbing on its own — that's
   fake chat being generated for you to test with, no TikTok needed.
3. Open the display page in another tab or on another device:
   `https://YOUR-RENDER-ADDRESS.onrender.com/`
4. Tap **"▶ Start Round"** on the host panel. Watch the display page show
   a continent hint and a countdown ring. Fake guesses will start
   scrolling in, and occasionally one will be correct — you'll see the
   winner banner, points, and leaderboard update.
5. Try the **"Type as Host"** box on the host panel too — whatever you
   type there is treated exactly like a real viewer's comment, so you can
   manually test any guess, or use it live to answer/comment yourself
   during a broadcast.
6. Turn Test Mode back off when you're done trying it.

If Test Mode works, the game itself is proven to work — anything that
goes wrong later during a real stream is a **connection** issue, not a
game-logic issue, which makes troubleshooting much easier.

---

## Part 5 — Going live for real

1. Make sure you are actually LIVE on TikTok first (the connector can only
   join a stream that's already broadcasting).
2. Open the host panel on your phone: `.../host`
3. Make sure **Test Mode is OFF**.
4. Type your TikTok username (no `@`) into the **TikTok LIVE Connection**
   box and tap **Connect**.
5. Watch the status badge in the top right. It will say
   **"Connecting…"**, then either:
   - **"Live"** (green) — you're connected! Comments should start
     incrementing the "Raw events received" counter within a few seconds
     of people typing.
   - **"Connection failed"** (red) — read the message under it. The three
     most common reasons are: the account isn't actually live yet, the
     username was typed wrong, or the Euler Stream key is missing/invalid.
     It will have already retried automatically 2–3 times before showing
     this.
6. Put the **display page** address into OBS as a Browser Source (or on a
   second monitor/TV) so your audience/co-host can see it.
7. Tap **"▶ Start Round"** whenever you're ready to begin, and
   **"⏭ Skip"** or **"💡 Hint"** any time during a round.

### Reading the diagnostics panel while live
- **Raw events received** climbing = comments are reaching the server.
  If it's stuck at 0 while people are visibly typing in your TikTok app,
  the connection isn't actually receiving chat — check the connection
  status message.
- **Last received** shows the most recent message and whether it was
  understood as a guess. If it says "(not recognized as a guess)" for
  everything, something changed in how TikTok formats messages — this
  is rare, but if it happens consistently, that's useful information to
  bring back for a fix.

---

## How the game works (so you can explain it on stream)

- Every round, the game picks a random country. Viewers type either the
  **country name** or its **capital city** in chat — small typos are
  forgiven.
- Each round lasts **45 seconds**. If nobody gets it in time, the host can
  reveal a hint, or skip to the next round.
- Wrong guesses that are still real places get an instant "hot/cold" style
  clue: distance in kilometers and a compass direction toward the real
  answer — so the crowd can collectively narrow it down.
- First correct guess wins the round. Points are higher the faster someone
  answers, plus a small bonus for a winning streak across multiple rounds.
- The **Top 10 leaderboard** is always visible on the display page.
- Difficulty can be toggled by the host between **"All countries"** (all
  ~195) and **"Easy"** (a curated list of ~50 well-known countries) —
  useful if your audience skews casual.

> Note: the leaderboard lives in the server's memory, not a database. It
> resets if Render restarts the service (which can happen occasionally on
> the free tier, or whenever you redeploy). This keeps things simple and
> fast; if you want scores to survive restarts permanently, that's a
> small future upgrade (a persistent database) — not something you need
> to worry about to get started.

---

## Troubleshooting cheat sheet

| What you see | What it means | What to do |
|---|---|---|
| "Raw events received" stuck at 0 during a real live stream | Comments aren't reaching the server at all | Confirm you're actually LIVE, username has no typos, and try Disconnect → Connect again |
| Counter climbs, but "Last received" keeps saying "not recognized" | TikTok changed its chat message format | This is rare; the game is built to auto-adapt to most format changes, but note down an example message and it can be patched |
| Connection status says "Connection failed" | Signing key missing/invalid, or account not live | Double check the `SIGN_API_KEY` value in Render's Environment tab |
| Display page looks blank or stuck | Browser lost connection to the server | It auto-reconnects within a few seconds; refresh the page if it doesn't |
| Everything worked in Test Mode but not live | Confirms the game logic is fine — it's specifically a TikTok connection issue | Recheck Parts 1 and 5 |

---

**Optional, advanced:** Render keeps a running technical log of everything
the server does (Render dashboard → your service → **Logs** tab). You
should never need this day-to-day — the diagnostics panel on the host page
is designed to answer "is it working?" on its own — but if something odd
happens and you want to show a developer more detail later, that log is
where the full technical detail lives.

---

## Updating the game later

If you ever want changes, you'll be given the updated files the same way.
To apply them: go back to your GitHub repository → click into the folder/
file that changed → click the pencil (✏️) "edit" icon or use "Upload
files" again to overwrite it → commit the change. Render automatically
redeploys within a minute or two of any change to your GitHub repository.
