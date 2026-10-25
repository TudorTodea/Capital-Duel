# Capital Duel

Two players, 60 seconds each. A country is highlighted on the world map, a pin marks its capital, and the active
player types the capital. Correct → your clock stops and the other player's starts. First clock to hit 0 loses.

    npm install
    npm start          # http://localhost:3737  (set PORT to change)

Open the site, enter your name → you get a room link (`/?room=xxxxxx`) to send to your opponent.

- **Skip** (or `Esc`): reveals the answer for 1 second (your clock keeps running), then a new country appears.
- Wrong guesses are free but your clock keeps ticking. Accent/spacing/case-insensitive, 1 typo tolerated on long names.
- If a player disconnects the game pauses for 30s; reconnecting (same tab) resumes it.
- Deploy anywhere that runs Node with WebSockets (Render, Railway, Fly.io…); the start command is `npm start`.

## Deploy on Render (free)
1. Push this folder to a GitHub repo.
2. render.com → New → Blueprint → pick the repo (it reads `render.yaml`). WebSockets work out of the box.
3. Share `https://<your-app>.onrender.com`. Free instances sleep after ~15 min idle, so the first load can take ~30s.
