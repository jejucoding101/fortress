# Fortress Duel

Phaser 3, TypeScript, Vite, Socket.IO prototype inspired by classic 2D turn-based artillery games.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5173` in a browser.

For another computer on the same network, open:

```txt
http://YOUR_HOST_IP:5173
```

The game server runs on port `3000`. If a client cannot connect automatically, start the client with:

```bash
VITE_SERVER_URL=http://YOUR_HOST_IP:3000 npm run dev:client
```

## Multiplayer

- Click `방 만들기` on the first computer.
- Share the four-letter room code.
- Enter the room code on the second computer and click `입장`.
- Only the active player can move, aim, and fire.
- The server owns turn order, projectile simulation, terrain craters, damage, and victory state.

## Controls

- `Left`, `Right`: move the active tank
- `Up`, `Down`: adjust cannon angle
- Hold `Space`: charge shot power
- Release `Space`: fire
- Click or drag the bottom marker: set a target power reference
- `R`: restart

## Implemented

- Two-player turn-based battle
- Terrain-aware tank movement
- Hold-to-charge shot power
- Bottom power gauge
- Persistent last-shot power marker
- Adjustable target power marker
- Wind-influenced projectile arc
- Terrain collision
- Destructible circular craters
- Distance-based explosion damage
- HP HUD
- Win/loss state
