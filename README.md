# Puzzlevault

A turn-based tactical squad game in the style of *Into the Breach*, set in an original magic-academy world. Move a 2-character squad through waves of monsters whose next move is always telegraphed before you act — the puzzle is arranging your moves and spells so their attacks miss.

Play the current build: https://jesstsai0127.github.io/puzzlevault/

## Development

```
npm install
npm run dev      # local dev server (Vite)
npm test         # vitest — engine, content validation, i18n
npm run build    # production build to dist/
```

## Architecture

- `core/battle/engine.ts` — the turn-based battle state machine (moves, skills, AI intents, turn resolution)
- `core/content/` — data-driven content model (`formatVersion` + `parse`/`validate`) for characters, skills, monsters, and maps; all JSON, no hardcoded content
- `core/i18n/` — locale key lookup with fallback (`locales/en.json` is the source of truth, `locales/zh-TW.json` is supplemental)
- `src/scenes/BattleScene.ts` — the Phaser 3 scene: mouse-driven unit/tile selection, skill targeting, intent telegraphs

Pushing to `master` auto-deploys to GitHub Pages via `.github/workflows/deploy-pages.yml`.
