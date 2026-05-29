# Flappy Arena Multiplayer

This is a browser-based Flappy Bird game with room-code multiplayer.

## What is included

- `index.html` - game page and dashboard UI
- `style.css` - layout and styling
- `game.js` - game logic + WebSocket multiplayer client
- `server.js` - Node.js multiplayer server
- `package.json` - dependencies and start script
- `assets/` - put your images here

## Image files

Place these files inside the `assets/` folder if you have them:

```text
flappybirdbg.png
flappybird.png
toppipe.png
bottompipe.png
gameover.png
```

The game still works without them using fallback drawings.

## How to run

Install Node.js first.

Then open a terminal inside this folder and run:

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

## Worldwide rooms

Room codes work for everyone who is connected to the same running server. For friends in other places, deploy this folder to a public Node.js host or expose your local server with a tunnel, then share that public website URL plus the room code.

The server listens on `0.0.0.0` by default so hosting providers and LAN devices can reach it. You can override the bind address or port like this:

```bash
HOST=0.0.0.0 PORT=3000 npm start
```

Rooms and scores are kept in server memory for the current session. Empty rooms stay joinable for 15 minutes, then they are cleaned up.

Room creators can set a match timer from 15 to 300 seconds. The timer waits until someone presses **START GAME**, then runs without pause or stop controls. When the timer ends, the server picks the highest best score in the room as the winner and broadcasts their name, score, and profile avatar.

## How to test multiplayer on one laptop

1. Open `http://localhost:3000` in one browser tab.
2. Enter a name and click **Create Room**.
3. Copy the room code.
4. Open another browser tab or another browser.
5. Enter another name, paste the room code, and click **Join**.
6. Press **START GAME**, then start playing in both tabs.

## Current multiplayer behavior

This version syncs:

- room code
- player names
- profile image or chosen character
- current score and best score for each name in the room session
- timed match status and winner
- alive/game-over status
- live ranking inside the room

Each player runs their own Flappy Bird game locally. This is the best first multiplayer step because it is simple, stable, and easier to understand.

## Important limitation

This is not yet an anti-cheat competitive server. A serious production version should move more game validation to the server and add accounts, database storage, matchmaking, and deployment configuration.
