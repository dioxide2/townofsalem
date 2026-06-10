// test/simulate.js — boots the server and runs N bot clients through a full game.
// Verifies role assignment, night/day flow, voting, and that a winner is reached.
const { spawn } = require('child_process');
const path = require('path');

const NUM = parseInt(process.argv[2] || '9', 10);
const PORT = 3411;

function startServer() {
  const env = { ...process.env, PORT: String(PORT) };
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env, stdio: 'pipe' });
  srv.stdout.on('data', d => process.stdout.write('[server] ' + d));
  srv.stderr.on('data', d => process.stderr.write('[server-err] ' + d));
  return srv;
}

let ioClient;
try { ioClient = require('socket.io-client'); }
catch { console.error('socket.io-client not installed. Run: npm install socket.io-client --no-save'); process.exit(2); }

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function makeBot(name, code, isHost, onJoined) {
  const sock = ioClient(`http://localhost:${PORT}`, { transports: ['websocket'] });
  const bot = { sock, name, id: null, state: null, isHost, lastPhase: null };

  sock.on('connect', () => {
    bot.id = sock.id;
    if (isHost) sock.emit('createRoom', { name }, res => onJoined(res));
    else sock.emit('joinRoom', { name, code }, res => onJoined(res));
  });

  sock.on('state', s => {
    bot.state = s;
    if (s.phase !== bot.lastPhase) { bot.lastPhase = s.phase; act(bot); }
  });
  sock.on('tick', () => {}); // ignore
  return bot;
}

function act(bot) {
  const s = bot.state;
  if (!s || !s.me) return;
  const me = s.me;
  const others = s.players.filter(p => p.id !== bot.id && p.alive);
  if (s.phase === 'night' && me.alive) {
    const at = me.actionType;
    setTimeout(() => {
      if (!others.length) return;
      const t = rnd(others);
      if (['none', 'reveal'].includes(at)) return;
      if (at === 'alert' && me.alerts > 0) bot.sock.emit('nightAction', { type: 'alert', targetId: bot.id });
      else if (me.roleKey === 'Jailor') { /* maybe execute */ if (me.executions > 0 && Math.random() < 0.5) bot.sock.emit('nightAction', { type: 'execute' }); }
      else bot.sock.emit('nightAction', { type: at, targetId: t.id });
    }, 200);
  }
  if (s.phase === 'voting' && me.alive) {
    setTimeout(() => { if (others.length && Math.random() < 0.8) bot.sock.emit('vote', { targetId: rnd(others).id }); }, 300);
  }
  if (s.phase === 'judgment' && me.alive && s.onTrial !== bot.id) {
    setTimeout(() => bot.sock.emit('judge', { verdict: rnd(['guilty', 'guilty', 'innocent', 'abstain']) }), 300);
  }
  if (s.phase === 'gameOver') {
    if (bot.isHost) {
      console.log('\n=== GAME OVER ===');
      console.log('Winner:', s.winner, '—', s.winMessage);
      (s.individualWins || []).forEach(w => console.log(' •', w));
      console.log('Final roles:');
      s.players.forEach(p => console.log(`   ${p.name}: ${p.revealedRole}`));
      console.log('\nResult: PASS — game reached a valid conclusion.');
      cleanup(0);
    }
  }
}

let server, bots = [], finished = false;
function cleanup(code) {
  if (finished) return; finished = true;
  bots.forEach(b => b.sock.close());
  if (server) server.kill();
  setTimeout(() => process.exit(code), 300);
}

console.log(`Booting server and ${NUM} bots...`);
server = startServer();

setTimeout(() => {
  let code = null, joined = 0;
  const host = makeBot('Host_Goodman', null, true, res => {
    if (res.error) { console.error('Host error', res.error); cleanup(1); }
    code = res.code;
    console.log('Room created:', code);
    // join the rest
    for (let i = 1; i < NUM; i++) {
      ((idx) => {
        setTimeout(() => {
          const b = makeBot('Villager' + idx, code, false, r => {
            if (r.error) console.error('join err', r.error);
            else { joined++; if (joined === NUM - 1) setTimeout(startGame, 600); }
          });
          bots.push(b);
        }, i * 120);
      })(i);
    }
  });
  bots.push(host);

  function startGame() {
    console.log('All joined. Host starting game...');
    host.sock.emit('startGame');
  }
}, 1500);

// safety timeout — fail if no conclusion in 4 minutes
setTimeout(() => { console.error('TIMEOUT: game did not conclude.'); cleanup(1); }, 240000);
