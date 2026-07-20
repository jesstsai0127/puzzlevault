import { readFileSync } from 'node:fs';
import { BattleEngine } from '../core/battle/engine';
import { maps, registry } from '../content/registry';

// Plan JSON: { mapId, turns: [ [action, ...], ... ] }
// action = ["move", unitIdx, [x,y]] | ["skill", unitIdx, skillId, dir] | ["rest", unitIdx]
const planPath = process.argv[2];
if (!planPath) {
  console.error('usage: run-solution.ts <plan.json>');
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8')) as {
  mapId: string;
  turns: unknown[][];
};

const map = maps[plan.mapId];
const engine = new BattleEngine(map, map.squadCharacterIds!, registry);

function dump(label: string) {
  const s = engine.getSnapshot();
  const ps = s.players.map((p, i) => `P${i}:${p.characterId}@(${p.position.x},${p.position.y})h${p.hp}${p.acted ? '*' : ''}`).join(' ');
  const ms = s.monsters.filter((m) => m.hp > 0).map((m) => `${m.monsterId}@(${m.position.x},${m.position.y})h${m.hp}`).join(' ');
  console.log(`${label} base=${s.baseHp} outcome=${s.outcome ?? '-'}\n    ${ps}\n    ${ms}`);
}

dump('start');
plan.turns.forEach((actions, t) => {
  if (engine.getSnapshot().outcome) return;
  for (const a of actions as any[]) {
    const [kind, idx] = a;
    let res;
    if (kind === 'move') res = engine.moveUnit(idx, { x: a[2][0], y: a[2][1] });
    else if (kind === 'skill') res = engine.useSkill(idx, a[2], a[3]);
    else if (kind === 'rest') res = engine.rest(idx);
    if (res && !res.ok) console.log(`  !! T${t + 1} ${JSON.stringify(a)} REJECTED: ${res.reason}`);
  }
  engine.endTurn();
  dump(`after T${t + 1}`);
});
console.log(`FINAL outcome=${engine.getSnapshot().outcome ?? '(none — survived actions but clock not out)'}`);
