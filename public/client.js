// client.js — front-end controller for Salem Nights (radial walking village)
const socket = io();
let myId = null;
let state = null;
let selectedTarget = null;
let prevIsDay = null;
let sceneSig = null;
let prevWalkPhase = null;
let jailMode = false;

const $ = sel => document.querySelector(sel);
const screens = { home: $('#home'), lobby: $('#lobby'), game: $('#game'), over: $('#over') };
function show(name) { Object.values(screens).forEach(s => s.classList.remove('active')); screens[name].classList.add('active'); }

$('#titleEmblem').innerHTML = emblemFor('Jailor');

// ---------- HOME ----------
$('#createBtn').onclick = () => {
  const name = $('#nameInput').value.trim();
  if (!name) return showHomeError('Enter a name first.');
  socket.emit('createRoom', { name }, res => { if (res.error) return showHomeError(res.error); enterLobby(res.code); });
};
$('#joinBtn').onclick = () => {
  const name = $('#nameInput').value.trim();
  const code = $('#codeInput').value.trim().toUpperCase();
  if (!name) return showHomeError('Enter a name first.');
  if (!code) return showHomeError('Enter a room code.');
  socket.emit('joinRoom', { name, code }, res => { if (res.error) return showHomeError(res.error); enterLobby(res.code); });
};
$('#codeInput').addEventListener('input', e => e.target.value = e.target.value.toUpperCase());
function showHomeError(msg) { $('#homeError').textContent = msg; }
function enterLobby(code) { $('#roomCode').textContent = code; show('lobby'); }
$('#copyCode').onclick = () => navigator.clipboard?.writeText($('#roomCode').textContent);
$('#leaveBtn').onclick = () => { socket.emit('leaveRoom'); location.reload(); };
$('#overHome').onclick = () => location.reload();
$('#startBtn').onclick = () => socket.emit('startGame');

// ---------- SOCKET ----------
socket.on('connect', () => { myId = socket.id; });
socket.on('state', s => { state = s; render(); });
socket.on('tick', ({ timeLeft, phase }) => { if (state) { state.timeLeft = timeLeft; state.phase = phase; } $('#timer').textContent = timeLeft > 0 ? timeLeft : ''; });
socket.on('actionAck', ({ targetId }) => { selectedTarget = targetId; updateScene(); });
socket.on('jailAck', ({ targetId }) => { selectedTarget = targetId; updateScene(); });
socket.on('chat', msg => addChat(msg));

