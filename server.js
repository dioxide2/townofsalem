// server.js — Express + Socket.io server for Salem Nights.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { Game } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_, res) => res.send('ok'));

const rooms = {}; // code -> Game
const playerRoom = {}; // socketId -> code

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

// route chat messages with channel rules
function routeChat(game, fromId, text) {
  const p = game.getPlayer(fromId);
  if (!p) return;
  text = String(text).slice(0, 300).trim();
  if (!text) return;
  const dead = !p.alive;

  // Dead players & Mediums share the graveyard channel
  if (dead) {
    game.players.forEach(t => {
      if (!t.alive || (t.role === 'Medium' && game.phase === 'night'))
        io.to(t.id).emit('chat', { from: p.name, text, channel: 'dead' });
    });
    return;
  }

  if (game.phase === 'night') {
    // Mafia private night chat
    if (p.team === 'Mafia') {
      game.players.filter(x => x.team === 'Mafia' && x.alive)
        .forEach(t => io.to(t.id).emit('chat', { from: p.name, text, channel: 'mafia' }));
      return;
    }
    // Jailor <-> jailed private chat (prisoner identified by the Jailor's chosen target)
    const jailorPlayer = game.players.find(x => x.role === 'Jailor' && x.alive);
    const prisonerId = jailorPlayer ? jailorPlayer.jailTargetId : null;
    if (p.role === 'Jailor' || p.id === prisonerId) {
      if (jailorPlayer && prisonerId) {
        const fromLabel = p.role === 'Jailor' ? 'Jailor' : 'Prisoner';
        [jailorPlayer.id, prisonerId].forEach(id => io.to(id).emit('chat', { from: fromLabel, text, channel: 'jail' }));
      }
      return;
    }
    // Living Medium holds a séance with the dead
    if (p.role === 'Medium') {
      game.players.forEach(t => {
        if (!t.alive || t.id === p.id) io.to(t.id).emit('chat', { from: p.name + ' (Medium)', text, channel: 'dead' });
      });
      return;
    }
    // Other living players cannot speak at night
    io.to(fromId).emit('chat', { from: 'System', text: 'It is night — the town sleeps. You cannot speak now.', channel: 'system' });
    return;
  }

  // Day: public town square (defendant during defense speaks too)
  game.players.forEach(t => io.to(t.id).emit('chat', { from: p.name, text, channel: 'day', alive: true }));
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    const code = makeRoomCode();
    const game = new Game(code, io);
    rooms[code] = game;
    socket.join(code);
    const r = game.addPlayer(socket.id, sanitizeName(name));
    if (r.error) return cb && cb({ error: r.error });
    playerRoom[socket.id] = code;
    cb && cb({ code });
    game.broadcastState();
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    code = String(code || '').toUpperCase().trim();
    const game = rooms[code];
    if (!game) return cb && cb({ error: 'No room with that code.' });
    socket.join(code);
    const r = game.addPlayer(socket.id, sanitizeName(name));
    if (r.error) return cb && cb({ error: r.error });
    playerRoom[socket.id] = code;
    cb && cb({ code });
    game.broadcastState();
  });

  socket.on('startGame', () => {
    const game = currentGame(socket);
    if (!game || socket.id !== game.hostId) return;
    const r = game.start();
    if (r.error) io.to(socket.id).emit('chat', { from: 'System', text: r.error, channel: 'system' });
  });

  socket.on('hostSkip', () => {
    const game = currentGame(socket);
    if (game && socket.id === game.hostId) game.hostSkipToNight();
  });

  socket.on('toggleExecute', () => {
    const game = currentGame(socket);
    if (game) game.toggleExecute(socket.id);
  });

  socket.on('nightAction', ({ type, targetId }) => {
    const game = currentGame(socket);
    if (!game) return;
    game.submitNightAction(socket.id, type, targetId);
  });

  socket.on('setJail', ({ targetId }) => {
    const game = currentGame(socket);
    if (!game) return;
    game.setJailTarget(socket.id, targetId);
  });

  socket.on('dayAction', ({ kind }) => {
    // Mayor reveal / Veteran handled via nightAction; mayor reveal here
    const game = currentGame(socket);
    if (!game) return;
    const p = game.getPlayer(socket.id);
    if (!p || !p.alive) return;
    if (kind === 'reveal' && p.role === 'Mayor' && !p.revealed) {
      p.revealed = true;
      io.to(game.room).emit('chat', { from: 'System', text: `${p.name} has revealed as the Mayor!`, channel: 'system' });
      game.broadcastState();
    }
  });

  socket.on('vote', ({ targetId }) => {
    const game = currentGame(socket);
    if (game) game.castVote(socket.id, targetId);
  });

  socket.on('judge', ({ verdict }) => {
    const game = currentGame(socket);
    if (game) game.castJudgment(socket.id, verdict);
  });

  socket.on('chat', ({ text }) => {
    const game = currentGame(socket);
    if (game) routeChat(game, socket.id, text);
  });

  socket.on('leaveRoom', () => handleLeave(socket));
  socket.on('disconnect', () => handleLeave(socket));
});

function handleLeave(socket) {
  const code = playerRoom[socket.id];
  if (!code) return;
  const game = rooms[code];
  if (game) {
    game.removePlayer(socket.id);
    if (game.players.length === 0 || game.players.every(p => !p.connected)) {
      if (game.timer) clearInterval(game.timer);
      delete rooms[code];
    } else {
      game.broadcastState();
    }
  }
  delete playerRoom[socket.id];
}

function currentGame(socket) {
  const code = playerRoom[socket.id];
  return code ? rooms[code] : null;
}

function sanitizeName(name) {
  return String(name || 'Stranger').replace(/[<>]/g, '').slice(0, 16).trim() || 'Stranger';
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Salem Nights running on port ${PORT}`));
