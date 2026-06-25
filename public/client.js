// client.js — front-end controller for Salem Nights (radial walking village)
const socket = io();
let myId = null;
let state = null;
let selectedTarget = null;
let prevIsDay = null;
let sceneSig = null;
let prevWalkPhase = null;
let jailMode = false;
let executeArmed = false;
let veteranAlert = false;
let prevRenderedPhase = null;

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
socket.on('executeAck', ({ armed }) => { executeArmed = armed; renderRolePanel(); });

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
  if (phase !== prevRenderedPhase) selectedTarget = null;
  if (phase !== 'day') jailMode = false;
  if (phase === 'night' && prevRenderedPhase !== 'night') { executeArmed = false; veteranAlert = false; }
  prevRenderedPhase = phase;
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
  $('#roleName').innerHTML = esc(me.role) + '<span class="role-owner">' + esc(me.name) + '</span>';
  const team = $('#roleTeam'); team.textContent = me.team; team.className = 'role-team ' + me.team;
  $('#roleSummary').textContent = me.summary || '';
  $('#roleDetail').textContent = me.detail || '';
  const stats = [];
  if (me.roleKey === 'Vigilante') stats.push(`Bullets: ${me.bullets}`);
  if (me.roleKey === 'Jailor') stats.push(`Executions: ${me.executions}`);
  if (me.roleKey === 'Veteran') stats.push(`Alerts: ${me.alerts}`);
  if (!me.alive) stats.push('Deceased');
  $('#roleStats').innerHTML = stats.map(s => `<span class="chip">${esc(s)}</span>`).join('');
  $('#allies').innerHTML = (state.allies && me.team === 'Mafia')
    ? '<div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;">Your Family</div>' +
      state.allies.map(a => `<div class="ally">${esc(a.name)} — ${esc(a.role)}${a.alive ? '' : ' (dead)'}</div>`).join('')
    : '';
  const ah = $('#actionHint');
  ah.innerHTML = '';
  const phase = state.phase;
  const sideBtn = (text, onclick, variant, disabled) => {
    const b = document.createElement('button');
    b.className = 'btn side-btn' + (variant ? ' ' + variant : '');
    b.textContent = text; if (disabled) b.disabled = true; b.onclick = onclick;
    ah.appendChild(b);
  };
  if (me.alive && phase === 'day' && me.roleKey === 'Jailor') {
    const cur = me.jailTargetId ? (state.players.find(p => p.id === me.jailTargetId) || {}).name : null;
    sideBtn(jailMode ? 'Now click a villager to jail\u2026' : (cur ? '\uD83D\uDD12 Jailing ' + cur + ' (change)' : '\uD83D\uDD12 Choose prisoner to jail'),
      () => { jailMode = !jailMode; renderRolePanel(); updateScene(); }, 'jail-big');
  }
  if (me.alive && phase === 'night') {
    if (me.roleKey === 'Jailor' && me.executions > 0 && me.jailTargetId) {
      sideBtn(executeArmed ? '\u2713 Execution armed \u2014 cancel' : 'Execute Prisoner',
        () => { executeArmed = !executeArmed; socket.emit('toggleExecute'); renderRolePanel(); }, executeArmed ? 'guilty' : '');
    }
    if (me.roleKey === 'Veteran') {
      const noneLeft = (me.alerts || 0) <= 0 && !veteranAlert;
      sideBtn(noneLeft ? 'No alerts remaining' : (veteranAlert ? '\u2713 On Alert (stand down)' : 'Go on Alert (' + (me.alerts || 0) + ' left)'),
        () => { veteranAlert = !veteranAlert; socket.emit('nightAction', { type: veteranAlert ? 'alert' : 'none', targetId: myId }); renderRolePanel(); },
        veteranAlert ? 'primary' : '', noneLeft);
    }
    if (!['none', 'alert'].includes(me.actionType) && me.roleKey !== 'Jailor' && !(me.actionType === 'kill' && me.bullets <= 0)) {
      sideBtn('Do nothing tonight', () => { selectedTarget = null; socket.emit('nightAction', { type: 'none', targetId: null }); updateScene(); renderRolePanel(); }, 'ghost');
    }
  }
  if (state.hostId === myId && ['day', 'dayAnnounce'].includes(phase)) {
    sideBtn('\u23ED End Day \u2192 Night', hostSkip, 'danger');
  }
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
  } else if (state.phase === 'day' && state.day <= 1) {
    box.innerHTML = '<span class="vote-call">\u2600\uFE0F First day \u2014 no trials may be held. Talk and plan; voting opens tomorrow.</span>';
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
    if (state.phase === 'day' && tally[p.id]) { vc.textContent = tally[p.id]; vc.style.display = 'block'; } else vc.style.display = 'none';
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
  if (phase === 'day') {
    if (me.roleKey === 'Jailor' && jailMode) return p.alive && p.id !== myId;
    return state.day > 1 && p.alive && p.id !== myId;
  }
  if (phase === 'night') {
    const at = me.actionType;
    if (at === 'none' || at === 'alert') return false;
    if (at === 'mafiakill' && state.day <= 1) return false;
    if (at === 'kill' && state.day <= 1) return false;
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
      socket.emit('setJail', { targetId: id }); jailMode = false; renderRolePanel(); updateScene(); return;
    }
    if (state.day <= 1) return; // no voting on the first day
    selectedTarget = (selectedTarget === id) ? null : id; // toggle vote / unvote
    socket.emit('vote', { targetId: id }); updateScene(); return;
  }
  if (phase === 'night') {
    const at = state.me.actionType;
    if (at === 'none' || at === 'alert') return;
    if (at === 'mafiakill' && state.day <= 1) return;
    if (at === 'kill' && (state.day <= 1 || state.me.bullets <= 0)) return;
    if (selectedTarget === id) { // click again to unselect
      selectedTarget = null; socket.emit('nightAction', { type: 'none', targetId: null });
    } else {
      selectedTarget = id; socket.emit('nightAction', { type: at, targetId: id });
    }
    updateScene();
  }
}

