# Salem Nights

A real-time, browser-based multiplayer social-deduction game in the Classic style — play with 7–15 coworkers over private room codes. Original artwork and role text; mechanics come from the public-domain Mafia/Werewolf party-game tradition.

> **A note on the inspiration:** this is an original game built to capture the feel of the classic Salem-village social-deduction experience. It does not use any copyrighted artwork, names, or text from any commercial product — all art and role descriptions here are original.

---

## How to play

1. One person opens the game URL, types a name, and clicks **Create Room**. They get a 4-letter **room code**.
2. Everyone else opens the same URL, types a name, enters the code, and clicks **Join**.
3. With 7–15 players in the lobby, the host clicks **Begin the Trials**.
4. The game alternates **Night** (secret role actions) and **Day** (discussion → nominate → trial → verdict). The Town wins by eliminating all evildoers; the Mafia wins by taking control; the Serial Killer wins by outlasting everyone; the Jester wins by getting lynched.

Roles included: Sheriff, Investigator, Lookout, Doctor, Bodyguard, Jailor, Vigilante, Mayor, Medium, Escort, Veteran (Town); Godfather, Mafioso, Framer, Consigliere (Mafia); Serial Killer, Jester, Executioner (Neutral). Each player's role panel explains their ability.

---

## Option A — Deploy free on Render (recommended, always-on)

Your coworkers get a permanent public URL; your own computer doesn't need to stay on.

1. **Make a GitHub repo.** Create a free account at github.com if needed, make a new repository, and upload every file in this folder (keep the folder structure — `server.js`, `game.js`, `roles.js`, `package.json`, `render.yaml`, and the `public/` folder).
   - Easiest no-terminal way: on the new repo page click **uploading an existing file** and drag the files in. Add the `public` folder's files inside a `public/` path.
   - Or with git installed:
     ```bash
     cd "this folder"
     git init && git add . && git commit -m "Salem Nights"
     git branch -M main
     git remote add origin https://github.com/<you>/salem-nights.git
     git push -u origin main
     ```
2. **Create the Render service.** Sign up free at [render.com](https://render.com) → **New +** → **Web Service** → connect your GitHub and pick the repo.
   - Render reads `render.yaml` automatically. If asked manually: Runtime **Node**, Build command `npm install`, Start command `node server.js`, Plan **Free**.
3. Click **Create Web Service**. After it builds (1–2 min) you'll get a URL like `https://salem-nights.onrender.com`. Share that link + the room code with your coworkers.

> Render's free tier sleeps after ~15 minutes idle; the first visit after a nap takes ~30 seconds to wake. Fine for game nights.

---

## Option B — Run on your own computer + share via ngrok

Quick to start, but your computer must stay on while playing.

1. Install [Node.js](https://nodejs.org) (LTS).
2. In this folder, run:
   ```bash
   npm install
   npm start
   ```
   The game is now at `http://localhost:3000` (you can test locally by opening several browser tabs).
3. To let coworkers join over the internet, install [ngrok](https://ngrok.com/download), then run:
   ```bash
   ngrok http 3000
   ```
   Share the `https://....ngrok-free.app` URL ngrok prints.

---

## Option C — Any other Node host

It's a standard Node + Express + Socket.io app. Anything that runs `npm install` then `node server.js` and exposes `process.env.PORT` works (Railway, Fly.io, a VPS, etc.).

---

## Project structure

```
server.js        Express + Socket.io server, room codes, chat routing
game.js          Game engine: role assignment, night/day state machine, win checks
roles.js         Role definitions (abilities, teams, defense/attack levels)
public/
  index.html     Single-page UI (home, lobby, game, game-over)
  style.css      Gothic / colonial Salem theme
  client.js      Front-end controller (sockets, rendering, actions)
  art.js         Original SVG role emblems & player avatars
render.yaml      Render deploy config
test/simulate.js Headless multi-client game simulation
```

## Run the test
```bash
npm test
```
Simulates a full game with bot clients and prints the phase flow and outcome.
