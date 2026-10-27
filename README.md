# Capital Duel

Two players, 60 seconds each, two modes picked by whoever creates the room:

- **Capitals** — a country is highlighted on the world map, a pin marks its capital, the active player types the capital.
- **Flags** — a flag is shown, the active player names the country. Well-known flags (USA, France, Germany…) come up
  several times more often than obscure ones (small Pacific/African states), via a weighted random pick.

Correct → your clock stops and the other player's starts. First clock to hit 0 loses.

    npm install
    npm start          # http://localhost:3737  (set PORT to change)

Open the site, enter your name, pick a mode → you get a room link (`/?room=xxxxxx`) to send to your opponent (they
join whichever mode you picked).

- **Skip** (or `Esc`): reveals the answer for 1 second (your clock keeps running), then a new country appears.
- Wrong guesses are free but your clock keeps ticking. Accent/spacing/case-insensitive, 1 typo tolerated on long names;
  a type-ahead list of capitals/country names appears as you type (never reveals which one matches the current round).
- If a player disconnects the game pauses for 30s; reconnecting (same tab) resumes it.
- Deploy anywhere that runs Node with WebSockets (Render, Railway, Fly.io…); the start command is `npm start`.

## Deploy on Render (free)
1. Push this folder to a GitHub repo.
2. render.com → New → Blueprint → pick the repo (it reads `render.yaml`). WebSockets work out of the box.
3. Share `https://<your-app>.onrender.com`. Free instances sleep after ~15 min idle, so the first load can take ~30s.
