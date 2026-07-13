# Puzzlevault

A turn-based tactical squad game in the style of *Into the Breach*, set in an original Chinese wuxia/xianxia world. Guide a squad of two cultivators — a sword-wielding melee fighter and a flying-sword adept — through waves of demons and ghosts whose next move is always telegraphed before you act. The puzzle is arranging your movement and techniques so their attacks miss.

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
