# Capital Duel

Two players, three modes picked by whoever creates the room:

- **Capitals** — a country is highlighted on the world map, a pin marks its capital, the active player types the capital.
  60s each; correct → your clock stops and the other player's starts; first clock to hit 0 loses.
- **Flags** — same duel format, but a flag is shown and you name the country. Well-known flags (USA, France, Germany…)
  come up several times more often than obscure ones (small Pacific/African states), via a weighted random pick.
- **Milionari 💍** (Romanian UI, "Who Wants to Be a Millionaire"-style) — co-op, not competitive: built for two people
  playing together (e.g. a couple). You climb a 15-question money ladder from 100 to 1.000.000 lei as a team — talk it
  over in the built-in chat, and either player can tap an answer to lock it in. A wrong answer drops you to the last
  milestone you passed (1.000 lei at Q5, 32.000 lei at Q10); you can also stop any time ("Ne oprim aici 💝") with
  whatever you've already banked. One shared 50:50 lifeline per game. Three difficulty levels (Ușor / Mediu / Greu), each with its own separate pools of questions (149 in total, from general knowledge to Romanian culture, movies, music, sports, science and more); the answer order is shuffled every time. A cute couple mascot (two avatar initials +
  a little spinning heart) reacts to every answer with a burst of emoji, and confetti on a full win. Mobile-friendly
  (bottom-sheet chat, single-column question card, horizontally scrolling ladder), Quicksand font for a softer feel.

    npm install
    npm start          # http://localhost:3737  (set PORT to change)

Open the site, enter your name, pick a mode → you get a room link (`/?room=xxxxxx`) to send to your opponent/partner
(they join whichever mode you picked).

- **Skip** (Capitals/Flags, or `Esc`): reveals the answer for 1 second (your clock keeps running), then a new country appears.
- Wrong guesses are free but your clock keeps ticking. Accent/spacing/case-insensitive, 1 typo tolerated on long names;
  a type-ahead list of capitals/country names appears as you type (never reveals which one matches the current round).
- If a player disconnects the game pauses for 30s; reconnecting (same tab) resumes it. In Millionaire, if the grace
  period runs out the round ends and you bank whatever was already secured.
- Deploy anywhere that runs Node with WebSockets (Render, Railway, Fly.io…); the start command is `npm start`.

## Deploy on Render (free)
1. Push this folder to a GitHub repo.
2. render.com → New → Blueprint → pick the repo (it reads `render.yaml`). WebSockets work out of the box.
3. Share `https://<your-app>.onrender.com`. Free instances sleep after ~15 min idle, so the first load can take ~30s.
