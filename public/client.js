// client.js — front-end controller for Salem Nights
const socket = io();
let myId = null;
let state = null;
let selectedTarget = null;
let prevIsDay = null;

const $ = sel => document.querySelector(sel);
const screens = { home: $('#home'), lobby: $('#lobby'), game: $('#game'), over: $('#over') };
function show(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

$('#titleEmblem').innerHTML = emblemFor('Jailor');

// ---------- HOME ----------
$('#createBtn').onclick = () => {
  const name = $('#nameInput').value.trim();
  if (!name) return showHomeError('Enter a name first.');
  socket.emit('createRoom', { name }, res => {
    if (res.error) return showHomeError(res.error);
    enterLobby(res.code);
  });
};
$('#joinBtn').onclick = () => {
  const name = $('#nameInput').value.trim();
  const code = $('#codeInput').value.trim().toUpperCase();
  if (!name) return showHomeError('Enter a name first.');
  if (!code) return showHomeError('Enter a room code.');
  socket.emit('joinRoom', { name, code }, res => {
    if (res.error) return showHomeError(res.error);
    enterLobby(res.code);
  });
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
socket.on('tick', ({ timeLeft, phase }) => {
  if (state) { state.timeLeft = timeLeft; state.phase = phase; }
  $('#timer').textContent = timeLeft > 0 ? timeLeft : '';
});
socket.on('actionAck', ({ targetId }) => { selectedTarget = targetId; renderVillage(); });
socket.on('jailAck', ({ targetId }) => { selectedTarget = targetId; renderVillage(); });
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
  // flash on day<->night change
  if (prevIsDay !== null && prevIsDay !== day) {
    const f = $('#phaseFlash'); f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash');
  }
  prevIsDay = day;

  renderHeader();
  renderRolePanel();
  renderAnnounce();
  renderTrial();
  renderVillage();
  renderActionBar();
  updateChatChannel();
}

function isDayPhase(p) { return ['dayAnnounce', 'discussion', 'voting', 'defense', 'judgment', 'lastWords'].includes(p); }

function renderLobby() {
  const wrap = $('#lobbyPlayers');
  wrap.innerHTML = state.players.map(p => `
    <div class="lobby-player">${avatarToken(p.name, true)}
      <span>${esc(p.name)}</span>${p.isHost ? '<span class="host-tag">Host</span>' : ''}</div>`).join('');
  const n = state.players.length;
  const isHost = state.hostId === myId;
  const startBtn = $('#startBtn');
  startBtn.style.display = isHost ? '' : 'none';
  startBtn.disabled = n < 7;
  $('#lobbyHint').textContent = isHost
    ? (n < 7 ? `Waiting for players… (${n}/7 minimum, 15 max)` : `${n} players ready. You may begin.`)
    : `Waiting for the host to begin… (${n} players)`;
}

const PHASE_LABEL = {
  reveal: 'Roles are dealt…', night: 'Night falls — the village sleeps',
  dayAnnounce: 'Dawn breaks', discussion: 'Town discussion',
  voting: 'Who shall stand trial?', defense: 'The accused speaks',
  judgment: 'Render your verdict', lastWords: 'Final words'
};
function renderHeader() {
  const badge = $('#phaseBadge');
  const day = isDayPhase(state.phase);
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
  const team = $('#roleTeam');
  team.textContent = me.team;
  team.className = 'role-team ' + me.team;
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

  if (me.feedback && me.feedback.length && state.phase === 'dayAnnounce') {
    me.feedback.forEach(f => addChat({ from: 'Whispers', text: f, channel: 'system' }));
    me.feedback = [];
  }
}

function renderAnnounce() {
  const box = $('#announce');
  if (state.phase === 'dayAnnounce' && state.deaths && state.deaths.length) {
    box.innerHTML = state.deaths.map(d =>
      `<span class="death">☠ ${esc(d.name)} ${esc(d.reason)}. They were the <b>${esc(d.role)}</b>.</span>`).join('');
  } else if (state.phase === 'dayAnnounce') {
    box.innerHTML = '<span>The village awoke to find everyone alive.</span>';
  } else { box.innerHTML = ''; }
}

function renderTrial() {
  const box = $('#trialBox');
  if (['defense', 'judgment', 'lastWords'].includes(state.phase)) {
    const def = state.players.find(p => p.id === state.onTrial);
    if (!def) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    let html = `<h3>${esc(def.name)} stands accused</h3>`;
    if (state.phase === 'defense') html += `<p>They may defend themselves. Prepare your verdict.</p>`;
    if (state.phase === 'judgment') {
      const meOnTrial = state.onTrial === myId;
      html += `<p>Cast your judgment. (${state.judgmentCount || 0} votes cast)</p>`;
      if (state.me.alive && !meOnTrial) {
        html += `<div class="judgment-btns">
          <button class="btn guilty" onclick="judge('guilty')">Guilty</button>
          <button class="btn innocent" onclick="judge('innocent')">Innocent</button>
          <button class="btn" onclick="judge('abstain')">Abstain</button></div>`;
      } else if (meOnTrial) {
        html += `<p style="color:var(--gold)">You are on trial. Plead your case in chat.</p>`;
      }
    }
    if (state.phase === 'lastWords' && state.trialResult) {
      html += `<p>Verdict: <b style="color:var(--mafia)">${state.trialResult.guilty} Guilty</b> / ${state.trialResult.innocent} Innocent. The rope is readied…</p>`;
    }
    box.innerHTML = html;
  } else { box.classList.add('hidden'); }
}

// ---------- VILLAGE ----------
function renderVillage() {
  const v = $('#village');
  if (!state.me) return;
  const tally = state.voteTally ? state.voteTally.tally : {};
  const allyIds = new Set((state.allies || []).map(a => a.name)); // by name (no ids in allies)
  v.innerHTML = state.players.map(p => {
    const isMe = p.id === myId;
    const selectable = state.me.alive && canTarget(p);
    const cls = ['house'];
    if (!p.alive) cls.push('dead');
    if (isMe) cls.push('me');
    if (selectable) cls.push('selectable');
    if (selectedTarget === p.id) cls.push('selected');
    const vc = (state.phase === 'voting' && tally[p.id]) ? `<span class="votecount">${tally[p.id]}</span>` : '';
    const ally = (state.me.team === 'Mafia' && p.alive && allyIds.has(p.name) && !isMe) ? '<span class="ally-mark">🗡</span>' : '';
    const figure = p.alive
      ? `<div class="villager">${figureSVG(p.name)}</div>`
      : `<div class="tomb">${tombstoneSVG()}</div>`;
    const role = p.revealedRole ? `<div class="prole">${esc(p.revealedRole)}</div>` : '';
    return `<div class="${cls.join(' ')}" data-id="${p.id}" onclick="pick('${p.id}')">
      ${vc}${ally}
      ${houseSVG(p.name)}
      ${figure}
      <div class="house-label">${esc(p.name)}${isMe ? ' (you)' : ''}</div>
      ${role}
    </div>`;
  }).join('');
}

function canTarget(p) {
  const phase = state.phase, me = state.me;
  if (!me.alive) return false;
  if (phase === 'voting') return p.alive && p.id !== myId;
  if (phase === 'discussion' && me.roleKey === 'Jailor') return p.alive && p.id !== myId; // pick jail target
  if (phase === 'night') {
    const at = me.actionType;
    if (at === 'none') return false;
    if (!p.alive) return false;
    if (p.id === myId) return false;        // no self-targeting in this set
    if (at === 'kill' && me.roleKey === 'Vigilante' && me.bullets <= 0) return false;
    return true;
  }
  return false;
}

function pick(id) {
  if (!state.me || !state.me.alive) return;
  const phase = state.phase;
  if (phase === 'voting') { selectedTarget = id; socket.emit('vote', { targetId: id }); renderVillage(); return; }
  if (phase === 'discussion' && state.me.roleKey === 'Jailor') {
    selectedTarget = id; socket.emit('setJail', { targetId: id }); renderVillage(); return;
  }
  if (phase === 'night') {
    const at = state.me.actionType;
    if (at === 'none') return;
    if (at === 'kill' && state.me.bullets <= 0) return;
    selectedTarget = id;
    socket.emit('nightAction', { type: at, targetId: id });
    renderVillage();
  }
}

function renderActionBar() {
  const bar = $('#actionBar');
  bar.innerHTML = '';
  const me = state.me;
  if (!me || !me.alive) { bar.innerHTML = '<span class="hint">You watch from beyond the veil…</span>'; return; }
  const phase = state.phase;

  if (phase === 'discussion') {
    if (me.roleKey === 'Jailor') bar.innerHTML = '<span class="hint">Click a villager to haul them to jail tonight.</span>';
  } else if (phase === 'night') {
    const at = me.actionType;
    if (me.roleKey === 'Jailor') {
      bar.innerHTML = `<span class="hint">Speak with your prisoner in chat. ${me.executions > 0 ? '' : 'No executions remain.'}</span>`;
      if (me.executions > 0 && me.jailTargetId) bar.innerHTML += `<button class="btn primary" onclick="executePrisoner()">Execute Prisoner</button>`;
    } else if (at === 'none') {
      bar.innerHTML = me.roleKey === 'Jester'
        ? '<span class="hint">Scheme quietly. Get the Town to hang you tomorrow.</span>'
        : '<span class="hint">You have no night action. Rest until dawn.</span>';
    } else if (at === 'kill' && me.bullets <= 0) {
      bar.innerHTML = '<span class="hint">You are out of bullets.</span>';
    } else {
      bar.innerHTML = `<span class="hint">${nightPrompt(at)}</span>
        <button class="btn ghost tiny" onclick="cancelNight()">Do nothing</button>`;
    }
  } else if (phase === 'voting') {
    bar.innerHTML = '<span class="hint">Click a villager to vote them to trial.</span>';
  }
}

function nightPrompt(at) {
  return ({
    investigate: 'Click someone to investigate.',
    heal: 'Click someone to protect tonight.',
    kill: 'Click someone to shoot.',
    mafiakill: 'Click the Mafia’s victim.'
  })[at] || 'Choose your target.';
}

window.pick = pick;
window.judge = v => socket.emit('judge', { verdict: v });
window.executePrisoner = () => socket.emit('nightAction', { type: 'execute', targetId: null });
window.cancelNight = () => { selectedTarget = null; socket.emit('nightAction', { type: 'none', targetId: null }); renderVillage(); };

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
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
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
  $('#finalRoles').innerHTML = state.players.map(p =>
    `<div class="fr">${esc(p.name)} — <b>${esc(p.revealedRole || '?')}</b></div>`).join('');
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