// ---------- RENDER ----------
function render() {
  if (!state) return;
  const phase = state.phase;
  if (phase === 'lobby') { renderLobby(); show('lobby'); return; }
  if (phase === 'gameOver') { renderOver(); show('over'); return; }
  show('game');
  const day = isDayPhase(phase);
  document.body.classList.toggle('is-day', day);
  if (prevIsDay !== null && prevIsDay !== day) { const f = $('#phaseFlash'); f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash'); }
  prevIsDay = day;
  if (phase !== 'day') jailMode = false;
  if (typeof Music !== 'undefined') { Music.ensureButton(); Music.setMood(day ? 'day' : 'night'); }
  renderHeader();
  renderRolePanel();
  renderAnnounce();
  renderTrial();
  renderVillage();
  renderActionBar();
  updateChatChannel();
}

function isDayPhase(p) { return ['dayAnnounce', 'day', 'defense', 'judgment', 'lastWords', 'acquitted'].includes(p); }
function isTrialPhase(p) { return ['defense', 'judgment', 'lastWords'].includes(p); }

function renderLobby() {
  $('#lobbyPlayers').innerHTML = state.players.map(p => `
    <div class="lobby-player">${avatarToken(p.name, true)}<span>${esc(p.name)}</span>${p.isHost ? '<span class="host-tag">Host</span>' : ''}</div>`).join('');
  const n = state.players.length, isHost = state.hostId === myId, startBtn = $('#startBtn');
  startBtn.style.display = isHost ? '' : 'none';
  startBtn.disabled = n < 7;
  $('#lobbyHint').textContent = isHost
    ? (n < 7 ? `Waiting for players… (${n}/7 minimum, 15 max)` : `${n} players ready. You may begin.`)
    : `Waiting for the host to begin… (${n} players)`;
}

const PHASE_LABEL = {
  reveal: 'Roles are dealt…', night: 'Night falls — the village sleeps', dayAnnounce: 'Dawn breaks',
  day: 'Town meeting — debate & vote', defense: 'The accused speaks',
  judgment: 'Render your verdict', lastWords: 'Final words', acquitted: 'Found innocent — they walk free'
};
function renderHeader() {
  const badge = $('#phaseBadge'), day = isDayPhase(state.phase);
  badge.textContent = (day ? 'Day ' : 'Night ') + state.day;
  badge.classList.toggle('day', day);
  $('#phaseName').textContent = PHASE_LABEL[state.phase] || '';
  $('#timer').textContent = state.timeLeft > 0 ? state.timeLeft : '';
}

function renderRolePanel() {
  const me = state.me;
  if (!me || !me.roleKey) return;
  $('#roleEmblem').innerHTML = emblemFor(me.roleKey);
  $('#roleName').textContent = me.role;
  const team = $('#roleTeam'); team.textContent = me.team; team.className = 'role-team ' + me.team;
  $('#roleSummary').textContent = me.summary || '';
  $('#roleDetail').textContent = me.detail || '';
  const stats = [];
  if (me.roleKey === 'Vigilante') stats.push(`Bullets: ${me.bullets}`);
  if (me.roleKey === 'Jailor') stats.push(`Executions: ${me.executions}`);
  if (!me.alive) stats.push('Deceased');
  $('#roleStats').innerHTML = stats.map(s => `<span class="chip">${esc(s)}</span>`).join('');
  $('#allies').innerHTML = (state.allies && me.team === 'Mafia')
    ? '<div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;">Your Family</div>' +
      state.allies.map(a => `<div class="ally">${esc(a.name)} — ${esc(a.role)}${a.alive ? '' : ' (dead)'}</div>`).join('')
    : '';
  const ah = $('#actionHint');
  if (state.hostId === myId && ['day', 'dayAnnounce'].includes(state.phase)) {
    ah.innerHTML = '<button id="hostSkipBtn" class="btn host-skip-big">\u23ED End Day \u2192 Night</button>';
    $('#hostSkipBtn').onclick = hostSkip;
  } else { ah.innerHTML = ''; }
  if (me.feedback && me.feedback.length && state.phase === 'dayAnnounce') {
    me.feedback.forEach(f => addChat({ from: 'Whispers', text: f, channel: 'system' }));
    me.feedback = [];
  }
}

function renderAnnounce() {
  const box = $('#announce');
  if (state.phase === 'dayAnnounce' && state.deaths && state.deaths.length) {
    box.innerHTML = state.deaths.map(d => `<span class="death">☠ ${esc(d.name)} ${esc(d.reason)}. Their role remains a mystery…</span>`).join('');
  } else if (state.phase === 'dayAnnounce') {
    box.innerHTML = '<span>The village awoke to find everyone alive.</span>';
  } else if (state.phase === 'day' && state.me && state.me.alive) {
    box.innerHTML = '<span class="vote-call">\uD83D\uDDF3\uFE0F Click a townsperson\u2019s house to vote them to the gallows \u2014 a majority sends them to trial.</span>';
  } else if (state.phase === 'day') {
    box.innerHTML = '<span>The town debates who to send to the gallows…</span>';
  } else { box.innerHTML = ''; }
}

function renderTrial() {
  const box = $('#trialBox');
  if (state.phase === 'acquitted') {
    const r = state.trialResult;
    box.classList.remove('hidden');
    box.innerHTML = `<h3>${esc(r ? r.name : 'The accused')} was found innocent</h3>` +
      `<p>The rope is set aside. They walk back to the village. (${r ? r.guilty : 0} guilty / ${r ? r.innocent : 0} innocent)</p>`;
    return;
  }
  if (isTrialPhase(state.phase)) {
    const def = state.players.find(p => p.id === state.onTrial);
    if (!def) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    let html = `<h3>${esc(def.name)} stands accused</h3>`;
    if (state.phase === 'defense') html += `<p>They approach the gallows to defend themselves. Prepare your verdict.</p>`;
    if (state.phase === 'judgment') {
      const meOnTrial = state.onTrial === myId;
      html += `<p>Cast your judgment. (${state.judgmentCount || 0} votes cast)</p>`;
      if (state.me.alive && !meOnTrial) {
        html += `<div class="judgment-btns">
          <button class="btn guilty" onclick="judge('guilty')">Guilty</button>
          <button class="btn innocent" onclick="judge('innocent')">Innocent</button>
          <button class="btn" onclick="judge('abstain')">Abstain</button></div>`;
      } else if (meOnTrial) { html += `<p style="color:var(--gold)">You stand at the gallows. Plead your case in chat.</p>`; }
    }
    if (state.phase === 'lastWords' && state.trialResult) {
      html += `<p>Verdict: <b style="color:var(--mafia)">${state.trialResult.guilty} Guilty</b> / ${state.trialResult.innocent} Innocent. The rope is readied…</p>`;
    }
    box.innerHTML = html;
  } else { box.classList.add('hidden'); }
}

// ---------- VILLAGE (radial, persistent figures) ----------
const HOUSE_R = 39, FIG_HOME_R = 33, FIG_DAY_R = 18;
function polar(i, n, R) { const a = (-90 + i * (360 / n)) * Math.PI / 180; return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) }; }

