// test/engine.test.js — dependency-free verification of the game engine.
// Mocks Socket.io, drives many full games to completion, and checks invariants.
const { Game, buildRoleList, displayRole, mafiaCountFor } = require('../game');
const { ROLES } = require('../roles');

const mockIo = { to: () => ({ emit: () => {} }) };
let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  x ' + msg); } }

const ALLOWED = ['Villager', 'Jailor', 'Investigator', 'Doctor', 'Vigilante', 'Veteran', 'Lookout', 'Tracker', 'Medium', 'Godfather', 'Mafioso', 'Consigliere', 'Jester'];
const EXPECTED_MAFIA = { 7: 2, 8: 2, 9: 2, 10: 3, 11: 3, 12: 3, 13: 3, 14: 4, 15: 4 };

console.log('Role-list generation (7-15 players):');
for (let n = 7; n <= 15; n++) {
  const list = buildRoleList(n);
  assert(list.length === n, `n=${n}: list length matches`);
  assert(list.every(r => ALLOWED.includes(r)), `n=${n}: only allowed roles used`);
  const mafia = list.filter(r => ROLES[r].team === 'Mafia');
  const town = list.filter(r => ROLES[r].team === 'Town');
  const jesters = list.filter(r => r === 'Jester');
  assert(mafia.length === EXPECTED_MAFIA[n], `n=${n}: mafia count is ${EXPECTED_MAFIA[n]} (got ${mafia.length})`);
  assert(mafia.filter(r => r === 'Godfather').length === 1, `n=${n}: exactly one Godfather`);
  if (EXPECTED_MAFIA[n] >= 2) assert(list.includes('Mafioso'), `n=${n}: Mafioso present with 2+ mafia`);
  if (EXPECTED_MAFIA[n] >= 3) assert(list.includes('Consigliere'), `n=${n}: Consigliere present with 3 mafia`);
  if (EXPECTED_MAFIA[n] < 3) assert(!list.includes('Consigliere'), `n=${n}: no Consigliere below 3 mafia`);
  assert(jesters.length === 1, `n=${n}: exactly one Jester (got ${jesters.length})`);
  assert(town.length > mafia.length, `n=${n}: town outnumbers mafia at start`);
  // backbone present
  ['Jailor', 'Doctor', 'Investigator', 'Vigilante'].forEach(r =>
    assert(list.includes(r), `n=${n}: backbone has ${r}`));
  assert(list.filter(r => r === 'Jailor').length === 1, `n=${n}: exactly one Jailor`);
  ['Doctor','Investigator','Vigilante','Veteran','Lookout','Tracker','Medium'].forEach(r => assert(list.filter(x=>x===r).length <= 1, `n=${n}: at most one ${r}`));
  { const specials=['Jailor','Doctor','Investigator','Vigilante','Veteran','Lookout','Tracker','Medium']; const others = list.filter(r=>ROLES[r].team==='Town' && !specials.includes(r)); assert(others.every(r=>r==='Villager'), `n=${n}: all other town are Villagers`); }
  console.log(`  n=${n}: ${town.length}T / ${mafia.length}M / ${jesters.length}J  →  ${list.map(displayRole).join(', ')}`);
}
// explicit headline requirement
assert(mafiaCountFor(15) === 4, '15 players -> 4 mafia');

// ---- full games ----
function autoGame(n, label) {
  const g = new Game('T', mockIo);
  for (let i = 0; i < n; i++) g.addPlayer('p' + i, 'P' + i);
  const r = g.start();
  if (r.error) { assert(false, `${label}: start failed (${r.error})`); return; }
  if (g.timer) clearInterval(g.timer);
  const clear = () => { if (g.timer) { clearInterval(g.timer); g.timer = null; } };
  let guard = 0;
  while (g.phase !== 'gameOver' && guard < 400) {
    guard++; clear();
    const alive = g.alivePlayers();
    switch (g.phase) {
      case 'reveal': g.advancePhase(); break;
      case 'night':
        alive.forEach(p => {
          const at = ROLES[p.role].actionType;
          const others = alive.filter(x => x.id !== p.id);
          if (!others.length) return;
          const t = others[Math.floor(Math.random() * others.length)];
          if (p.role === 'Jailor') { if (p.jailTargetId && p.executions > 0 && Math.random() < 0.4) g.submitNightAction(p.id, 'execute', null); }
          else if (at === 'none') { /* villager / jester */ }
          else g.submitNightAction(p.id, at, t.id);
        });
        g.resolveNight(); break;
      case 'dayAnnounce': g.advancePhase(); break;
      case 'day': {
        const j = alive.find(p => p.role === 'Jailor');
        if (j) { const t = alive.find(p => p.id !== j.id); if (t) g.setJailTarget(j.id, t.id); }
        alive.forEach(p => { if (Math.random() < 0.7) { const o = alive.filter(x => x.id !== p.id); if (o.length) g.castVote(p.id, o[Math.floor(Math.random() * o.length)].id); } });
        if (g.phase === 'day') g.advancePhase();
        break;
      }
      case 'defense': g.advancePhase(); break;
      case 'judgment':
        g.alivePlayers().forEach(p => { if (p.id !== g.onTrial) g.castJudgment(p.id, ['guilty', 'guilty', 'innocent', 'abstain'][Math.floor(Math.random() * 4)]); });
        g.advancePhase(); break;
      case 'lastWords': g.advancePhase(); break;
      default: g.advancePhase();
    }
    clear();
    if (g.players.some(p => p.alive && !p.role)) { assert(false, `${label}: alive player without role`); break; }
  }
  clear();
  assert(g.phase === 'gameOver', `${label}: reached gameOver (guard=${guard})`);
  assert(['Town', 'Mafia', 'Draw'].includes(g.winner), `${label}: valid winner (${g.winner})`);
  return g.winner;
}

