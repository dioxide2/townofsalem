// client.js — front-end controller for Salem Nights
const socket = io();
let myId = null;
let state = null;
let selectedTarget = null;

const $ = sel => document.querySelector(sel);
const screens = { home: $('#home'), lobby: $('#lobby'), game: $('#game'), over: $('#over') };
function show(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// title emblem
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

function enterLobby(code) {
  $('#roomCode').textContent = code;
  show('lobby');
}
$('#copyCode').onclick = () => navigator.clipboard?.writeText($('#roomCode').textContent);
$('#leaveBtn').onclick = () => { socket.emit('leaveRoom'); location.reload(); };
$('#overHome').onclick = () => location.reload();
$('#startBtn').onclick = () => socket.emit('startGame');

// ---------- SOCKET ----------
socket.on('connect', () => { myId = socket.id; });

socket.on('state', s => {
  state = s;
  render();
});

socket.on('tick', ({ timeLeft, phase }) => {
  if (state) { state.timeLeft = timeLeft; state.phase = phase; }
  $('#timer').textContent = timeLeft > 0 ? timeLeft : '';
});

socket.on('actionAck', ({ targetId }) => { selectedTarget = targetId; renderGrid(); });
socket.on('jailAck', ({ targetId }) => { selectedTarget = targetId; renderGrid(); });

socket.on('chat', msg => addChat(msg));

// ---------- RENDER ----------
function render() {
  if (!state) return;
  const phase = state.phase;

  if (phase === 'lobby') { renderLobby(); show('lobby'); return; }
  if (phase === 'gameOver') { renderOver(); show('over'); return; }

  show('game');
  renderHeader();
  renderRolePanel();
  renderAnnounce();
  renderTrial();
  renderGrid();
  renderActionBar();
  updateChatChannel();
  document.body.classList.toggle('is-day', isDayPhase(phase));
}

function isDayPhase(p) { return ['dayAnnounce','discussion','voting','defense','judgment','lastWords'].includes(p); }

function renderLobby() {
  const wrap = $('#lobbyPlayers');
  wrap.innerHTML = state.players.map(p => `
    <div class="lobby-player">
      ${avatarToken(p.name, true)}
      <span>${esc(p.name)}</span>
      ${p.isHost ? '<span class="host-tag">Host</span>' : ''}
    </div>`).join('');
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
  if (me.bullets) stats.push(`Bullets: ${me.bullets}`);
  if (me.alerts) stats.push(`Alerts: ${me.alerts}`);
  if (me.executions) stats.push(`Executions: ${me.executions}`);
  if (me.execTargetName) stats.push(`Target: ${me.execTargetName}`);
  if (!me.alive) stats.push('Deceased');
  $('#roleStats').innerHTML = stats.map(s => `<span class="chip">${esc(s)}</span>`).join('');

  $('#allies').innerHTML = (state.allies && me.team === 'Mafia')
    ? '<div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;">Your Family</div>' +
      state.allies.map(a => `<div class="ally">${esc(a.name)} — ${esc(a.role)}${a.alive ? '' : ' (dead)'}</div>`).join('')
    : '';

  // night feedback
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
  } else {
    box.innerHTML = '';
  }
}

function renderTrial() {
  const box = $('#trialBox');
  if (state.phase === 'defense' || state.phase === 'judgment' || state.phase === 'lastWords') {
    const def = state.players.find(p => p.id === state.onTrial);
    if (!def) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    let html = `<h3>${esc(def.name)} stands accused</h3>`;
    if (state.phase === 'defense') html += `<p>They may defend themselves. Prepare your verdict.</p>`;
    if (state.phase === 'judgment') {
      const onTrialIsMe = state.onTrial === myId;
      html += `<p>Cast your judgment. (${state.judgmentCount || 0} votes cast)</p>`;
      if (state.me.alive && !onTrialIsMe) {
        html += `<div class="judgment-btns">
          <button class="btn guilty" onclick="judge('guilty')">Guilty</button>
          <button class="btn innocent" onclick="judge('innocent')">Innocent</button>
          <button class="btn" onclick="judge('abstain')">Abstain</button></div>`;
      } else if (onTrialIsMe) {
        html += `<p style="color:var(--gold)">You are on trial. Plead your case in chat.</p>`;
      }
    }
    if (state.phase === 'lastWords' && state.trialResult) {
      html += `<p>Verdict: <b style="color:var(--mafia)">${state.trialResult.guilty} Guilty</b> / ${state.trialResult.innocent} Innocent. The rope is readied…</p>`;
    }
    box.innerHTML = html;
  } else {
    box.classList.add('hidden');
  }
}

