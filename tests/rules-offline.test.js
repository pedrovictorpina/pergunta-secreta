'use strict';
// Testes das regras sem depender de conexão externa ou de node_modules.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const file = path.join(__dirname, '..', 'server.js');
let uniqueId = 0;
class FakeServer {
  constructor() {
    this.sockets = { sockets: new Map() };
    this.groups = new Map();
    this.handlers = {};
  }
  on(event, handler) { this.handlers[event] = handler; }
  to(group) {
    return { emit: (event, payload) => {
      for (const sock of this.sockets.sockets.values()) {
        if (sock.groups.has(group)) sock.emit(event, payload);
      }
    }};
  }
  connect() {
    const socket = new FakeSocket(this, 'fake' + (++uniqueId));
    this.sockets.sockets.set(socket.id, socket);
    this.handlers.connection(socket);
    return socket;
  }
}
class FakeSocket {
  constructor(io, id) { this.io = io; this.id = id; this.handlers = {}; this.groups = new Set(); this.data = {}; this.notifications = []; }
  on(name, handler) { this.handlers[name] = handler; }
  emit(name, payload) { this.notifications.push([name, payload]); }
  join(group) { this.groups.add(group); }
  leave(group) { this.groups.delete(group); }
  disconnect() { this.handlers.disconnect?.(); this.io.sockets.sockets.delete(this.id); }
  send(name, payload) {
    let outcome;
    this.handlers[name](payload, value => { outcome = value; });
    assert.ok(outcome, `Servidor não respondeu ao evento ${name}`);
    return outcome;
  }
}
function createApp() {
  const app = () => {};
  app.disable = () => {};
  app.use = () => {};
  app.get = () => {};
  return app;
}
createApp.static = () => () => {};
function loadServer() {
  const m = new Module(file);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const originalRequire = m.require.bind(m);
  m.require = id => {
    if (id === 'express') return createApp;
    if (id === 'socket.io') return { Server: FakeServer };
    return originalRequire(id);
  };
  m._compile(fs.readFileSync(file, 'utf8'), file);
  return m.exports;
}
function roomWithThree(server) {
  const ana = server.io.connect();
  const bruno = server.io.connect();
  const carla = server.io.connect();
  const a = ana.send('createRoom', { name: 'Ana' });
  const b = bruno.send('joinRoom', { code: a.code, name: 'Bruno' });
  const c = carla.send('joinRoom', { code: a.code, name: 'Carla' });
  assert.ok(a.ok && b.ok && c.ok);
  const room = server.rooms.get(a.code);
  return { ana, bruno, carla, a, b, c, room };
}

test('sorteia por tema e nível sem repetir até esgotar a combinação na sala', () => {
  const server = loadServer();
  const { ana, room } = roomWithThree(server);
  const filmes = require('../perguntas/filmes.json');
  const paises = require('../perguntas/paises.json');
  const seen = new Set();

  const play = (payload, expected, label) => {
    assert.equal(ana.send('action', { action: 'start', ...payload }).ok, true);
    assert.ok(expected.some(([question, answer]) => question === room.question && answer === room.answer));
    const state = server.publicState(room);
    assert.equal(state.questionLabel, label);
    assert.equal(state.question, undefined);
    assert.equal(state.answer, undefined);
    const picker = server.io.sockets.sockets.get(room.players[room.turnIndex].socketId);
    assert.equal(picker.send('action', { action: 'reveal', index: 0 }).ok, true);
    assert.equal(picker.send('action', { action: 'guess', guess: room.answer.split('|')[0].trim() }).ok, true);
    const question = room.question;
    const nextAction = room.result.standings ? 'rematch' : 'nextRound';
    assert.equal(ana.send('action', { action: nextAction }).ok, true);
    return question;
  };

  assert.equal(ana.send('action', { action: 'start', theme: '__proto__', difficulty: 'facil' }).ok, false);
  assert.equal(ana.send('action', { action: 'start', theme: 'filmes', difficulty: 'invalido' }).ok, false);
  assert.equal(room.round, 0);

  for (const _ of filmes.facil) {
    const question = play({ theme: 'filmes', difficulty: 'facil' }, filmes.facil, 'Filmes · Fácil');
    assert.equal(seen.has(question), false);
    seen.add(question);
    if (seen.size === 1) {
      play({ theme: 'filmes', difficulty: 'medio' }, filmes.medio, 'Filmes · Médio');
      play({ theme: 'paises', difficulty: 'dificil' }, paises.dificil, 'Países · Difícil');
    }
  }
  assert.equal(seen.size, filmes.facil.length);
  play({ theme: 'filmes', difficulty: 'facil' }, filmes.facil, 'Filmes · Fácil');
  play({}, require('../perguntas/gerais.json').medio, 'Conhecimentos gerais · Médio');
  play({ mode: 'custom', question: 'Que cor?', answer: 'Verde', theme: 'invalido' }, [['Que cor?', 'Verde']], null);
});

