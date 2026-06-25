// game.js — core game engine for Salem Nights (final role set).
const { ROLES, LEVEL } = require('./roles');

const PHASE_TIMES = {
  lobby: 0,
  reveal: 6,
  night: 39,
  dayAnnounce: 8,
  day: 30,
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
  const jesterCount = 1;
  const townCount = n - mafiaCount - jesterCount;

  const list = [];

  // Mafia: Godfather, Mafioso, Consigliere, then a second Mafioso
  const mafiaRoles = ['Godfather', 'Mafioso', 'Consigliere', 'Mafioso'];
  for (let i = 0; i < mafiaCount; i++) list.push(mafiaRoles[i]);

  // Neutral: a single Jester occupies what would otherwise be a Villager slot
  for (let i = 0; i < jesterCount; i++) list.push('Jester');

  // Town: backbone first, then extra unique specials, then Villagers fill the rest
  const townPool = ['Jailor', 'Doctor', 'Investigator', 'Vigilante', 'Veteran', 'Lookout', 'Tracker', 'Medium'];
  const specialsCount = townCount <= 4 ? townCount : Math.min(townPool.length, townCount - 1);
  const town = townPool.slice(0, specialsCount);
  while (town.length < townCount) town.push('Villager');
  list.push(...town);

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
    if (phase === 'day') { this.votes = {}; this.lastTrialedToday = new Set(); }

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
        this.setPhase('day');
        break;
      case 'day': this.tallyNomination(); break;
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
    this.players.forEach(p => { p.jailed = false; p.onAlert = false; });
  }

  submitNightAction(playerId, type, targetId) {
    const p = this.getPlayer(playerId);
    if (!p || !p.alive || this.phase !== 'night') return;
    if (p.jailed && p.role !== 'Jailor') return;
    if (type === 'mafiakill' && this.day <= 1) return; // Mafia cannot kill the first night
    this.nightActions[playerId] = { type, targetId };
    this.io.to(playerId).emit('actionAck', { type, targetId });
    this.announceAction(p, type, targetId);
  }

  // Private confirmation of a chosen night action, posted to the right channel.
  announceAction(p, type, targetId) {
    const t = targetId ? this.getPlayer(targetId) : null;
    const tn = t ? t.name : '';
    const role = displayRole(p.role);
    const toSelf = (msg) => this.io.to(p.id).emit('chat', { from: 'System', text: msg, channel: 'system' });
    const toMafia = (msg) => this.players.filter(x => x.team === 'Mafia' && x.alive)
      .forEach(m => this.io.to(m.id).emit('chat', { from: 'System', text: msg, channel: 'mafia' }));
    switch (type) {
      case 'mafiakill': if (t) toMafia(`The ${role} has chosen to kill ${tn}.`); break;
      case 'kill': if (t) toSelf(`The Vigilante has decided to shoot ${tn}.`); break;
      case 'heal': if (t) toSelf(`The Doctor will protect ${tn} tonight.`); break;
      case 'investigate': if (t) toSelf(`The Investigator will investigate ${tn} tonight.`); break;
      case 'investigateExact': if (t) toSelf(`The Consigliere will examine ${tn}'s role tonight.`); break;
      case 'watch': if (t) toSelf(`The Lookout will watch ${tn}'s house tonight.`); break;
      case 'track': if (t) toSelf(`The Tracker will follow ${tn} tonight.`); break;
      case 'alert': toSelf('The Veteran has decided to go on alert.'); break;
      case 'none': toSelf('You have decided to do nothing tonight.'); break;
      default: break;
    }
  }

  // Jailor selects jail target during the DAY (before night).
  setJailTarget(jailorId, targetId) {
    const j = this.getPlayer(jailorId);
    if (!j || j.role !== 'Jailor' || !j.alive) return;
    j.jailTargetId = targetId;
    this.io.to(jailorId).emit('jailAck', { targetId });
  }

  // Jailor toggles the execution of their prisoner during the night.
  toggleExecute(jailorId) {
    const j = this.getPlayer(jailorId);
    if (!j || j.role !== 'Jailor' || !j.alive || this.phase !== 'night') return;
    if (!j.jailTargetId || j.executions <= 0) return;
    const prisoner = this.getPlayer(j.jailTargetId);
    if (!prisoner || !prisoner.alive) return;
    const armed = this.nightActions[jailorId] && this.nightActions[jailorId].type === 'execute';
    let msg;
    if (armed) { delete this.nightActions[jailorId]; msg = 'The Jailor has decided NOT to execute you tonight.'; }
    else { this.nightActions[jailorId] = { type: 'execute', targetId: null }; msg = 'The Jailor has decided to EXECUTE you at dawn.'; }
    [j.id, prisoner.id].forEach(id => this.io.to(id).emit('chat', { from: 'System', text: msg, channel: 'jail' }));
    this.io.to(j.id).emit('executeAck', { armed: !armed });
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
    const canAct = (pid) => { const p = byId(pid); return p && p.alive && !(p.jailed && p.role !== 'Jailor'); };

    // 1. Veteran alert (they stay home, so they do not visit)
    const onAlert = new Set();
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive) return;
      if (act.type === 'alert' && p.role === 'Veteran' && p.alerts > 0 && !(p.jailed)) {
        p.onAlert = true; p.alerts--; onAlert.add(pid);
      }
    });

    // 2. Compute visits (actions that travel to a target's house)
    const VISIT_TYPES = new Set(['heal', 'investigate', 'investigateExact', 'watch', 'track', 'kill', 'mafiakill']);
    const visits = {};      // targetId -> [visitorId]
    const visitedBy = {};   // visitorId -> targetId
    Object.entries(A).forEach(([pid, act]) => {
      if (!canAct(pid)) return;
      if (!VISIT_TYPES.has(act.type)) return;
      const p = byId(pid);
      if (act.type === 'kill' && p.role === 'Vigilante' && p.bullets <= 0) return;
      const t = byId(act.targetId);
      if (!t || !t.alive || act.targetId === pid) return;
      (visits[act.targetId] = visits[act.targetId] || []).push(pid);
      visitedBy[pid] = act.targetId;
    });

    // 3. Veteran kills every visitor; gains Basic defense (applied in defenseOf)
    onAlert.forEach(vetId => {
      (visits[vetId] || []).forEach(visId => {
        const v = byId(visId);
        if (v && v.alive) this.queueAttack(byId(vetId), v, LEVEL.POWERFUL, 'was cut down by a Veteran on alert');
      });
    });

    // 4. Doctor heals
    const healed = {};
    Object.entries(A).forEach(([pid, act]) => {
      if (!canAct(pid)) return;
      if (act.type === 'heal') { const t = byId(act.targetId); if (t && t.alive) healed[t.id] = pid; }
    });

    // 5. Mafia kill (one kill; Mafioso priority, else Godfather)
    const mafiaAlive = this.players.filter(p => p.alive && p.team === 'Mafia');
    const gf = mafiaAlive.find(p => p.role === 'Godfather');
    const mafioso = mafiaAlive.find(p => p.role === 'Mafioso');
    const actor = mafioso || gf;
    if (actor && canAct(actor.id) && this.day > 1) {
      let targetId = (gf && A[gf.id] && A[gf.id].type === 'mafiakill') ? A[gf.id].targetId : null;
      if (!targetId) { const o = mafiaAlive.map(m => A[m.id]).find(a => a && a.type === 'mafiakill'); if (o) targetId = o.targetId; }
      const t = targetId ? byId(targetId) : null;
      if (t && t.alive) this.queueAttack(actor, t, LEVEL.BASIC, 'was slain by the Mafia');
    }

    // 6. Vigilante
    Object.entries(A).forEach(([pid, act]) => {
      if (!canAct(pid)) return;
      const p = byId(pid);
      if (act.type === 'kill' && p.role === 'Vigilante' && p.bullets > 0) {
        const t = byId(act.targetId);
        if (t && t.alive) { p.bullets--; this.queueAttack(p, t, LEVEL.BASIC, 'was gunned down by a Vigilante'); }
      }
    });

    // 7. Jailor execution
    if (jailor && jailedId && A[jailor.id] && A[jailor.id].type === 'execute' && jailor.executions > 0) {
      const t = byId(jailedId);
      if (t) {
        jailor.executions--;
        this.queueAttack(jailor, t, LEVEL.UNSTOPPABLE, 'was executed by the Jailor');
        if (t.team === 'Town') { jailor.executions = 0; pushFeedback(jailor.id, 'You executed a Townsperson. You may execute no one else.'); }
      }
    }

    // 8. Resolve attacks (attack level vs defense; heal & alert grant Basic defense)
    const defenseOf = (pl) => {
      let d = ROLES[pl.role].defense || 0;
      if (healed[pl.id]) d = Math.max(d, LEVEL.BASIC);
      if (pl.onAlert) d = Math.max(d, LEVEL.BASIC);
      return d;
    };
    const dying = new Set();
    for (const atk of this._attacks) {
      const t = atk.target;
      if (atk.level > defenseOf(t)) { dying.add(t.id); t.deathReason = atk.reason; }
      else if (healed[t.id]) pushFeedback(t.id, 'You were attacked in the night, but a Doctor saved you!');
    }

    // 9. Investigative results
    Object.entries(A).forEach(([pid, act]) => {
      if (!canAct(pid)) return;
      const p = byId(pid);
      const t = byId(act.targetId);
      if (act.type === 'investigate' && p.role === 'Investigator' && t) {
        const suspicious = (t.team === 'Mafia' && t.role !== 'Godfather');
        pushFeedback(pid, `Your investigation of ${t.name}: they ${suspicious ? 'APPEAR TO WORK WITH THE MAFIA' : 'appear innocent'}.`);
      }
      if (act.type === 'investigateExact' && p.role === 'Consigliere' && t) {
        pushFeedback(pid, `Your investigation of ${t.name}: their exact role is ${displayRole(t.role)}.`);
      }
      if (act.type === 'watch' && p.role === 'Lookout' && t) {
        const vs = (visits[t.id] || []).filter(v => v !== pid).map(v => byId(v)).filter(Boolean).map(v => v.name);
        pushFeedback(pid, vs.length ? `Visitors to ${t.name}: ${vs.join(', ')}.` : `No one visited ${t.name}.`);
      }
      if (act.type === 'track' && p.role === 'Tracker' && t) {
        const dest = visitedBy[t.id] ? byId(visitedBy[t.id]) : null;
        pushFeedback(pid, dest ? `${t.name} visited ${dest.name}.` : `${t.name} did not leave home.`);
      }
    });

    // 10. Apply deaths
    const deathAnnings = [];
    dying.forEach(id => {
      const pl = byId(id);
      if (pl && pl.alive) { pl.alive = false; deathAnnings.push({ name: pl.name, reason: pl.deathReason || 'died' }); }
    });

    this.promoteMafia();
    this.deaths = deathAnnings;
    this.players.forEach(p => { p.jailTargetId = null; p.onAlert = false; });
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
    if (this.phase !== 'day') return;
    if (this.day <= 1) return; // no voting on the first day
    const v = this.getPlayer(voterId);
    if (!v || !v.alive) return;
    if (nominatedId === voterId) return;
    const t = this.getPlayer(nominatedId);
    if (!t || !t.alive) return;
    if (this.lastTrialedToday.has(nominatedId)) return;
    if (this.votes[voterId] === nominatedId) delete this.votes[voterId]; // click again to unvote
    else this.votes[voterId] = nominatedId;
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
      this.deaths = [{ name: d.name, reason: 'was executed by the Town' }];
      if (d.role === 'Jester') {
        d.jesterWon = true;
        // haunt a random guilty voter
        const victims = (this.guiltyVoters || []).map(id => this.getPlayer(id)).filter(p => p && p.alive);
        if (victims.length) {
          const v = victims[Math.floor(Math.random() * victims.length)];
          v.alive = false;
          v.deathReason = 'was haunted to death by the Jester';
          this.deaths.push({ name: v.name, reason: 'was found dead, haunted by the Jester' });
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

  hostSkipToNight() {
    if (!this.started) return;
    if (!['day', 'dayAnnounce', 'acquitted'].includes(this.phase)) return;
    if (this.timer) clearInterval(this.timer);
    this.onTrial = null;
    this.io.to(this.room).emit('chat', { from: 'System', text: 'The host has called for an early nightfall.', channel: 'system' });
    this.toNight();
  }

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
      revealedRole: (this.phase === 'gameOver') ? displayRole(p.role) : null
    }));
  }

  stateFor(playerId) {
    const me = this.getPlayer(playerId);
    const base = {
      room: this.room, phase: this.phase, day: this.day, timeLeft: this.timeLeft,
      players: this.publicPlayers(), hostId: this.hostId, started: this.started,
      onTrial: this.onTrial, deaths: this.deaths,
      trialResult: ['judgment', 'lastWords', 'acquitted'].includes(this.phase) ? this.trialResult : null,
      voteTally: this.phase === 'day' ? this.voteTallyPublic() : null,
      judgmentCount: this.phase === 'judgment' ? Object.keys(this.judgment).length : null,
      winner: this.winner, winMessage: this.winMessage, individualWins: this.individualWins
    };
    if (me) {
      base.me = {
        id: me.id, name: me.name, alive: me.alive, role: me.role ? displayRole(me.role) : null,
        roleKey: me.role, team: me.team, summary: me.role ? ROLES[me.role].summary : null,
        detail: me.role ? ROLES[me.role].detail : null,
        bullets: me.bullets, executions: me.executions, alerts: me.alerts,
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