function renderGrid() {
  const grid = $('#playerGrid');
  if (!state.me) return;
  const meAlive = state.me.alive;
  const phase = state.phase;
  const tally = state.voteTally ? state.voteTally.tally : {};

  grid.innerHTML = state.players.map(p => {
    const isMe = p.id === myId;
    const selectable = meAlive && canTarget(p);
    const classes = ['pcard'];
    if (!p.alive) classes.push('dead');
    if (isMe) classes.push('me');
    if (selectable) classes.push('selectable');
    if (selectedTarget === p.id) classes.push('selected');
    const vc = (phase === 'voting' && tally[p.id]) ? `<span class="votecount">${tally[p.id]}</span>` : '';
    const role = p.revealedRole ? `<div class="prole">${esc(p.revealedRole)}</div>` : '<div class="prole">&nbsp;</div>';
    const mayor = p.mayorRevealed ? '<span class="badge mayor-star">★ Mayor</span>' : '';
    return `<div class="${classes.join(' ')}" data-id="${p.id}" onclick="pick('${p.id}')">
      ${vc}${mayor}
      ${avatarToken(p.name, p.alive)}
      <div class="pname">${esc(p.name)}${isMe ? ' (you)' : ''}</div>
      ${role}
    </div>`;
  }).join('');
}

function canTarget(p) {
  const phase = state.phase, me = state.me;
  if (phase === 'voting') return p.alive && p.id !== myId;
  if (phase === 'night') {
    const at = me.actionType;
    if (!me.alive) return false;
    if (['none','reveal'].includes(at)) return false;
    if (at === 'alert') return false; // self toggle via button
    if (!p.alive) return false;
    if (at === 'heal' || at === 'watch') return true; // can self-heal? doctor can't self; keep simple: allow others+self for watch
    if (p.id === myId) return false;
    return true;
  }
  return false;
}

function pick(id) {
  if (!state.me || !state.me.alive) return;
  const phase = state.phase;
  if (phase === 'voting') {
    selectedTarget = id;
    socket.emit('vote', { targetId: id });
    renderGrid();
    return;
  }
  if (phase === 'night') {
    const at = state.me.actionType;
    if (['none','reveal','alert'].includes(at)) return;
    selectedTarget = id;
    if (at === 'jail') return; // jail chosen via action bar confirm? we set immediately:
    submitNight(at, id);
    renderGrid();
  }
}

function submitNight(type, targetId) {
  socket.emit('nightAction', { type, targetId });
  selectedTarget = targetId;
}

