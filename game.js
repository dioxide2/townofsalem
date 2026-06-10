// game.js — core game engine for Salem Nights (Classic mode).
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

// Build a balanced role list for n players (7..15).
function buildRoleList(n) {
  // Mafia count scales ~1 per 4 players (min 1, max 4).
  let mafiaCount = Math.max(1, Math.min(4, Math.round(n / 4)));
  // Neutral count
  let neutralCount = n >= 9 ? 2 : 1;
  let townCount = n - mafiaCount - neutralCount;

  const list = [];

  // --- Mafia ---
  const mafiaPool = ['Godfather', 'Mafioso', 'Framer', 'Consigliere'];
  if (mafiaCount === 1) {
    list.push('Godfather');
  } else {
    list.push('Godfather', 'Mafioso');
    const extra = shuffle(['Framer', 'Consigliere']);
    for (let i = 0; i < mafiaCount - 2; i++) list.push(extra[i % extra.length]);
  }

  // --- Neutral ---
  const neutralPool = shuffle(['SerialKiller', 'Jester', 'Executioner']);
  // Always try to include Serial Killer for a third threat when room allows.
  const neutralChosen = [];
  neutralChosen.push('SerialKiller');
  for (const r of neutralPool) {
    if (neutralChosen.length >= neutralCount) break;
    if (r !== 'SerialKiller') neutralChosen.push(r);
  }
  neutralChosen.length = neutralCount;
  list.push(...neutralChosen);

  // --- Town ---
  // Guaranteed strong town backbone, then fill with random town.
  const guaranteed = ['Jailor', 'Doctor', 'Sheriff', 'Investigator'];
  const townFiller = shuffle([
    'Lookout', 'Bodyguard', 'Vigilante', 'Mayor', 'Medium', 'Escort', 'Veteran',
    'Sheriff', 'Investigator', 'Doctor', 'Lookout', 'Bodyguard'
  ]);
  const town = [];
  for (const g of guaranteed) {
    if (town.length < townCount) town.push(g);
  }
  let fi = 0;
  while (town.length < townCount && fi < townFiller.length) {
    const r = townFiller[fi++];
    // respect uniqueness
    if (ROLES[r].unique && town.includes(r)) continue;
    town.push(r);
  }
  // If still short (very large filler exhausted), pad with Sheriff/Doctor
  while (town.length < townCount) town.push('Investigator');
  list.push(...town.slice(0, townCount));

  return shuffle(list);
}