function renderVillage() {
  const sig = state.players.map(p => p.id).join(',');
  if (sig !== sceneSig) { buildScene(); sceneSig = sig; }
  updateScene();
}

function buildScene() {
  const N = state.players.length;
  let html = '<div class="cobble"></div><div class="gallows">' + gallowsSVG() + '</div>';
  state.players.forEach((p, i) => {
    const hp = polar(i, N, HOUSE_R);
    html += `<div class="house-unit" id="hu-${p.id}" data-id="${p.id}" style="left:${hp.x}%;top:${hp.y}%" onclick="pick('${p.id}')">
      <div class="votecount"></div><div class="ally-mark">🗡</div>
      ${houseSVG(p.name)}
      <div class="house-label">${esc(p.name)}${p.id === myId ? ' (you)' : ''}</div>
      <div class="prole"></div>
    </div>`;
  });
  state.players.forEach((p, i) => {
    const hp = polar(i, N, FIG_HOME_R);
    html += `<div class="fig" id="fig-${p.id}" data-id="${p.id}" style="left:${hp.x}%;top:${hp.y}%;opacity:0;transition-delay:${i * 55}ms" onclick="pick('${p.id}')">${figureSVG(p.name)}</div>`;
    html += `<div class="tomb-fig" id="tomb-${p.id}" style="left:${hp.x}%;top:${hp.y}%"></div>`;
  });
  $('#village').innerHTML = html;
}

function updateScene() {
  if (!state || !state.me) return;
  const N = state.players.length;
  const tally = state.voteTally ? state.voteTally.tally : {};
  const allyNames = new Set((state.allies || []).map(a => a.name));
  const phaseChanged = state.phase !== prevWalkPhase;
  prevWalkPhase = state.phase;

  state.players.forEach((p, i) => {
    const hu = document.getElementById('hu-' + p.id);
    const fig = document.getElementById('fig-' + p.id);
    const tomb = document.getElementById('tomb-' + p.id);
    if (!hu) return;

    const selectable = state.me.alive && canTarget(p);
    hu.classList.toggle('selectable', selectable);
    hu.classList.toggle('selected', selectedTarget === p.id);
    hu.classList.toggle('dead', !p.alive);
    hu.classList.toggle('me', p.id === myId);
    const vc = hu.querySelector('.votecount');
    if (state.phase === 'voting' && tally[p.id]) { vc.textContent = tally[p.id]; vc.style.display = 'block'; } else vc.style.display = 'none';
    const am = hu.querySelector('.ally-mark');
    am.style.display = (state.me.team === 'Mafia' && p.alive && allyNames.has(p.name) && p.id !== myId) ? 'block' : 'none';
    hu.querySelector('.prole').textContent = p.revealedRole || '';

    const home = polar(i, N, FIG_HOME_R);
    const ring = polar(i, N, FIG_DAY_R);
    if (fig) {
      fig.style.display = p.alive ? 'block' : 'none';
      const onTrial = isTrialPhase(state.phase) && state.onTrial === p.id;
      fig.classList.toggle('on-trial', onTrial);
      fig.classList.toggle('selectable', selectable);
      let pos, vis;
      if (onTrial) { pos = { x: 50, y: 56 }; vis = true; }       // walk up to the gallows
      else if (isDayPhase(state.phase)) { pos = ring; vis = true; } // gather in the square
      else { pos = home; vis = false; }                            // go inside at night
      fig.style.left = pos.x + '%'; fig.style.top = pos.y + '%';
      fig.style.opacity = vis ? '1' : '0';
      if (phaseChanged && p.alive) {
        fig.classList.add('walking');
        setTimeout(() => fig.classList.remove('walking'), 2700);
      }
    }
    if (tomb) {
      if (!p.alive) { if (!tomb.innerHTML) tomb.innerHTML = tombstoneSVG(); tomb.style.display = 'block'; }
      else tomb.style.display = 'none';
    }
  });
}

