// test/server.smoke.js — self-contained integration smoke test for the socket
// server layer. Stubs express + socket.io in-memory (no install needed) and drives
// the REAL handlers in server.js through a create -> join -> start flow.
// Run with:  node test/server.smoke.js
const path = require('path');
const Module = require('module');

function makeSocketIoModule() {
  class Server {
    constructor() { this.captured = []; this._conn = null; }
    on(ev, cb) { if (ev === 'connection') this._conn = cb; }
    to(id) { const self = this; return { emit: (ev, payload) => self.captured.push({ id, ev, payload }) }; }
    _connect(sock) { this._conn(sock); }
  }
  return { Server };
}

const origLoad = Module._load;
let io;
Module._load = function (request) {
  if (request === 'express') { const app = function () {}; app.use = () => {}; app.get = () => {}; const e = () => app; e.static = () => (() => {}); return e; }
  if (request === 'socket.io') { const m = makeSocketIoModule(); const P = class extends m.Server { constructor() { super(); io = this; } }; return { Server: P }; }
  return origLoad.apply(this, arguments);
};
require(path.join(__dirname, '..', 'server.js'));
Module._load = origLoad;

let nextId = 0;
function makeSocket() {
  const id = 's' + (nextId++); const h = {};
  const sock = { id, on(e, c) { h[e] = c; }, join() {}, emit() {}, _fire(e, d, cb) { if (h[e]) h[e](d, cb); } };
  io._connect(sock); return sock;
}
function lastState(id) {
  for (let i = io.captured.length - 1; i >= 0; i--) { const c = io.captured[i]; if (c.id === id && c.ev === 'state') return c.payload; }
  return null;
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  x ' + m); } };

const host = makeSocket();
let code = null;
host._fire('createRoom', { name: 'Host' }, r => { code = r && r.code; });
ok(code && code.length === 4, 'createRoom returns a 4-char room code (' + code + ')');

const players = [host];
for (let i = 0; i < 8; i++) {
  const s = makeSocket(); let err = null;
  s._fire('joinRoom', { name: 'P' + i, code }, r => { err = r && r.error; });
  ok(!err, 'player P' + i + ' joined without error');
  players.push(s);
}

let st = lastState(host.id);
ok(st && st.players.length === 9, 'lobby shows all 9 players');
ok(st && st.hostId === host.id, 'host is recognized');

host._fire('startGame', {});
st = lastState(host.id);
ok(st && st.started === true, 'game started');
ok(st && st.me && st.me.roleKey, 'host was dealt a role (' + (st.me && st.me.role) + ')');
ok(st && st.phase === 'reveal', 'phase is reveal after start');
ok(players.every(p => { const s = lastState(p.id); return s && s.me && s.me.team; }), 'every player received a team');

const maf = players.map(p => lastState(p.id)).filter(s => s.me.team === 'Mafia');
ok(maf.length >= 1, 'at least one Mafia exists');
ok(maf.every(s => s.allies && s.allies.length >= 1), 'mafia members see their allies');

const town = players.find(p => lastState(p.id).me.team === 'Town');
const before = io.captured.length;
town._fire('chat', { text: 'hello village' });
ok(io.captured.slice(before).some(c => c.ev === 'chat' && c.payload && c.payload.text === 'hello village'), 'chat is delivered to the room');

players[8]._fire('disconnect', {});
st = lastState(host.id);
ok(st && st.started, 'game persists after a player disconnects');

console.log('\n---- server smoke: ' + pass + ' passed, ' + fail + ' failed ----');
process.exit(fail ? 1 : 0);