class Game {
  constructor(room, io) {
    this.room = room;       // room code
    this.io = io;
    this.players = [];      // {id, name, alive, role, ...}
    this.hostId = null;
    this.phase = 'lobby';
    this.day = 0;
    this.timer = null;
    this.timeLeft = 0;
    this.nightActions = {};  // playerId -> {type, targetId}
    this.votes = {};         // voterId -> nominatedId  (voting phase)
    this.judgment = {};      // voterId -> 'guilty'|'innocent'|'abstain'
    this.onTrial = null;     // playerId
    this.deaths = [];        // queued death announcements for next day
    this.chatLog = [];
    this.started = false;
    this.winner = null;
    this.lastTrialedToday = new Set();
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
      p.connected = false; // keep slot; allow logic to continue
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
      p.role = roleName;
      const def = ROLES[roleName];
      p.team = def.team;
      p.bullets = def.bullets || 0;
      p.alerts = def.alerts || 0;
      p.executions = roleName === 'Jailor' ? 1 : 0;
      p.revealed = false;
      p.alive = true;
      p.framed = false;
      p.roleHistory = roleName;
    });

    // Executioner target assignment
    const exec = this.players.find(p => p.role === 'Executioner');
    if (exec) {
      const townTargets = this.players.filter(p => p.team === 'Town');
      if (townTargets.length) {
        exec.execTargetId = shuffle(townTargets)[0].id;
      } else {
        exec.role = 'Jester'; exec.team = 'Neutral';
      }
    }

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
    if (phase === 'discussion') this.discussionEnter();

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
        if (this.day === 1) { this.setPhase('night'); this.day++; } // no trial day 1
        else this.setPhase('discussion');
        break;
      case 'discussion': this.setPhase('voting'); break;
      case 'voting': this.tallyNomination(); break;
      case 'defense': this.setPhase('judgment'); break;
      case 'judgment': this.resolveJudgment(); break;
      case 'lastWords': this.afterExecution(); break;
      default: break;
    }
  }

  // ---------- NIGHT ----------
  startNight() {
    this.nightActions = {};
    this.players.forEach(p => { p.framed = false; p.jailed = false; p.onAlert = false; });
    // Medium gets graveyard chat automatically (handled in chat routing).
  }

  submitNightAction(playerId, type, targetId) {
    const p = this.getPlayer(playerId);
    if (!p || !p.alive || this.phase !== 'night') return;
    if (p.jailed && p.role !== 'Jailor') return; // jailed can't act
    this.nightActions[playerId] = { type, targetId };
    // Mafia kill: share the chosen target with the faction
    if (type === 'mafiakill') {
      this.players.filter(x => x.team === 'Mafia' && x.alive)
        .forEach(m => { if (m.id !== playerId) {} });
    }
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
    const log = [];               // per-player private night feedback
    const pushFeedback = (pid, msg) => {
      (this.nightFeedback[pid] = this.nightFeedback[pid] || []).push(msg);
    };
    this.nightFeedback = {};

    // 0. Jail
    const jailor = this.players.find(p => p.role === 'Jailor' && p.alive);
    let jailedId = null;
    if (jailor && jailor.jailTargetId) {
      const jt = byId(jailor.jailTargetId);
      if (jt && jt.alive) { jt.jailed = true; jailedId = jt.id; }
    }

    // 1. Veteran alert
    this.players.forEach(p => {
      if (p.alive && A[p.id] && A[p.id].type === 'alert' && p.alerts > 0) {
        p.onAlert = true; p.alerts--;
      }
    });

    // Determine visits (everyone with a target that isn't self/none)
    const visits = {}; // targetId -> [visitorId]
    const visitTargetOf = {};
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive) return;
      if (p.jailed && p.role !== 'Jailor') return;
      if (!act.targetId || act.targetId === pid) return;
      if (['heal','protect','investigate','investigate2','watch','roleblock','frame','kill','mafiakill'].includes(act.type)) {
        (visits[act.targetId] = visits[act.targetId] || []).push(pid);
        visitTargetOf[pid] = act.targetId;
      }
    });

    // 2. Roleblocks (Escort) + jail blocking + SK retaliation
    const blocked = new Set();
    if (jailedId) blocked.add(jailedId);
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive || act.type !== 'roleblock') return;
      if (p.jailed) return;
      const t = byId(act.targetId);
      if (!t || !t.alive) return;
      if (t.role === 'SerialKiller') {
        // SK kills the roleblocker (immune to block)
        this.queueAttack(t, p, LEVEL.BASIC, 'was attacked by the Serial Killer they tried to distract');
        pushFeedback(pid, 'Your target resisted and turned on you!');
      } else {
        blocked.add(t.id);
        pushFeedback(t.id, 'Someone occupied your night — you could not act.');
        pushFeedback(pid, 'You distracted your target.');
      }
    });

    // helper attack queue
    this._attacks = this._attacks || [];

    // 3. Protections (Doctor heal, Bodyguard)
    const healed = {}; // targetId -> healerId
    const guards = {}; // targetId -> [bodyguardId]
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive || blocked.has(pid)) return;
      if (act.type === 'heal') {
        const t = byId(act.targetId);
        if (t && t.alive && !(t.role === 'Mayor' && t.revealed)) {
          healed[t.id] = pid;
        }
      }
      if (act.type === 'protect') {
        const t = byId(act.targetId);
        if (t && t.alive) (guards[t.id] = guards[t.id] || []).push(pid);
      }
    });

    // 4. Build attacks
    // Mafia kill: only one kill — prefer Mafioso, else Godfather.
    const mafiaActors = this.players.filter(p => p.alive && p.team === 'Mafia');
    const mafiaKillActs = Object.entries(A).filter(([pid, act]) => act.type === 'mafiakill' && byId(pid) && byId(pid).team === 'Mafia');
    if (mafiaKillActs.length) {
      // choose the actor: Mafioso priority
      let killer = null;
      const mafioso = mafiaActors.find(p => p.role === 'Mafioso');
      const gf = mafiaActors.find(p => p.role === 'Godfather');
      const actor = mafioso || gf || byId(mafiaKillActs[0][0]);
      // target: the Godfather's chosen target if present else first
      let targetId = null;
      const gfAct = gf && A[gf.id] && A[gf.id].type === 'mafiakill' ? A[gf.id].targetId : null;
      targetId = gfAct || mafiaKillActs[0][1].targetId;
      if (actor && !blocked.has(actor.id) && targetId) {
        const t = byId(targetId);
        if (t && t.alive) this.queueAttack(actor, t, LEVEL.BASIC, 'was killed by the Mafia');
      }
    }

    // Vigilante, Serial Killer
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive || blocked.has(pid)) return;
      if (act.type === 'kill' && p.role === 'Vigilante' && p.bullets > 0) {
        const t = byId(act.targetId);
        if (t && t.alive) { p.bullets--; this.queueAttack(p, t, LEVEL.BASIC, 'was shot by a Vigilante'); }
      }
      if (act.type === 'kill' && p.role === 'SerialKiller') {
        const t = byId(act.targetId);
        if (t && t.alive) this.queueAttack(p, t, LEVEL.BASIC, 'was killed by the Serial Killer');
      }
    });

    // Jailor execution
    if (jailor && jailedId && A[jailor.id] && A[jailor.id].type === 'execute' && jailor.executions > 0) {
      const t = byId(jailedId);
      if (t) {
        jailor.executions--;
        this.queueAttack(jailor, t, LEVEL.UNSTOPPABLE, 'was executed by the Jailor');
        if (t.team === 'Town') { jailor.executions = 0; pushFeedback(jailor.id, 'You executed a Townsperson. You will execute no more.'); }
      }
    }

    // Veteran kills visitors
    this.players.forEach(vet => {
      if (vet.alive && vet.onAlert) {
        (visits[vet.id] || []).forEach(visId => {
          const v = byId(visId);
          if (v && v.alive && v.id !== vet.id) {
            this.queueAttack(vet, v, LEVEL.POWERFUL, 'was killed by a Veteran on alert');
          }
        });
      }
    });

    // 5. Resolve attacks with defense, healing, bodyguards
    const defenseOf = (pl) => {
      let d = ROLES[pl.role].defense || 0;
      if (healed[pl.id]) d = Math.max(d, LEVEL.BASIC);
      if (pl.onAlert) d = Math.max(d, LEVEL.BASIC);
      return d;
    };

    const dyingThisNight = new Set();
    for (const atk of this._attacks) {
      const target = atk.target;
      if (!target.alive || dyingThisNight.has(target.id)) {
        // still record bodyguard? skip
      }
      // Bodyguard interception (only for direct kills on the guarded target)
      const gd = (guards[target.id] || []).filter(id => byId(id) && byId(id).alive && !dyingThisNight.has(id));
      if (gd.length && atk.attacker && atk.attacker.id !== target.id) {
        const bgId = gd[0];
        const bg = byId(bgId);
        // bodyguard kills attacker (basic) and dies; target saved
        dyingThisNight.add(bg.id);
        bg.deathReason = 'died protecting a neighbor';
        if (atk.attacker.alive) {
          const adef = defenseOf(atk.attacker);
          if (LEVEL.BASIC > adef) { dyingThisNight.add(atk.attacker.id); atk.attacker.deathReason = 'was slain by a Bodyguard'; }
        }
        pushFeedback(target.id, 'You were attacked, but your Bodyguard saved you!');
        continue;
      }
      if (atk.level > defenseOf(target)) {
        dyingThisNight.add(target.id);
        target.deathReason = atk.reason;
      } else {
        if (healed[target.id]) pushFeedback(target.id, 'You were attacked but nursed back to health!');
        else pushFeedback(target.id, 'You were attacked but your defense held!');
      }
    }

    // 6. Investigations / Lookout (use pre-death state, but report)
    Object.entries(A).forEach(([pid, act]) => {
      const p = byId(pid);
      if (!p || !p.alive || blocked.has(pid)) return;
      const t = byId(act.targetId);
      if (act.type === 'investigate' && t) {
        if (p.role === 'Sheriff') {
          let susp = (t.team === 'Mafia' && t.role !== 'Godfather') || t.role === 'SerialKiller';
          if (t.framed) susp = true;
          if (t.role === 'Godfather') susp = false;
          pushFeedback(pid, `Your interrogation: ${t.name} is ${susp ? 'SUSPICIOUS' : 'Not Suspicious'}.`);
        } else if (p.role === 'Consigliere') {
          pushFeedback(pid, `Your investigation: ${t.name}'s exact role is ${displayRole(t.role)}.`);
        }
      }
      if (act.type === 'investigate2' && t && p.role === 'Investigator') {
        pushFeedback(pid, `Clues on ${t.name}: their role could be one of — ${investigatorClue(t)}.`);
      }
      if (act.type === 'watch' && t && p.role === 'Lookout') {
        const vs = (visits[t.id] || []).map(id => byId(id)).filter(v => v && v.id !== pid).map(v => v.name);
        pushFeedback(pid, vs.length ? `Visitors to ${t.name}: ${vs.join(', ')}.` : `No one visited ${t.name}.`);
      }
    });

    // 7. Apply deaths
    const deathAnnings = [];
    dyingThisNight.forEach(id => {
      const pl = byId(id);
      if (pl && pl.alive) {
        pl.alive = false;
        deathAnnings.push({ name: pl.name, role: displayRole(pl.role), reason: pl.deathReason || 'died' });
        // Mafioso promotion
      }
    });

    // Vigilante guilt: if a vigilante killed a town member, mark guilt for next night
    // (simplified: handled by deathReason check)
    this.players.forEach(p => {
      if (p.role === 'Vigilante' && p.alive && A[p.id] && A[p.id].type === 'kill') {
        const t = byId(A[p.id].targetId);
        if (t && !t.alive && t.team === 'Town' && t.deathReason && t.deathReason.includes('Vigilante')) {
          p.guilt = true;
        }
      }
    });
    // Apply guilt deaths from previous night
    this.players.forEach(p => {
      if (p.pendingGuilt && p.alive) {
        p.alive = false;
        deathAnnings.push({ name: p.name, role: displayRole(p.role), reason: 'took their own life out of guilt' });
      }
    });
    this.players.forEach(p => { if (p.guilt) { p.pendingGuilt = true; p.guilt = false; } });

    // Mafioso promotion: if Godfather dead and Mafioso alive -> nothing; if Mafioso dead, promote a random mafia to Mafioso; if GF dead promote Mafioso to GF
    this.promoteMafia();

    // store feedback for clients
    this._attacks = [];
    this.deaths = deathAnnings;
    this.players.forEach(p => { p.jailTargetId = null; });

    this.setPhase('dayAnnounce');
  }

  queueAttack(attacker, target, level, reason) {
    this._attacks = this._attacks || [];
    this._attacks.push({ attacker, target, level, reason });
  }

  promoteMafia() {
    const aliveMafia = this.players.filter(p => p.alive && p.team === 'Mafia');
    const hasGF = aliveMafia.some(p => p.role === 'Godfather');
    const hasMafioso = aliveMafia.some(p => p.role === 'Mafioso');
    if (!hasGF && hasMafioso) {
      const m = aliveMafia.find(p => p.role === 'Mafioso');
      m.role = 'Godfather'; m.team = 'Mafia';
    } else if (!hasGF && !hasMafioso && aliveMafia.length) {
      aliveMafia[0].role = 'Godfather';
    } else if (hasGF && !hasMafioso && aliveMafia.length > 1) {
      const other = aliveMafia.find(p => p.role !== 'Godfather');
      if (other) other.role = 'Mafioso';
    }
  }

  // ---------- DAY: discussion / voting ----------
  discussionEnter() {}

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

  voteWeight(p) { return (p.role === 'Mayor' && p.revealed) ? 3 : 1; }

  checkNominationThreshold() {
    const tally = {};
    Object.entries(this.votes).forEach(([vid, nid]) => {
      const v = this.getPlayer(vid);
      if (v && v.alive) tally[nid] = (tally[nid] || 0) + this.voteWeight(v);
    });
    const aliveWeight = this.alivePlayers().reduce((s, p) => s + this.voteWeight(p), 0);
    const need = Math.floor(aliveWeight / 2) + 1;
    for (const [nid, count] of Object.entries(tally)) {
      if (count >= need) { this.putOnTrial(nid); return; }
    }
  }

  tallyNomination() {
    // time ran out — highest vote goes on trial if any, else night
    const tally = {};
    Object.entries(this.votes).forEach(([vid, nid]) => {
      const v = this.getPlayer(vid);
      if (v && v.alive) tally[nid] = (tally[nid] || 0) + this.voteWeight(v);
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
      if (verd === 'guilty') guilty += this.voteWeight(v);
      else if (verd === 'innocent') innocent += this.voteWeight(v);
    });
    const defendant = this.getPlayer(this.onTrial);
    this.trialResult = { name: defendant ? defendant.name : '?', guilty, innocent };
    if (defendant && guilty > innocent) {
      this.pendingExecution = defendant.id;
      this.setPhase('lastWords');
    } else {
      this.onTrial = null;
      // back to voting for another nomination if time? Simpler: go to night.
      this.toNight();
    }
  }

  afterExecution() {
    const d = this.getPlayer(this.pendingExecution);
    if (d && d.alive) {
      d.alive = false;
      d.deathReason = 'was executed by the Town';
      this.deaths = [{ name: d.name, role: displayRole(d.role), reason: 'was executed by the Town' }];
      // Jester win
      if (d.role === 'Jester') {
        d.jesterWon = true;
        this.jesterHaunt = d.id; // will haunt a guilty voter at night
      }
      // Executioner win
      this.players.forEach(p => {
        if (p.role === 'Executioner' && p.execTargetId === d.id && p.alive) p.execWon = true;
      });
      this.promoteMafia();
    }
    this.onTrial = null;
    this.pendingExecution = null;
    if (this.checkWin()) return;
    this.toNight();
  }

  toNight() {
    this.day++;
    this.setPhase('night');
  }

  // ---------- WIN CHECK ----------
  checkWin() {
    const alive = this.alivePlayers();
    const mafia = alive.filter(p => p.team === 'Mafia');
    const sk = alive.filter(p => p.role === 'SerialKiller');
    const town = alive.filter(p => p.team === 'Town');
    const neutralKillers = sk;

    // Jester already-won is an individual win but game continues; we surface it at game end.
    if (alive.length === 0) { this.endGame('Draw', 'Everyone has perished.'); return true; }

    // Serial Killer alone or SK >= everyone else
    if (sk.length >= 1 && mafia.length === 0 && (alive.length - sk.length) <= 0) {
      this.endGame('Serial Killer', 'The Serial Killer is the last soul standing.'); return true;
    }
    // Mafia win: no town-aligned threats and no SK, mafia >= rest
    if (mafia.length > 0 && neutralKillers.length === 0 && mafia.length >= (alive.length - mafia.length)) {
      this.endGame('Mafia', 'The Mafia controls Salem.'); return true;
    }
    // Town win: no mafia and no neutral killers
    if (mafia.length === 0 && neutralKillers.length === 0) {
      this.endGame('Town', 'The Town has rooted out every evildoer.'); return true;
    }
    return false;
  }

  endGame(winner, msg) {
    if (this.timer) clearInterval(this.timer);
    this.winner = winner;
    this.winMessage = msg;
    this.phase = 'gameOver';
    // collect individual winners
    this.individualWins = [];
    this.players.forEach(p => {
      if (p.jesterWon) this.individualWins.push(`${p.name} (Jester) got the last laugh.`);
      if (p.execWon) this.individualWins.push(`${p.name} (Executioner) saw their target hang.`);
    });
    this.broadcastState(true);
  }

  // jester haunt at night start
  applyJesterHaunt() {
    if (!this.jesterHaunt) return;
    // killed handled in next resolveNight via pendingGuilt-like — simplified:
    this.jesterHaunt = null;
  }

  // ---------- STATE BROADCAST ----------
  publicPlayers() {
    return this.players.map(p => ({
      id: p.id, name: p.name, alive: p.alive, connected: p.connected,
      isHost: p.id === this.hostId,
      revealedRole: (!p.alive || (p.role === 'Mayor' && p.revealed)) ? displayRole(p.role) : null,
      mayorRevealed: p.role === 'Mayor' && p.revealed
    }));
  }

  stateFor(playerId, gameOver = false) {
    const me = this.getPlayer(playerId);
    const base = {
      room: this.room, phase: this.phase, day: this.day, timeLeft: this.timeLeft,
      players: this.publicPlayers(), hostId: this.hostId, started: this.started,
      onTrial: this.onTrial, deaths: this.deaths,
      trialResult: this.phase === 'judgment' || this.phase === 'lastWords' ? this.trialResult : null,
      voteTally: this.phase === 'voting' ? this.voteTallyPublic() : null,
      judgmentCount: this.phase === 'judgment' ? Object.keys(this.judgment).length : null,
      winner: this.winner, winMessage: this.winMessage, individualWins: this.individualWins
    };
    if (me) {
      base.me = {
        id: me.id, name: me.name, alive: me.alive, role: me.role ? displayRole(me.role) : null,
        roleKey: me.role, team: me.team, summary: me.role ? ROLES[me.role].summary : null,
        detail: me.role ? ROLES[me.role].detail : null,
        bullets: me.bullets, alerts: me.alerts, executions: me.executions,
        revealed: me.revealed, jailTargetId: me.jailTargetId || null,
        execTargetName: me.execTargetId ? (this.getPlayer(me.execTargetId) || {}).name : null,
        actionType: me.role ? ROLES[me.role].actionType : null,
        feedback: (this.nightFeedback && this.nightFeedback[playerId]) || []
      };
      // Mafia see each other
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
      if (v && v.alive) tally[nid] = (tally[nid] || 0) + this.voteWeight(v);
    });
    const aliveWeight = this.alivePlayers().reduce((s, p) => s + this.voteWeight(p), 0);
    return { tally, need: Math.floor(aliveWeight / 2) + 1 };
  }

  broadcastState(gameOver = false) {
    this.players.forEach(p => {
      this.io.to(p.id).emit('state', this.stateFor(p.id, gameOver));
    });
  }
}

// ---------- helpers ----------
function displayRole(roleKey) {
  if (!roleKey) return '?';
  return roleKey.replace(/([A-Z])/g, ' $1').trim();
}

function investigatorClue(target) {
  // Original grouping for the investigator: returns a plausible set.
  const groups = [
    ['Sheriff', 'Escort', 'Consigliere'],
    ['Doctor', 'Mayor', 'Medium'],
    ['Investigator', 'Veteran', 'Framer'],
    ['Lookout', 'Mafioso', 'Vigilante'],
    ['Bodyguard', 'Godfather', 'Jailor'],
    ['SerialKiller', 'Executioner', 'Jester']
  ];
  let g = groups.find(gr => gr.includes(target.role));
  if (target.framed) g = groups.find(gr => gr.includes('Mafioso'));
  if (!g) g = groups[0];
  return g.map(displayRole).join(', ');
}

module.exports = { Game, buildRoleList, displayRole };