function renderActionBar() {
  const bar = $('#actionBar');
  bar.innerHTML = '';
  const me = state.me;
  if (!me || !me.alive) { bar.innerHTML = '<span class="hint">You watch from the beyond…</span>'; return; }
  const phase = state.phase;

  if (phase === 'discussion' || phase === 'dayAnnounce') {
    // Mayor reveal, Jailor jail selection happens during day
    if (me.roleKey === 'Mayor' && !me.revealed) {
      bar.innerHTML += `<button class="btn" onclick="dayAct('reveal')">Reveal as Mayor</button>`;
    }
    if (me.roleKey === 'Jailor') {
      bar.innerHTML += `<span class="hint">Click a player to drag them to jail tonight.</span>`;
      makeJailClickable();
    }
  }

  if (phase === 'night') {
    const at = me.actionType;
    if (at === 'alert' && me.roleKey === 'Veteran') {
      const on = selectedTarget === 'ALERT';
      bar.innerHTML += `<button class="btn ${on ? 'primary' : ''}" onclick="toggleAlert()">${on ? 'On Alert ✓' : `Go on Alert (${me.alerts} left)`}</button>`;
    } else if (at === 'none') {
      bar.innerHTML += '<span class="hint">You have no night action. Bide your time.</span>';
    } else if (me.roleKey === 'Jailor') {
      // jailor decides execute
      bar.innerHTML += `<span class="hint">Speak with your prisoner. ${me.executions > 0 ? '' : 'No executions remain.'}</span>`;
      if (me.executions > 0) bar.innerHTML += `<button class="btn primary" onclick="executePrisoner()">Execute Prisoner</button>`;
    } else if (at === 'kill' && me.bullets === 0 && me.roleKey === 'Vigilante') {
      bar.innerHTML += '<span class="hint">You are out of bullets.</span>';
    } else {
      bar.innerHTML += `<span class="hint">${nightPrompt(at)}</span>`;
      bar.innerHTML += `<button class="btn ghost tiny" onclick="cancelNight()">Stay home</button>`;
    }
  }
}

function nightPrompt(at) {
  return ({
    investigate: 'Choose someone to investigate.',
    investigate2: 'Choose someone to gather clues on.',
    watch: 'Choose a house to watch.',
    heal: 'Choose someone to heal.',
    protect: 'Choose someone to guard.',
    roleblock: 'Choose someone to distract.',
    frame: 'Choose someone to frame.',
    kill: 'Choose someone to attack.',
    mafiakill: 'Choose the Mafia’s victim.'
  })[at] || 'Choose your target.';
}

window.pick = pick;
window.judge = v => socket.emit('judge', { verdict: v });
window.dayAct = kind => socket.emit('dayAction', { kind });
window.toggleAlert = () => {
  if (selectedTarget === 'ALERT') { selectedTarget = null; socket.emit('nightAction', { type: 'none', targetId: null }); }
  else { selectedTarget = 'ALERT'; socket.emit('nightAction', { type: 'alert', targetId: myId }); }
  renderActionBar();
};
window.executePrisoner = () => socket.emit('nightAction', { type: 'execute', targetId: null });
window.cancelNight = () => { selectedTarget = null; socket.emit('nightAction', { type: 'none', targetId: null }); renderGrid(); };

function makeJailClickable() {
  // override grid clicks during day for jailor
  document.querySelectorAll('.pcard').forEach(card => {
    const id = card.dataset.id;
    const p = state.players.find(x => x.id === id);
    if (p && p.alive && id !== myId) {
      card.classList.add('selectable');
      card.onclick = () => { selectedTarget = id; socket.emit('setJail', { targetId: id }); document.querySelectorAll('.pcard').forEach(c=>c.classList.remove('selected')); card.classList.add('selected'); };
    }
  });
}

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
  div.innerHTML = (channel === 'system')
    ? `<span class="sys">${esc(text)}</span>`
    : `<span class="who">${esc(from)}:</span> ${esc(text)}`;
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
  $('#winnerTitle').textContent = w === 'Town' ? 'The Town Prevails' :
    w === 'Mafia' ? 'The Mafia Reigns' :
    w === 'Serial Killer' ? 'The Killer Stands Alone' : `${w}`;
  $('#winnerMsg').textContent = state.winMessage || '';
  $('#individualWins').innerHTML = (state.individualWins || []).map(t => `<div>${esc(t)}</div>`).join('');
  $('#finalRoles').innerHTML = state.players.map(p =>
    `<div class="fr">${esc(p.name)} — <b>${esc(p.revealedRole || '?')}</b></div>`).join('');
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