console.log('\nFull-game simulations:');
const winners = {};
for (let i = 0; i < 60; i++) { const n = 7 + (i % 9); const w = autoGame(n, `game#${i}(n=${n})`); winners[w] = (winners[w] || 0) + 1; }
console.log('  Winner distribution over 60 games:', winners);

// ---- combat checks ----
console.log('\nCombat resolution checks:');
function scenario(setup) {
  const g = new Game('C', mockIo);
  setup.players.forEach((_, i) => g.addPlayer('c' + i, 'C' + i));
  g.started = true; g.day = 2;
  g.players.forEach((p, i) => {
    const def = setup.players[i];
    p.role = def.role; p.team = ROLES[def.role].team; p.alive = true;
    p.bullets = def.bullets != null ? def.bullets : (ROLES[def.role].bullets || 0);
    p.alerts = def.alerts != null ? def.alerts : (ROLES[def.role].alerts || 0);
    p.executions = def.role === 'Jailor' ? 1 : 0;
  });
  g.phase = 'night'; g.startNight();
  setup.actions.forEach(a => g.submitNightAction('c' + a.from, a.type, a.target != null ? 'c' + a.target : null));
  if (setup.jail != null) g.setJailTarget('c' + setup.jail.from, 'c' + setup.jail.target);
  if (g.timer) clearInterval(g.timer);
  g.resolveNight();
  if (g.timer) clearInterval(g.timer);
  return g;
}

let g1 = scenario({ players: [{ role: 'Godfather' }, { role: 'Doctor' }, { role: 'Villager' }],
  actions: [{ from: 0, type: 'mafiakill', target: 2 }, { from: 1, type: 'heal', target: 2 }] });
assert(g1.getPlayer('c2').alive, 'Doctor heal saves the Mafia target');

let g2 = scenario({ players: [{ role: 'Godfather' }, { role: 'Doctor' }, { role: 'Villager' }],
  actions: [{ from: 0, type: 'mafiakill', target: 2 }, { from: 1, type: 'heal', target: 0 }] });
assert(!g2.getPlayer('c2').alive, 'Unprotected Mafia target dies');

let g3 = scenario({ players: [{ role: 'Vigilante', bullets: 1 }, { role: 'Villager' }, { role: 'Doctor' }],
  actions: [{ from: 0, type: 'kill', target: 1 }] });
assert(!g3.getPlayer('c1').alive, 'Vigilante shoots and kills');
assert(g3.getPlayer('c0').bullets === 0, 'Vigilante bullet count decremented');

let g4 = scenario({ players: [{ role: 'Vigilante', bullets: 0 }, { role: 'Villager' }, { role: 'Doctor' }],
  actions: [{ from: 0, type: 'kill', target: 1 }] });
assert(g4.getPlayer('c1').alive, 'Vigilante with no bullets cannot kill (3rd shot blocked)');

let g5 = scenario({ players: [{ role: 'Jailor' }, { role: 'Doctor' }, { role: 'Godfather' }],
  actions: [{ from: 0, type: 'execute', target: null }, { from: 1, type: 'heal', target: 2 }],
  jail: { from: 0, target: 2 } });
assert(!g5.getPlayer('c2').alive, 'Jailor execution kills jailed target despite a heal');

let g6 = scenario({ players: [{ role: 'Jailor' }, { role: 'Doctor' }, { role: 'Villager' }],
  actions: [{ from: 0, type: 'execute', target: null }],
  jail: { from: 0, target: 2 } });
