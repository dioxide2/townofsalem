// game.js — core game engine for Salem Nights (final role set).
const { ROLES, LEVEL } = require('./roles');

const PHASE_TIMES = {
  lobby: 0,
  reveal: 6,
  night: 35,
  dayAnnounce: 8,
  discussion: 45,
  voting: 45,
  defense: 25,
  judgment: 20,
  lastWords: 8,
  acquitted: 5,
  gameOver: 0
};

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Mafia count by player count (15 -> 4, scaling ~27%).
function mafiaCountFor(n) {
  const c = Math.round(n / 3.75);
  return Math.max(1, Math.min(4, c));
}

// Build a balanced role list for n players (7..15).
//   Town backbone: Jailor, Doctor, Investigator, Vigilante, rest Villagers.
//   Mafia: 1 Godfather + (mafiaCount-1) Mafioso.
//   Neutral: 1 Jester only when n >= 9.
function buildRoleList(n) {
  const mafiaCount = mafiaCountFor(n);
  const jesterCount = n >= 9 ? 1 : 0;
  const townCount = n - mafiaCount - jesterCount;

  const list = [];

  // Mafia
  list.push('Godfather');
  for (let i = 1; i < mafiaCount; i++) list.push('Mafioso');

  // Neutral
  for (let i = 0; i < jesterCount; i++) list.push('Jester');

  // Town backbone, then fill with Villagers
  const backbone = ['Jailor', 'Doctor', 'Investigator', 'Vigilante'];
  const town = [];
  for (const r of backbone) { if (town.length < townCount) town.push(r); }
  while (town.length < townCount) town.push('Villager');
  list.push(...town.slice(0, townCount));

  return shuffle(list);
}

class Game {
  constructor(room, io) {
    this.room = room;
    this.io = io;
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby';
    this.day = 0;
    this.timer = null;
    this.timeLeft = 0;
    this.nightActions = {};
    this.votes = {};
    this.judgment = {};
    this.onTrial = null;
    this.deaths = [];
    this.started = false;
    this.winner = null;
    this.lastTrialedToday = new Set();
    this.nightFeedback = {};
    this._attacks = [];
  }