function canTarget(p) {
  const phase = state.phase, me = state.me;
  if (!me.alive) return false;
  if (phase === 'day') return p.alive && p.id !== myId;
  if (phase === 'night') {
    const at = me.actionType;
    if (at === 'none') return false;
    if (!p.alive || p.id === myId) return false;
    if (at === 'kill' && me.roleKey === 'Vigilante' && me.bullets <= 0) return false;
    return true;
  }
  return false;
}

function pick(id) {
  if (!state.me || !state.me.alive) return;
  const phase = state.phase;
  if (phase === 'day') {
    if (state.me.roleKey === 'Jailor' && jailMode) {
      socket.emit('setJail', { targetId: id }); jailMode = false; renderActionBar(); updateScene(); return;
    }
    selectedTarget = id; socket.emit('vote', { targetId: id }); updateScene(); return;
  }
  if (phase === 'night') {
    const at = state.me.actionType;
    if (at === 'none') return;
    if (at === 'kill' && state.me.bullets <= 0) return;
    selectedTarget = id; socket.emit('nightAction', { type: at, targetId: id }); updateScene();
  }
}

function renderActionBar() {
  const bar = $('#actionBar'); bar.innerHTML = '';
  const me = state.me; if (!me) return;
  const phase = state.phase;
  let html = '';
  if (!me.alive) {
    html = '<span class="hint">You watch from beyond the veil…</span>';
  } else if (phase === 'day') {
    html = '<span class="hint">Click a townsperson to vote them onto the stand. A majority sends them to trial.</span>';
  } else if (phase === 'night') {
    const at = me.actionType;
    if (me.roleKey === 'Jailor') {
      html = `<span class="hint">Speak with your prisoner in chat. ${me.executions > 0 ? '' : 'No executions remain.'}</span>`;
      if (me.executions > 0 && me.jailTargetId) html += `<button class="btn primary" onclick="executePrisoner()">Execute Prisoner</button>`;
    } else if (at === 'none') {
      html = me.roleKey === 'Jester'
        ? '<span class="hint">Scheme quietly. Get the Town to hang you tomorrow.</span>'
        : '<span class="hint">You have no night action. Rest until dawn.</span>';
    } else if (at === 'kill' && me.bullets <= 0) {
      html = '<span class="hint">You are out of bullets.</span>';
    } else {
      html = `<span class="hint">${nightPrompt(at)}</span><button class="btn ghost tiny" onclick="cancelNight()">Do nothing</button>`;
    }
  }
  bar.innerHTML = html;
  if (me.alive && me.roleKey === 'Jailor' && phase === 'day') {
    const cur = me.jailTargetId ? (state.players.find(p => p.id === me.jailTargetId) || {}).name : null;
    const jb = document.createElement('button');
    jb.className = 'btn tiny';
    jb.style.borderColor = 'var(--gold)'; jb.style.marginLeft = '8px';
    jb.textContent = jailMode ? 'Now click a villager to jail…' : (cur ? `\uD83D\uDD12 Jailing ${cur} (change)` : '\uD83D\uDD12 Choose prisoner to jail');
    jb.onclick = () => { jailMode = !jailMode; renderActionBar(); };
    bar.appendChild(jb);
  }
}

function nightPrompt(at) {
  return ({ investigate: 'Click someone to investigate.', heal: 'Click someone to protect tonight.',
    kill: 'Click someone to shoot.', mafiakill: 'Click the Mafia’s victim.' })[at] || 'Choose your target.';
}

window.pick = pick;
window.judge = v => socket.emit('judge', { verdict: v });
window.executePrisoner = () => socket.emit('nightAction', { type: 'execute', targetId: null });
window.cancelNight = () => { selectedTarget = null; socket.emit('nightAction', { type: 'none', targetId: null }); updateScene(); };
window.hostSkip = () => { if (confirm('End the day immediately and skip straight to night?\n\nThis is a HOST OVERRIDE \u2014 outside the normal game rules. Continue?')) socket.emit('hostSkip'); };