assert(g6.getPlayer('c0').executions === 0, 'Executing a Townsperson burns the Jailor\'s executions');

let g7 = scenario({ players: [{ role: 'Investigator' }, { role: 'Godfather' }, { role: 'Mafioso' }],
  actions: [{ from: 0, type: 'investigate', target: 1 }] });
let fb1 = (g7.nightFeedback['c0'] || []).join(' ');
assert(/appear innocent/.test(fb1), 'Godfather appears innocent to Investigator');

let g8 = scenario({ players: [{ role: 'Investigator' }, { role: 'Godfather' }, { role: 'Mafioso' }],
  actions: [{ from: 0, type: 'investigate', target: 2 }] });
let fb2 = (g8.nightFeedback['c0'] || []).join(' ');
assert(/MAFIA/.test(fb2), 'Mafioso reads as working with the Mafia');

// mafioso promoted to godfather when GF dies
let g9 = scenario({ players: [{ role: 'Vigilante', bullets: 1 }, { role: 'Godfather' }, { role: 'Mafioso' }],
  actions: [{ from: 0, type: 'kill', target: 1 }] });
assert(g9.getPlayer('c2').role === 'Godfather', 'Mafioso promoted to Godfather after GF dies');

// ---- first-day full round & host early-night override ----
console.log('\nPhase-flow checks:');
(function () {
  const g = new Game('D', mockIo);
  for (let i = 0; i < 9; i++) g.addPlayer('d' + i, 'D' + i);
  g.start(); if (g.timer) clearInterval(g.timer);
  g.advancePhase(); if (g.timer) clearInterval(g.timer);
  assert(g.phase === 'night', 'after reveal -> night (Night 1)');
  g.resolveNight(); if (g.timer) clearInterval(g.timer);
  assert(g.phase === 'dayAnnounce', 'night resolves to dayAnnounce');
  g.advancePhase(); if (g.timer) clearInterval(g.timer);
  assert(g.phase === 'day', 'first day opens a full town meeting (no auto-skip back to night)');
  g.hostSkipToNight(); if (g.timer) clearInterval(g.timer);
  assert(g.phase === 'night', 'host early-night override jumps day -> night');
})();

let g10 = scenario({ players: [{ role: 'Consigliere' }, { role: 'Doctor' }, { role: 'Vigilante' }],
  actions: [{ from: 0, type: 'investigateExact', target: 2 }] });
assert(/exact role is Vigilante/.test((g10.nightFeedback['c0'] || []).join(' ')), 'Consigliere learns target\'s exact role');
assert(g10.getPlayer('c2').alive, 'Consigliere does not kill its target');

// Veteran alert kills visitors and survives a basic attack
let vt = scenario({ players: [{ role: 'Veteran' }, { role: 'Mafioso' }, { role: 'Godfather' }],
  actions: [{ from: 0, type: 'alert', target: 0 }, { from: 1, type: 'mafiakill', target: 0 }] });
assert(!vt.getPlayer('c1').alive, 'Veteran on alert kills the Mafia visitor');
assert(vt.getPlayer('c0').alive, 'Veteran survives the basic mafia attack while on alert');

// Veteran with no alerts left cannot alert
let vt0 = scenario({ players: [{ role: 'Veteran', alerts: 0 }, { role: 'Mafioso' }, { role: 'Godfather' }],
  actions: [{ from: 0, type: 'alert', target: 0 }, { from: 1, type: 'mafiakill', target: 0 }] });
assert(!vt0.getPlayer('c0').alive, 'Veteran with 0 alerts is killed (cannot alert)');

// Lookout sees visitors by name
let lo = scenario({ players: [{ role: 'Lookout' }, { role: 'Doctor' }, { role: 'Godfather' }, { role: 'Villager' }],
  actions: [{ from: 0, type: 'watch', target: 3 }, { from: 1, type: 'heal', target: 3 }, { from: 2, type: 'mafiakill', target: 3 }] });
{ const f = (lo.nightFeedback['c0'] || []).join(' '); assert(/C1/.test(f) && /C2/.test(f), 'Lookout sees the visitors (Doctor + Mafia)'); }

// Tracker sees where the target went
let tk = scenario({ players: [{ role: 'Tracker' }, { role: 'Doctor' }, { role: 'Villager' }],
  actions: [{ from: 0, type: 'track', target: 1 }, { from: 1, type: 'heal', target: 2 }] });
assert(/C1 visited C2/.test((tk.nightFeedback['c0'] || []).join(' ')), 'Tracker sees the target\'s destination');

console.log(`\n================  ${pass} passed, ${fail} failed  ================`);
process.exit(fail ? 1 : 0);
