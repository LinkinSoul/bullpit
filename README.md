# BullPit

BullPit is a live classroom stock-market simulation with team trading, derivatives, disruption rounds, and a central display for public leaderboard and market coverage.

The main application lives in [`bullpit/`](./bullpit), with the projector display source currently tracked at the repository root in [`central-display.jsx`](./central-display.jsx).

## What Is Included

- Team trading interface with equities, shorts, and options
- GM controls for rounds, disruptions, predictions, and broadcasts
- Strategy Builder for defined-risk hedge packages
- Central display for projector mode, market feed, and rankings
- Printable rulebook in [`bullpit/docs/bullpit-rulebook.pdf`](./bullpit/docs/bullpit-rulebook.pdf)

## Run Locally

1. Install dependencies:

```bash
cd bullpit
npm install
```

2. Start the server:

```bash
node server.js
```

3. Open the app:

- Team / GM interface: [http://localhost:8080/](http://localhost:8080/)
- Central display: [http://localhost:8080/display.html](http://localhost:8080/display.html)

The server listens on port `8080` by default. You can override the GM password with the `BULLPIT_GM_PASSWORD` environment variable.

## Key Files

- [`bullpit/server.js`](./bullpit/server.js): HTTP server and session handling
- [`bullpit/game-engine.js`](./bullpit/game-engine.js): trade execution, settlements, and leaderboard scoring
- [`bullpit/stock-market-sim-v6.jsx`](./bullpit/stock-market-sim-v6.jsx): main player / GM source
- [`central-display.jsx`](./central-display.jsx): central display source
- [`bullpit/public/index.html`](./bullpit/public/index.html): main served page
- [`bullpit/public/display.html`](./bullpit/public/display.html): projector page

## Repo Notes

- Generated dependencies and runtime artifacts are ignored through the repository root `.gitignore`.
- The next major cleanup, if you want it, is to make `bullpit/` the actual repo root so GitHub stops being a Desktop-level repository.