test('partidas de cinco e dez rodadas encerram com classificação e permitem revanche', () => {
  const server = loadServer();
  const start = { action: 'start', mode: 'custom', question: 'Que cor?', answer: 'Verde' };

  for (const matchLength of [5, 10]) {
    const { ana, bruno, carla, room } = roomWithThree(server);
    assert.equal(ana.send('action', { ...start, matchLength: 6 }).ok, false);
    const winners = [ana, bruno, carla, ana, bruno];

    for (let index = 0; index < matchLength; index++) {
      const action = index === 0 ? { ...start, matchLength } : start;
      assert.equal(ana.send('action', action).ok, true);
      assert.equal(server.publicState(room).matchLength, matchLength);
      assert.equal(ana.send('action', { action: 'rematch' }).ok, false);
      const picker = server.io.sockets.sockets.get(room.players[room.turnIndex].socketId);
      assert.equal(picker.send('action', { action: 'reveal', index: 0 }).ok, true);
      const winner = winners[index % winners.length];
      while (room.players.find(p => p.id === room.guessOrder[room.guessIndex]).socketId !== winner.id) {
        const player = room.players.find(p => p.id === room.guessOrder[room.guessIndex]);
        assert.equal(server.io.sockets.sockets.get(player.socketId).send('action', { action: 'skipGuess' }).ok, true);
      }
      assert.equal(winner.send('action', { action: 'guess', guess: 'Verde' }).ok, true);
      if (index + 1 < matchLength) {
        assert.equal(room.result.standings, undefined);
        assert.equal(ana.send('action', { action: 'nextRound' }).ok, true);
      }
    }

    const score = matchLength === 5 ? 2 : 4;
    assert.deepEqual(server.publicState(room).result.standings, [
      { name: 'Ana', score, rank: 1 },
      { name: 'Bruno', score, rank: 1 },
      { name: 'Carla', score: score / 2, rank: 3 }
    ]);
    assert.equal(ana.send('action', start).ok, false);
    assert.equal(ana.send('action', { action: 'nextRound' }).ok, false);
    assert.equal(bruno.send('action', { action: 'rematch' }).ok, false);
    assert.equal(ana.send('leaveRoom', {}).ok, true);
    assert.equal(room.result.standings[0].name, 'Ana');
    assert.equal(bruno.send('action', { action: 'rematch' }).ok, true);
    assert.equal(room.round, 0);
    assert.equal(room.result, null);
    assert.deepEqual(room.players.map(p => p.score), [0, 0]);
    assert.equal(server.rooms.get(room.code), room);
    assert.equal(bruno.send('action', { ...start, matchLength: matchLength === 5 ? 10 : 5 }).ok, true);
  }
});

test('ao remover quem vai chutar, a vez passa ao próximo em ordem circular', () => {
  const server = loadServer();
  const { ana, bruno, carla, a, b, c, room } = roomWithThree(server);
  assert.ok(ana.send('action', { action: 'start', mode: 'custom', question: 'Qual é a cor do céu?', answer: 'Azul' }).ok);
  assert.ok(ana.send('action', { action: 'reveal', index: 3 }).ok);
  assert.deepEqual(room.guessOrder, [a.playerId, b.playerId, c.playerId]);
  assert.ok(ana.send('action', { action: 'guess', guess: 'Verde' }).ok);
  assert.equal(room.guessOrder[room.guessIndex], b.playerId);
  assert.ok(ana.send('kickPlayer', { playerId: b.playerId }).ok);
  assert.deepEqual(room.guessOrder, [a.playerId, c.playerId]);
  assert.equal(room.guessOrder[room.guessIndex], c.playerId);
  assert.equal(bruno.notifications.at(-1)[0], 'removedFromRoom');
  assert.equal(bruno.send('action', { action: 'guess', guess: 'Azul' }).ok, false);
  assert.equal(bruno.send('joinRoom', { code: a.code, name: 'Bruno', token: b.token }).ok, false);
  assert.equal(bruno.send('joinRoom', { code: a.code, name: 'Bruno' }).ok, false);
  assert.ok(carla.send('action', { action: 'guess', guess: 'Azul' }).ok);
  assert.equal(room.phase, 'ended');
  assert.equal(room.players[1].score, 1);
});

test('remover quem já chutou mantém sequência e próximo pedido', () => {
  const server = loadServer();
  const { ana, bruno, carla, b, c, room } = roomWithThree(server);
  ana.send('action', { action: 'start', mode: 'custom', question: 'Qual é a cor do céu?', answer: 'Azul' });
  ana.send('action', { action: 'reveal', index: 2 });
  ana.send('action', { action: 'skipGuess' });
  bruno.send('action', { action: 'skipGuess' });
  assert.equal(room.guessOrder[room.guessIndex], c.playerId);
  assert.ok(ana.send('kickPlayer', { playerId: b.playerId }).ok);
  assert.equal(room.guessOrder[room.guessIndex], c.playerId);
  carla.send('action', { action: 'skipGuess' });
  assert.equal(room.phase, 'pick');
  assert.equal(room.players[room.turnIndex].id, c.playerId);
});