  addPlayer(id, name) {
    if (this.started) return { error: 'Game already in progress.' };
    if (this.players.length >= 15) return { error: 'Room is full (15 max).' };
    if (this.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
      return { error: 'That name is taken in this room.' };
    const p = { id, name, alive: true, role: null, connected: true };
    this.players.push(p);
    if (!this.hostId) this.hostId = id;
    return { player: p };
  }

  removePlayer(id) {
    const p = this.players.find(x => x.id === id);
    if (!p) return;
    if (!this.started) {
      this.players = this.players.filter(x => x.id !== id);
      if (this.hostId === id && this.players.length) this.hostId = this.players[0].id;
    } else {
      p.connected = false;
    }
  }

  getPlayer(id) { return this.players.find(p => p.id === id); }
  alivePlayers() { return this.players.filter(p => p.alive); }

  start() {
    const n = this.players.length;
    if (n < 7) return { error: 'Need at least 7 players to start.' };
    const roleList = buildRoleList(n);
    const shuffledPlayers = shuffle(this.players);
    shuffledPlayers.forEach((p, i) => {
      const roleName = roleList[i];
      const def = ROLES[roleName];
      p.role = roleName;
      p.team = def.team;
      p.bullets = def.bullets || 0;
      p.executions = roleName === 'Jailor' ? 1 : 0;
      p.alive = true;
    });
    this.started = true;
    this.day = 1;
    this.setPhase('reveal');
    return { ok: true };
  }

  // ---------- phase management ----------
  setPhase(phase) {
    this.phase = phase;
    const speed = parseFloat(process.env.PHASE_SPEED || '1');
    const base = PHASE_TIMES[phase] || 0;
    this.timeLeft = base > 0 ? Math.max(1, Math.round(base * speed)) : 0;
    if (this.timer) clearInterval(this.timer);

    if (phase === 'night') this.startNight();
    if (phase === 'voting') { this.votes = {}; this.lastTrialedToday = new Set(); }

    this.broadcastState();

    if (this.timeLeft > 0) {
      this.timer = setInterval(() => {
        this.timeLeft--;
        this.io.to(this.room).emit('tick', { timeLeft: this.timeLeft, phase: this.phase });
        if (this.timeLeft <= 0) {
          clearInterval(this.timer);
          this.advancePhase();
        }
      }, 1000);
    }
  }

  advancePhase() {
    switch (this.phase) {
      case 'reveal': this.setPhase('night'); break;
      case 'night': this.resolveNight(); break;
      case 'dayAnnounce':
        if (this.checkWin()) return;
        if (this.day === 1) { this.day++; this.setPhase('night'); } // no trial first day
        else this.setPhase('discussion');
        break;
      case 'discussion': this.setPhase('voting'); break;
      case 'voting': this.tallyNomination(); break;
      case 'defense': this.setPhase('judgment'); break;
      case 'judgment': this.resolveJudgment(); break;
      case 'acquitted': this.toNight(); break;
      case 'lastWords': this.afterExecution(); break;
      default: break;
    }
  }

  // ---------- NIGHT ----------
  startNight() {
    this.nightActions = {};
    this.players.forEach(p => { p.jailed = false; });
  }

  submitNightAction(playerId, type, targetId) {
    const p = this.getPlayer(playerId);
    if (!p || !p.alive || this.phase !== 'night') return;
    if (p.jailed && p.role !== 'Jailor') return;
    this.nightActions[playerId] = { type, targetId };
    this.io.to(playerId).emit('actionAck', { type, targetId });
  }

  // Jailor selects jail target during the DAY (before night).
  setJailTarget(jailorId, targetId) {
    const j = this.getPlayer(jailorId);
    if (!j || j.role !== 'Jailor' || !j.alive) return;
    j.jailTargetId = targetId;
    this.io.to(jailorId).emit('jailAck', { targetId });
  }

  resolveNight() {
    const A = this.nightActions;
    const byId = id => this.getPlayer(id);
    this.nightFeedback = {};
    this._attacks = [];
    const pushFeedback = (pid, msg) => { (this.nightFeedback[pid] = this.nightFeedback[pid] || []).push(msg); };

    // 0. Jail
    const jailor = this.players.find(p => p.role === 'Jailor' && p.alive);
    let jailedId = null;
    if (jailor && jailor.jailTargetId) {
      const jt = byId(jailor.jailTargetId);
      if (jt && jt.alive) { jt.jailed = true; jailedId = jt.id; }
    }

    // visits (for potential future features / lookout-style; kept minimal)
    const blocked = new Set();
    if (jailedId) blocked.add(jailedId);

    // 1. Doctor heals
    const healed = {}; // targetId -> healerId
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive || blocked.has(pid)) return;
      if (act.type === 'heal') {
        const t = byId(act.targetId);
        if (t && t.alive) healed[t.id] = pid;
      }
    });

    // 2. Mafia kill (single kill; Mafioso priority, else Godfather)
    const mafiaAlive = this.players.filter(p => p.alive && p.team === 'Mafia');
    const gf = mafiaAlive.find(p => p.role === 'Godfather');
    const mafioso = mafiaAlive.find(p => p.role === 'Mafioso');
    const actor = mafioso || gf;
    if (actor && !blocked.has(actor.id)) {
      // target: Godfather's order if present, else any mafia order
      let targetId = (gf && A[gf.id] && A[gf.id].type === 'mafiakill') ? A[gf.id].targetId : null;
      if (!targetId) {
        const anyOrder = mafiaAlive.map(m => A[m.id]).find(a => a && a.type === 'mafiakill');
        if (anyOrder) targetId = anyOrder.targetId;
      }
      const t = targetId ? byId(targetId) : null;
      if (t && t.alive) this.queueAttack(actor, t, LEVEL.BASIC, 'was slain by the Mafia');
    }

    // 3. Vigilante
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive || blocked.has(pid)) return;
      if (act.type === 'kill' && p.role === 'Vigilante' && p.bullets > 0) {
        const t = byId(act.targetId);
        if (t && t.alive) { p.bullets--; this.queueAttack(p, t, LEVEL.BASIC, 'was gunned down by a Vigilante'); }
      }
    });

    // 4. Jailor execution
    if (jailor && jailedId && A[jailor.id] && A[jailor.id].type === 'execute' && jailor.executions > 0) {
      const t = byId(jailedId);
      if (t) {
        jailor.executions--;
        this.queueAttack(jailor, t, LEVEL.UNSTOPPABLE, 'was executed by the Jailor');
        if (t.team === 'Town') { jailor.executions = 0; pushFeedback(jailor.id, 'You executed a Townsperson. You may execute no one else.'); }
      }
    }

    // 5. Resolve attacks (defense vs attack; heal grants Basic defense)
    const defenseOf = (pl) => {
      let d = ROLES[pl.role].defense || 0;
      if (healed[pl.id]) d = Math.max(d, LEVEL.BASIC);
      return d;
    };
    const dying = new Set();
    for (const atk of this._attacks) {
      const t = atk.target;
      if (atk.level > defenseOf(t)) { dying.add(t.id); t.deathReason = atk.reason; }
      else if (healed[t.id]) pushFeedback(t.id, 'You were attacked in the night, but a Doctor saved you!');
    }

    // 6. Investigator results (Godfather appears innocent)
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive || blocked.has(pid)) return;
      if (act.type === 'investigate' && p.role === 'Investigator') {
        const t = byId(act.targetId);
        if (t) {
          const suspicious = (t.team === 'Mafia' && t.role !== 'Godfather');
          pushFeedback(pid, `Your investigation of ${t.name}: they ${suspicious ? 'APPEAR TO WORK WITH THE MAFIA' : 'appear innocent'}.`);
        }
      }
    });

    // 7. Apply deaths
    const deathAnnings = [];
    dying.forEach(id => {
      const pl = byId(id);
      if (pl && pl.alive) {
        pl.alive = false;
        deathAnnings.push({ name: pl.name, role: displayRole(pl.role), reason: pl.deathReason || 'died' });
      }
    });

    this.promoteMafia();
    this.deaths = deathAnnings;
    this.players.forEach(p => { p.jailTargetId = null; });
    this.setPhase('dayAnnounce');
  }

  queueAttack(attacker, target, level, reason) {
    this._attacks.push({ attacker, target, level, reason });
  }

  promoteMafia() {
    const aliveMafia = this.players.filter(p => p.alive && p.team === 'Mafia');
    const hasGF = aliveMafia.some(p => p.role === 'Godfather');
    if (!hasGF && aliveMafia.length) {
      // promote a Mafioso (or any) to Godfather
      const m = aliveMafia.find(p => p.role === 'Mafioso') || aliveMafia[0];
      m.role = 'Godfather';
    }
  }

  // ---------- DAY: voting / trial ----------
  castVote(voterId, nominatedId) {
    if (this.phase !== 'voting') return;
    const v = this.getPlayer(voterId);
    if (!v || !v.alive) return;
    if (nominatedId === voterId) return;
    const t = this.getPlayer(nominatedId);
    if (!t || !t.alive) return;
    if (this.lastTrialedToday.has(nominatedId)) return;
    this.votes[voterId] = nominatedId;
    this.checkNominationThreshold();
    this.broadcastState();
  }

  checkNominationThreshold() {
    const tally = {};
    Object.entries(this.votes).forEach(([vid, nid]) => {
      const v = this.getPlayer(vid);
      if (v && v.alive) tally[nid] = (tally[nid] || 0) + 1;
    });
    const need = Math.floor(this.alivePlayers().length / 2) + 1;
    for (const [nid, count] of Object.entries(tally)) {
      if (count >= need) { this.putOnTrial(nid); return; }
    }
  }

  tallyNomination() {
    const tally = {};
    Object.entries(this.votes).forEach(([vid, nid]) => {
      const v = this.getPlayer(vid);
      if (v && v.alive) tally[nid] = (tally[nid] || 0) + 1;
    });
    let top = null, topCount = 0;
    for (const [nid, c] of Object.entries(tally)) if (c > topCount) { top = nid; topCount = c; }
    if (top && topCount > 0) this.putOnTrial(top);
    else this.toNight();
  }

  putOnTrial(nid) {
    if (this.timer) clearInterval(this.timer);
    this.onTrial = nid;
    this.judgment = {};
    this.lastTrialedToday.add(nid);
    this.setPhase('defense');
  }

  castJudgment(voterId, verdict) {
    if (this.phase !== 'judgment') return;
    const v = this.getPlayer(voterId);
    if (!v || !v.alive || voterId === this.onTrial) return;
    if (!['guilty', 'innocent', 'abstain'].includes(verdict)) return;
    this.judgment[voterId] = verdict;
    this.broadcastState();
  }

  resolveJudgment() {
    let guilty = 0, innocent = 0;
    Object.entries(this.judgment).forEach(([vid, verd]) => {
      const v = this.getPlayer(vid);
      if (!v || !v.alive) return;
      if (verd === 'guilty') guilty += 1;
      else if (verd === 'innocent') innocent += 1;
    });
    const defendant = this.getPlayer(this.onTrial);
    this.trialResult = { name: defendant ? defendant.name : '?', guilty, innocent };
    if (defendant && guilty > innocent) {
      this.pendingExecution = defendant.id;
      this.guiltyVoters = Object.entries(this.judgment).filter(([, v]) => v === 'guilty').map(([id]) => id);
      this.setPhase('lastWords');
    } else {
      this.acquittedId = this.onTrial;
      this.onTrial = null;
      this.setPhase('acquitted');
    }
  }

  afterExecution() {
    const d = this.getPlayer(this.pendingExecution);
    if (d && d.alive) {
      d.alive = false;
      d.deathReason = 'was executed by the Town';
      this.deaths = [{ name: d.name, role: displayRole(d.role), reason: 'was executed by the Town' }];
      if (d.role === 'Jester') {
        d.jesterWon = true;
        // haunt a random guilty voter
        const victims = (this.guiltyVoters || []).map(id => this.getPlayer(id)).filter(p => p && p.alive);
        if (victims.length) {
          const v = victims[Math.floor(Math.random() * victims.length)];
          v.alive = false;
          v.deathReason = 'was haunted to death by the Jester';
          this.deaths.push({ name: v.name, role: displayRole(v.role), reason: 'was found dead, haunted by the Jester' });
        }
      }
      this.promoteMafia();
    }
    this.onTrial = null;
    this.pendingExecution = null;
    if (this.checkWin()) return;
    this.toNight();
  }

  toNight() { this.day++; this.setPhase('night'); }

  // ---------- WIN CHECK ----------
  checkWin() {
    const alive = this.alivePlayers();
    const mafia = alive.filter(p => p.team === 'Mafia');
    const town = alive.filter(p => p.team === 'Town');

    if (alive.length === 0) { this.endGame('Draw', 'Salem lies empty. No one survived.'); return true; }
    // Mafia win: mafia >= everyone else and at least one mafia
    if (mafia.length > 0 && mafia.length >= (alive.length - mafia.length)) {
      this.endGame('Mafia', 'The Mafia has seized control of Salem.'); return true;
    }
    // Town win: no mafia left
    if (mafia.length === 0) {
      this.endGame('Town', 'The Town has driven out the Mafia.'); return true;
    }
    return false;
  }

  endGame(winner, msg) {
    if (this.timer) clearInterval(this.timer);
    this.winner = winner;
    this.winMessage = msg;
    this.phase = 'gameOver';
    this.individualWins = [];
    this.players.forEach(p => { if (p.jesterWon) this.individualWins.push(`${p.name} (Jester) got the last laugh.`); });
    this.broadcastState(true);
  }

  // ---------- STATE BROADCAST ----------
  publicPlayers() {
    return this.players.map(p => ({
      id: p.id, name: p.name, alive: p.alive, connected: p.connected,
      isHost: p.id === this.hostId,
      revealedRole: (!p.alive) ? displayRole(p.role) : null
    }));
  }

  stateFor(playerId) {
    const me = this.getPlayer(playerId);
    const base = {
      room: this.room, phase: this.phase, day: this.day, timeLeft: this.timeLeft,
      players: this.publicPlayers(), hostId: this.hostId, started: this.started,
      onTrial: this.onTrial, deaths: this.deaths,
      trialResult: ['judgment', 'lastWords', 'acquitted'].includes(this.phase) ? this.trialResult : null,
      voteTally: this.phase === 'voting' ? this.voteTallyPublic() : null,
      judgmentCount: this.phase === 'judgment' ? Object.keys(this.judgment).length : null,
      winner: this.winner, winMessage: this.winMessage, individualWins: this.individualWins
    };
    if (me) {
      base.me = {
        id: me.id, name: me.name, alive: me.alive, role: me.role ? displayRole(me.role) : null,
        roleKey: me.role, team: me.team, summary: me.role ? ROLES[me.role].summary : null,
        detail: me.role ? ROLES[me.role].detail : null,
        bullets: me.bullets, executions: me.executions,
        jailTargetId: me.jailTargetId || null,
        actionType: me.role ? ROLES[me.role].actionType : null,
        feedback: (this.nightFeedback && this.nightFeedback[playerId]) || []
      };
      if (me.team === 'Mafia') {
        base.allies = this.players.filter(p => p.team === 'Mafia')
          .map(p => ({ name: p.name, role: displayRole(p.role), alive: p.alive }));
      }
    }
    return base;
  }

  voteTallyPublic() {
    const tally = {};
    Object.entries(this.votes).forEach(([vid, nid]) => {
      const v = this.getPlayer(vid);
      if (v && v.alive) tally[nid] = (tally[nid] || 0) + 1;
    });
    return { tally, need: Math.floor(this.alivePlayers().length / 2) + 1 };
  }

  broadcastState() {
    this.players.forEach(p => { this.io.to(p.id).emit('state', this.stateFor(p.id)); });
  }
}

// ---------- helpers ----------
function displayRole(roleKey) {
  if (!roleKey) return '?';
  return roleKey.replace(/([A-Z])/g, ' $1').trim();
}

module.exports = { Game, buildRoleList, displayRole, mafiaCountFor };