function renderActionBar() {
  const bar = $('#actionBar'); bar.innerHTML = '';
  const me = state.me; if (!me) return;
  const phase = state.phase;
  let html = '';
  if (!me.alive) {
    html = '<span class="hint">You watch from beyond the veil\u2026</span>';
  } else if (phase === 'day') {
    html = state.day <= 1
      ? '<span class="hint">First day: no voting. Discuss and prepare \u2014 trials begin tomorrow.</span>'
      : '<span class="hint">Click a townsperson to vote them onto the stand. A majority sends them to trial.</span>';
  } else if (phase === 'night') {
    const at = me.actionType;
    if (me.roleKey === 'Jailor') {
      html = '<span class="hint">Speak with your prisoner in chat, then decide their fate on the left.</span>';
    } else if (at === 'mafiakill' && state.day <= 1) {
      html = '<span class="hint">The Mafia cannot kill on the first night. Plan with your family in chat.</span>';
    } else if (at === 'kill' && state.day <= 1) {
      html = '<span class="hint">You cannot shoot on the first night. Hold your fire.</span>';
    } else if (at === 'alert') {
      html = '<span class="hint">Use the panel on the left to go on alert.</span>';
    } else if (at === 'none') {
      html = me.roleKey === 'Jester'
        ? '<span class="hint">Scheme quietly. Get the Town to hang you tomorrow.</span>'
        : (me.roleKey === 'Medium'
          ? '<span class="hint">Hold a s\u00e9ance \u2014 speak with the dead in the chat panel.</span>'
          : '<span class="hint">You have no night action. Rest until dawn.</span>');
    } else if (at === 'kill' && me.bullets <= 0) {
      html = '<span class="hint">You are out of bullets.</span>';
    } else {
      html = '<span class="hint">' + nightPrompt(at) + ' (use the panel on the left to skip)</span>';
    }
  }
  bar.innerHTML = html;
}