// ---------- CHAT ----------
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('#chatInput').value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  $('#chatInput').value = '';
});
function addChat({ from, text, channel }) {
  const log = $('#chatLog');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (channel || 'day');
  div.innerHTML = (channel === 'system') ? `<span class="sys">${esc(text)}</span>` : `<span class="who">${esc(from)}:</span> ${esc(text)}`;
  log.appendChild(div); log.scrollTop = log.scrollHeight;
}
function updateChatChannel() {
  const ch = $('#chatChannel');
  if (!state.me) return;
  if (!state.me.alive) ch.textContent = '⚰ Graveyard';
  else if (state.phase === 'night') {
    if (state.me.team === 'Mafia') ch.textContent = '🗡 Mafia (private)';
    else if (state.me.roleKey === 'Jailor') ch.textContent = '🔒 Jail (private)';
    else ch.textContent = '🌙 Night — silence';
  } else ch.textContent = '🏛 Town Square';
}

// ---------- GAME OVER ----------
function renderOver() {
  const w = state.winner;
  $('#winnerTitle').textContent = w === 'Town' ? 'The Town Prevails' : w === 'Mafia' ? 'The Mafia Reigns' : w;
  $('#winnerMsg').textContent = state.winMessage || '';
  $('#individualWins').innerHTML = (state.individualWins || []).map(t => `<div>${esc(t)}</div>`).join('');
  $('#finalRoles').innerHTML = state.players.map(p => `<div class="fr">${esc(p.name)} — <b>${esc(p.revealedRole || '?')}</b></div>`).join('');
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }


// ---------- Original ambient music (Web Audio API, procedurally generated) ----------
const Music = (function () {
  let ctx, master, voices = [], started = false, enabled = false, mood = 'night', bellTimer = null;
  const CHORDS = { day: [146.83, 220.00, 277.18], night: [98.00, 146.83, 174.61] };
  function ensureCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  }
  function buildDrone() {
    stopVoices();
    (CHORDS[mood] || CHORDS.night).forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + 0.025 * i;
      const lg = ctx.createGain(); lg.gain.value = 3; lfo.connect(lg); lg.connect(o.detune);
      o.connect(g); g.connect(master); o.start(); lfo.start();
      g.gain.linearRampToValueAtTime(mood === 'day' ? 0.085 : 0.11, ctx.currentTime + 3);
      voices.push(o, lfo);
    });
    scheduleBell();
  }
  function scheduleBell() {
    clearTimeout(bellTimer);
    bellTimer = setTimeout(() => { bell(); scheduleBell(); }, (mood === 'day' ? 10000 : 6500) + Math.random() * 7000);
  }
  function bell() {
    if (!ctx || !enabled) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    const base = mood === 'day' ? 523.25 : 196.00;
    o.frequency.value = base * (Math.random() < 0.5 ? 1 : 1.5);
    o.connect(g); g.connect(master);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(mood === 'day' ? 0.05 : 0.08, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (mood === 'day' ? 2.6 : 3.6));
    o.start(t); o.stop(t + 4);
  }
  function stopVoices() { voices.forEach(v => { try { v.stop(); } catch (e) {} try { v.disconnect(); } catch (e) {} }); voices = []; }
  return {
    toggle() {
      ensureCtx();
      enabled = !enabled;
      if (enabled) {
        if (ctx.resume) ctx.resume();
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 1.4);
        if (!started) { started = true; buildDrone(); }
      } else {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      }
      return enabled;
    },
    setMood(m) { if (m === mood) return; mood = m; if (started && enabled) buildDrone(); },
    ensureButton() {
      const hdr = document.getElementById('gameHeader');
      if (!hdr || document.getElementById('musicBtn')) return;
      const b = document.createElement('button');
      b.id = 'musicBtn'; b.className = 'btn tiny'; b.textContent = '\u266A Music: Off'; b.style.marginLeft = '12px';
      b.onclick = () => { const on = Music.toggle(); b.textContent = on ? '\u266A Music: On' : '\u266A Music: Off'; };
      const host = hdr.querySelector('.phase-info'); (host || hdr).appendChild(b);
    }
  };
})();
