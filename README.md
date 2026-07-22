# Puzzlevault

A turn-based tactical squad game in the style of *Into the Breach*, set in an original Chinese wuxia/xianxia world. Every enemy move is telegraphed before you act — the puzzle is arranging your movement and techniques so their attacks miss, or land on each other instead.

Pick 3 of 4 cultivators for your squad — Li Yan (sword qi striker), Su Qing (flying-sword duelist), Ling Er (shield/taunt tank), Bai Zhi (healer) — and fight through a 4-island, 17-mission campaign plus a final battle. Each island has 4 missions to choose 3 from before its boss unlocks. The whole campaign shares a single persistent base HP pool (the "grid") that carries across missions and never resets mid-run — if it hits zero, the campaign ends and you start over from island 1.

Play the current build: https://jesstsai0127.github.io/puzzlevault/

## Development

```
npm install
npm run dev      # local dev server (Vite)
npm test         # vitest — engine, content validation, i18n
npm run build    # production build to dist/
```

## Architecture

- `core/battle/engine.ts` — the turn-based battle state machine (moves, skills, AI intents, turn resolution, enemy reinforcement spawns)
- `core/campaign/state.ts` — pure functions for the persistent campaign layer: the shared base HP grid, mission unlock rules, and mid-mission-reload handling (no DOM/localStorage/Phaser dependency, fully unit-testable)
- `src/campaign/storage.ts` — localStorage persistence for campaign state, with a cross-tab write-race guard
- `core/content/` — data-driven content model (`formatVersion` + `parse`/`validate`) for characters, skills, monsters, and maps; all JSON, no hardcoded content
- `core/i18n/` — locale key lookup with fallback (`locales/en.json` is the source of truth, `locales/zh-TW.json` is supplemental)
- `src/scenes/BattleScene.ts` — the Phaser 3 scene: mouse-driven unit/tile selection, skill targeting, intent telegraphs
- `src/scenes/LevelSelectScene.ts` — campaign map/island selection, mission unlock display, grid HP readout

## Design notes

- No mid-mission restart, matching *Into the Breach*: leaving or reloading during an active mission counts as a loss and deducts the shared grid accordingly. Each mission does still get one in-battle turn reset (undo your last turn), consumed once per mission.
- `tools/greedy-play.ts` and `tools/greedy-campaign.ts` are automated difficulty audits — a scripted "don't dodge, don't think" bot that plays every mission (or the full 17-mission campaign with a persisted grid) to check the floor of the difficulty curve.
- `design/itb-alignment-spec.md` tracks every deliberate deviation from *Into the Breach* and the reasoning behind it.

Pushing to `master` auto-deploys to GitHub Pages via `.github/workflows/deploy-pages.yml`.