test('se anfitrião sair durante palpite, cargo e escolha passam corretamente', () => {
  const server = loadServer();
  const { ana, bruno, carla, a, b, c, room } = roomWithThree(server);
  ana.send('action', { action: 'start', mode: 'custom', question: 'Qual é a cor do céu?', answer: 'Azul' });
  ana.send('action', { action: 'reveal', index: 2 });
  assert.ok(ana.send('leaveRoom', {}).ok);
  assert.equal(room.players.length, 2);
  assert.equal(room.hostId, b.playerId);
  assert.equal(room.guessOrder[room.guessIndex], b.playerId);
  assert.equal(ana.send('action', { action: 'skipGuess' }).ok, false);
  bruno.send('action', { action: 'skipGuess' });
  carla.send('action', { action: 'skipGuess' });
  assert.equal(room.phase, 'pick');
  assert.equal(room.players[room.turnIndex].id, b.playerId);
  bruno.send('action', { action: 'reveal', index: 1 });
  assert.deepEqual(room.guessOrder, [b.playerId, c.playerId]);
});

test('remover o participante que acabou de pedir a dica não salta o próximo', () => {
  const server = loadServer();
  const { ana, bruno, carla, b, room } = roomWithThree(server);
  ana.send('action', { action: 'start', mode: 'custom', question: 'Qual é a cor do céu?', answer: 'Azul' });
  // Ana pode sair (host) durante a fase de escolha.
  ana.send('leaveRoom', {});
  assert.equal(room.players[room.turnIndex].id, b.playerId);
  assert.ok(bruno.send('action', { action: 'reveal', index: 0 }).ok);
  assert.equal(room.guessOrder[0], b.playerId);
  assert.equal(room.guessOrder.length, 2);
});

test('sair como último jogador apaga sala; encerrar notifica todos', () => {
  const server = loadServer();
  const { ana, bruno, carla, a, room } = roomWithThree(server);
  assert.equal(bruno.send('closeRoom', {}).ok, false);
  assert.equal(carla.send('kickPlayer', { playerId: a.playerId }).ok, false);
  assert.equal(ana.send('kickPlayer', { playerId: a.playerId }).ok, false);
  assert.ok(ana.send('closeRoom', {}).ok);
  assert.equal(server.rooms.has(a.code), false);
  for (const client of [ana, bruno, carla]) {
    assert.ok(client.notifications.some(([event]) => event === 'roomClosed'));
    assert.equal(client.send('leaveRoom', {}).ok, false);
  }
  assert.equal(bruno.send('joinRoom', { code: a.code, name: 'Bruno' }).ok, false);
  const only = server.io.connect();
  const solo = only.send('createRoom', { name: 'Solo' });
  assert.ok(only.send('leaveRoom', {}).ok);
  assert.equal(server.rooms.has(solo.code), false);
});

test('host pode remover participante ausente e evitar retorno pelo token', () => {
  const server = loadServer();
  const { ana, bruno, a, b, room } = roomWithThree(server);
  bruno.disconnect();
  assert.equal(room.players.find(p => p.id === b.playerId).connected, false);
  assert.ok(ana.send('kickPlayer', { playerId: b.playerId }).ok);
  const reconnect = server.io.connect();
  assert.equal(reconnect.send('joinRoom', { code: a.code, name: 'Bruno', token: b.token }).ok, false);
});

test('quando o anfitrião sai na sala de espera, outro recebe o cargo e pode iniciar', () => {
  const server = loadServer();
  const { ana, bruno, b, room } = roomWithThree(server);
  assert.ok(ana.send('leaveRoom', {}).ok);
  assert.equal(room.hostId, b.playerId);
  assert.ok(bruno.send('action', { action: 'start', mode: 'custom', question: 'Qual é a cor do céu?', answer: 'Azul' }).ok);
  assert.equal(room.phase, 'pick');
  assert.equal(room.players[room.turnIndex].id, b.playerId);
});

test('solo continua após outra pessoa sair e todos os palpites terem acabado', () => {
  const server = loadServer();
  const { ana, bruno, carla, a, room } = roomWithThree(server);
  ana.send('action', { action: 'start', mode: 'custom', question: 'Qual é a cor do céu?', answer: 'Azul' });
  ana.send('action', { action: 'reveal', index: 2 });
  assert.ok(ana.send('kickPlayer', { playerId: room.players[2].id }).ok);
  assert.ok(bruno.send('leaveRoom', {}).ok);
  assert.equal(room.players.length, 1);
  assert.equal(room.guessOrder.length, 1);
  assert.equal(room.guessOrder[room.guessIndex], a.playerId);
  assert.ok(ana.send('action', { action: 'skipGuess' }).ok);
  assert.equal(room.phase, 'pick');
  assert.equal(room.players[room.turnIndex].id, a.playerId);
  assert.ok(ana.send('action', { action: 'reveal', index: 3 }).ok);
  assert.equal(room.guessOrder.length, 1);
});