function nightPrompt(at) {
  return ({ investigate: 'Click someone to investigate.', investigateExact: 'Click someone to uncover their exact role.', heal: 'Click someone to protect tonight.',
    watch: 'Click a house to watch who visits it.', track: 'Click someone to see where they go.',
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
    else if (state.me.jailed) ch.textContent = '🔒 Jailed — speak with the Jailor';
    else if (state.me.roleKey === 'Medium') ch.textContent = '🔮 Séance with the dead';
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

// ---------- Background music: YouTube embed with a synthesized fallback ----------
// Primary: the user's two tracks stream from the official YouTube IFrame player
// (YouTube serves the audio under its own licensing). Fallback: if YouTube fails
// to load/play (blocked embed, network, etc.), an original synthesized ambient
// drone takes over so there is always music.
const Music = (function () {
  const DAY_ID = 'QmpLAPJhhBQ', NIGHT_ID = 'zsSD3XKBr8U';
  let player = null, ytReady = false, enabled = false, mood = 'night', apiLoading = false, fallback = false, readyTimer = null;

  // ----- synthesized fallback (Web Audio) -----
  let ctx, master, voices = [], synthStarted = false, bellTimer = null;
  const CHORDS = { day: [146.83, 220.00, 277.18], night: [98.00, 146.83, 174.61] };
  function synthEnsure() { if (ctx) return; ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination); }
  function synthBuild() {
    synthStop();
    (CHORDS[mood] || CHORDS.night).forEach((f, idx) => {
      const o = ctx.createOscillator(); o.type = idx === 0 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + 0.025 * idx;
      const lg = ctx.createGain(); lg.gain.value = 3; lfo.connect(lg); lg.connect(o.detune);
      o.connect(g); g.connect(master); o.start(); lfo.start();
      g.gain.linearRampToValueAtTime(mood === 'day' ? 0.085 : 0.11, ctx.currentTime + 3);
      voices.push(o, lfo);
    });
    scheduleBell();
  }
  function scheduleBell() { clearTimeout(bellTimer); bellTimer = setTimeout(() => { ringBell(); scheduleBell(); }, (mood === 'day' ? 10000 : 6500) + Math.random() * 7000); }
  function ringBell() {
    if (!ctx || !fallback || !enabled) return;
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine';
    const base = mood === 'day' ? 523.25 : 196.00; o.frequency.value = base * (Math.random() < 0.5 ? 1 : 1.5);
    o.connect(g); g.connect(master); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(mood === 'day' ? 0.05 : 0.08, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (mood === 'day' ? 2.6 : 3.6)); o.start(t); o.stop(t + 4);
  }
  function synthStop() { voices.forEach(v => { try { v.stop(); } catch (e) {} try { v.disconnect(); } catch (e) {} }); voices = []; }
  function startFallback() {
    if (player && ytReady) { try { player.stopVideo(); } catch (e) {} }
    fallback = true; synthEnsure(); if (ctx.resume) ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 1.4);
    if (!synthStarted) { synthBuild(); synthStarted = true; }
    setLabel();
  }

  // ----- youtube primary -----
  function ensureHost() { if (document.getElementById('ytmusic')) return; const d = document.createElement('div'); d.id = 'ytmusic'; d.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:200px;height:120px;opacity:0;pointer-events:none;'; document.body.appendChild(d); }
  function loadApi(cb) {
    if (window.YT && window.YT.Player) { cb(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () { if (prev) try { prev(); } catch (e) {} cb(); };
    if (!apiLoading) { apiLoading = true; const tag = document.createElement('script'); tag.src = 'https://www.youtube.com/iframe_api'; tag.onerror = () => { if (enabled && !fallback) startFallback(); }; document.head.appendChild(tag); }
  }
  function createPlayer() {
    try {
      player = new YT.Player('ytmusic', {
        height: '120', width: '200', videoId: mood === 'day' ? DAY_ID : NIGHT_ID,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: function (e) { ytReady = true; e.target.setVolume(40); if (enabled && !fallback) e.target.playVideo(); },
          onStateChange: function (e) { if (e.data === YT.PlayerState.ENDED) { e.target.seekTo(0); e.target.playVideo(); } if (e.data === YT.PlayerState.PLAYING) clearTimeout(readyTimer); },
          onError: function () { if (enabled && !fallback) startFallback(); }
        }
      });
    } catch (e) { if (enabled && !fallback) startFallback(); }
  }
  function setLabel() { const b = document.getElementById('musicBtn'); if (b) b.textContent = enabled ? ('♪ Music: On' + (fallback ? ' (ambient)' : '')) : '♪ Music: Off'; }

  return {
    toggle() {
      enabled = !enabled;
      if (enabled) {
        if (fallback) { synthEnsure(); if (ctx.resume) ctx.resume(); master.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 1.2); if (!synthStarted) { synthBuild(); synthStarted = true; } }
        else {
          ensureHost();
          if (!player) loadApi(createPlayer); else if (ytReady) player.playVideo();
          clearTimeout(readyTimer);
          readyTimer = setTimeout(() => { if (enabled && !fallback && (!player || !ytReady)) startFallback(); }, 7000);
        }
      } else {
        if (fallback) { if (ctx) master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6); }
        else if (player && ytReady) player.pauseVideo();
        clearTimeout(readyTimer);
      }
      setLabel();
      return enabled;
    },
    setMood(m) {
      if (m === mood) return; mood = m;
      if (!enabled) return;
      if (fallback) { if (synthStarted) synthBuild(); }
      else if (player && ytReady) player.loadVideoById(mood === 'day' ? DAY_ID : NIGHT_ID);
    },
    ensureButton() {
      const hdr = document.getElementById('gameHeader');
      if (!hdr || document.getElementById('musicBtn')) return;
      const b = document.createElement('button');
      b.id = 'musicBtn'; b.className = 'btn tiny'; b.textContent = '♪ Music: Off'; b.style.marginLeft = '12px';
      b.onclick = () => { Music.toggle(); };
      const host = hdr.querySelector('.phase-info'); (host || hdr).appendChild(b);
    }
  };
})();
