import { parseLevelFile } from '../core/level';
import type { LevelData } from '../core/level';
import lvl1 from './lvl-1.json';
import lvl2 from './lvl-2.json';
import lvl3 from './lvl-3.json';

// Builtin levels go through the same parse+validate path that downloaded
// level packs will use in Phase 2 — one format, one code path.
export const LEVELS: LevelData[] = [lvl1, lvl2, lvl3].map(parseLevelFile);
