# Dustline Ridge

[![make.fun competition](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/c/best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/nurdiyanto-87/flight-game-entry/rank.svg)](https://make.fun/c/best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/nurdiyanto-87/flight-game-entry/reward.svg)](https://make.fun/c/best-flight-game-20261126-0057)

A bush-plane flight game for the [make.fun best flight game bounty](https://make.fun/c/best-flight-game-20261126-0057): fly the 8 rings over the valley, mind your fuel, then bring her home to the Dustline strip.

## Play

Serve `game/` with any static server and open `game/index.html` in desktop Chrome — no build step, no network requests, no third-party packages:

```sh
node serve.ts
# game/ is on http://localhost:8080
```

## Controls

- **← → / A D** — bank and turn; **↑ ↓ / W S** — pitch (down is nose-down, up is nose-up)
- **Shift / Ctrl** (or **E / Q**) — throttle up / down; mouse wheel works the throttle too
- **Mouse** — steer with the pointer; **B** — brakes on the ground
- **Space / click** — start, restart; **P** — pause; **C** — chase / cockpit camera; **M** — mute; **R** — restart the sortie

## The sortie

Each sortie is a loop out over the valley and home: 8 glowing rings in order (100 pts each, +40 flown fast), then a landing on the Dustline strip (smooth +250, firm +120, sortie +200). Fuel burns with the throttle and the strip's crew refuels and patches you on landing; run dry and the engine quits, so a sortie is a decision about how much throttle the rings are worth. A hard arrival costs hull; a fast one ends the sortie. Later sorties fly lower and tighter.

The valley is all original and all procedural: rolling hills, a lake, a lighthouse on its hill, a turbine ridge, a village with lit windows, and snow on the northern wall. The cockpit view has a lit instrument panel — attitude, airspeed, altitude, heading, fuel, throttle and warning lamps.

## Layout

- `game/` — the game itself: `index.html` plus `src/` (config, seeded terrain, flight model, missions, input, renderer, cockpit instruments, screenshot staging, synthesised audio)
- `screenshots/` — 4 real renders of the game in headless Chrome (`1-cover.jpg` first)
- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to `/output` and writes `dossier.json`
- `vendor/makefun-game.ts` — the kit's library, unchanged
- `shots.json` — the four screenshot scenes (`?shot=cover|cockpit|landing|valley&seed=7`)

## License

MIT — see [LICENSE](LICENSE).
