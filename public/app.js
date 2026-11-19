(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (s, n = 24) => String(s || '').trim().slice(0, n);
  const invitation = () => { const url = new URL(location.href); url.searchParams.set('sala', roomCode); url.hash = ''; return url.href; };
  const savedKey = 'ps-v2-current-session';
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let socket = null, session = null, state = null, myPlayerId = '', roomCode = '', isHost = false;
  let ready = false, connecting = false, reconnecting = false;
  const queryRoom = new URLSearchParams(location.search).get('sala');
  const urlCode = String(queryRoom || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);

  function showError(where, message) { $(where).textContent = message; $(where).hidden = !message; }
  function online(text, tone = '') { $('network-status').textContent = text; $('network-status').className = 'online ' + tone; }
  function showRoom() {
    $('start-view').hidden = true;
    $('room-view').hidden = false;
    $('room-code-label').textContent = roomCode;
    document.title = `Sala ${roomCode} | Pergunta Secreta`;
    history.replaceState(null, '', `${location.pathname}?sala=${roomCode}`);
  }
  function saveSession(welcome) {
    if (roomCode !== welcome.code) $('match-settings').hidden = true;
    session = { code: welcome.code, name: welcome.name, token: welcome.token };
    const saved = JSON.stringify(session);
    try { sessionStorage.setItem(savedKey, saved); } catch (_) { /* storage opcional */ }
    if (installed) {
      try { localStorage.setItem(savedKey, saved); } catch (_) {}
    }
    roomCode = welcome.code;
    myPlayerId = welcome.playerId;
    state = welcome.state;
    isHost = state.hostId === myPlayerId;
    connecting = false;
    ready = true;
    reconnecting = false;
    online('Sala conectada', 'ok');
    showRoom();
    $('connection-warning').hidden = true;
    showError('start-error', '');
    render();
  }
  function readSaved(storage) {
    try { const s = JSON.parse(window[storage].getItem(savedKey)); return s?.code && s?.token ? s : null; }
    catch { return null; }
  }
  function getSaved() { return readSaved('sessionStorage') || (installed ? readSaved('localStorage') : null); }
  function clearSaved(keepInstalled = false) {
    const token = session?.token;
    session = null;
    try { sessionStorage.removeItem(savedKey); } catch (_) {}
    if (installed && !keepInstalled && token && readSaved('localStorage')?.token === token) {
      try { localStorage.removeItem(savedKey); } catch (_) {}
    }
  }
  function backToStart(message) {
    ready = false;
    connecting = false;
    reconnecting = false;
    state = null;
    myPlayerId = '';
    roomCode = '';
    isHost = false;
    clearSaved();
    $('room-view').hidden = true;
    $('start-view').hidden = false;
    $('connection-warning').hidden = true;
    $('manual-copy').hidden = true;
    showError('invite-status', '');
    showError('room-error', '');
    if ($('room-dialog').open) $('room-dialog').close('cancel');
    $('feedback').textContent = '';
    $('board-feedback').textContent = '';
    $('join-code').value = '';
    document.title = 'Pergunta Secreta | Multiplayer';
    history.replaceState(null, '', location.pathname);
    online(socket?.connected ? 'Conectado ao servidor' : 'Servidor desconectado', socket?.connected ? 'ok' : 'bad');
    showError('start-error', message || '');
  }
  function roomControl(event, payload = {}) {
    send(event, payload, error => {
      showError('room-error', error || '');
      if (error) $('room-error').scrollIntoView({ block: 'nearest' });
      else if (event === 'leaveRoom') backToStart('Você saiu da sala.');
    });
  }
  function confirmRoom(title, message, event, payload) {
    const dialog = $('room-dialog');
    if (dialog.open) return;
    const code = roomCode;
    $('room-dialog-title').textContent = title;
    $('room-dialog-message').textContent = message;
    $('room-dialog-confirm').textContent = title;
    dialog.returnValue = '';
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'confirm' && code === roomCode) roomControl(event, payload);
    }, { once: true });
    dialog.showModal();
  }

  function send(event, data, onResult) {
    if (!socket?.connected) {
      const message = 'Sem conexão com o servidor. Aguarde a reconexão.';
      onResult?.(message, null, true);
      return;
    }
    socket.timeout(12000).emit(event, data, (err, response) => {
      if (err) return onResult?.('O servidor não respondeu. Tente novamente.', null, true);
      if (!response?.ok) return onResult?.(response?.message || 'Não foi possível concluir a operação.', null);
      onResult?.(null, response);
    });
  }
  function joinSaved() {
    if (!session || !socket?.connected || connecting) return;
    const saved = session;
    connecting = true;
    online('Reconectando à sala...');
    send('joinRoom', { code: saved.code, token: saved.token, resume: true }, (error, welcome, retryable) => {
      if (session !== saved) return;
      connecting = false;
      if (error) {
        if (retryable) {
          setTimeout(() => { if (session === saved) joinSaved(); }, 2500);
          return;
        }
        backToStart(error);
        $('join-code').value = saved.code;
        return;
      }
      saveSession(welcome);
    });
  }
  function createRoom(name, spectator) {
    if (connecting) return;
    connecting = true;
    online('Criando sala...');
    send('createRoom', { name, spectator }, (error, welcome) => {
      connecting = false;
      if (error) { online('Não conectou', 'bad'); showError('start-error', error); return; }
      saveSession(welcome);
    });
  }
  function joinRoom(name, code) {
    if (connecting) return;
    const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.length !== 7) return showError('start-error', 'O código da sala precisa ter 7 letras ou números.');
    connecting = true;
    online('Entrando na sala...');
    const old = getSaved();
    const token = old?.code === normalized ? old.token : undefined;
    send('joinRoom', { name, code: normalized, token }, (error, welcome) => {
      connecting = false;
      if (error) { online('Falha ao entrar', 'bad'); showError('start-error', error); return; }
      saveSession(welcome);
    });
  }
  function action(type, data = {}, onResult = null) {
    if (!ready) return;
    send('action', { action: type, ...data }, error => {
      if (type === 'start') showError('host-error', error || '');
      else $(type === 'guess' || type === 'skipGuess' ? 'feedback' : 'board-feedback').textContent = error || '';
      onResult?.(!error);
    });
  }
  function playerMarkup(p, lobby = false) {
    const active = p.id === state.players[state.turnIndex]?.id;
    const label = !p.connected ? 'Ausente' : p.spectator ? 'Só organiza' : p.id === myPlayerId ? 'Você' : p.id === state.hostId ? 'Anfitrião' : 'Online';
    const remove = isHost && p.id !== myPlayerId ? `<button type="button" class="btn danger small kick" data-kick="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" title="Remover ${escapeHtml(p.name)} da sala">Remover</button>` : '';
    return `<div class="${lobby ? 'person-row' : 'score' + (active ? ' active' : '')}"><span class="avatar">${escapeHtml(p.name.charAt(0).toUpperCase())}</span><span class="${lobby ? 'pname' : 'name'}">${escapeHtml(p.name)}</span>${lobby ? `<span class="pill ${p.id === myPlayerId ? 'me' : !p.connected ? 'away' : ''}">${label}</span>${remove}` : `<span class="points">${p.score} ${p.score === 1 ? 'ponto' : 'pontos'}</span>${remove}`}</div>`;
  }
  function render() {
    if (!state) return;
    isHost = state.hostId === myPlayerId;
    const spectator = state.players.find(p => p.id === myPlayerId)?.spectator;
    const players = state.players.filter(p => !p.spectator);
    $('role-label').textContent = spectator ? (isHost ? 'Anfitrião · Só organiza' : 'Espectador') : isHost ? 'Anfitrião' : 'Participante';
    $('close-room').hidden = !isHost;
    $('lobby-view').hidden = state.phase !== 'lobby';
    $('game-view').hidden = state.phase === 'lobby';
    $('host-settings').hidden = !isHost;
    $('guest-wait').hidden = isHost;
    const matchSettings = $('match-settings');
    if (state.round === 0 && matchSettings.hidden) $('match-length').value = String(state.matchLength);
    matchSettings.hidden = state.round !== 0;
    $('lobby-players').innerHTML = state.players.map(p => playerMarkup(p, true)).join('');
    if (state.phase === 'lobby') {
      const hasPlayers = players.some(p => p.connected);
      $('start-game').disabled = !ready || !hasPlayers;
      $('start-game').textContent = state.round ? 'Começar a rodada' : 'Começar a partida';
      $('start-hint').hidden = hasPlayers;
      $('guess-form').hidden = true;
      $('match-result').hidden = true;
      return;
    }
    const candidate = state.players[state.turnIndex];
    const picker = candidate?.connected && !candidate.spectator ? candidate : null;
    const guessing = state.phase === 'guess';
    const idx = state.guessIndex;
    const currentId = state.guessOrder[idx];
    const guesser = players.find(p => p.id === currentId);
    const iCanPick = ready && state.phase === 'pick' && picker?.id === myPlayerId;
    const iCanGuess = ready && guessing && currentId === myPlayerId;
    const round = `Rodada ${state.round} de ${state.matchLength}`;
    $('round-label').textContent = state.questionLabel ? `${round} · ${state.questionLabel}` : round;
    const revealed = Object.keys(state.revealed || {}).length;
    $('reveal-count').textContent = `${revealed} / ${state.wordCount} reveladas`;
    $('reveal-progress').style.width = `${state.wordCount ? 100 * revealed / state.wordCount : 0}%`;
    $('word-grid').innerHTML = Array.from({ length: state.wordCount }, (_, i) => {
      const shown = Object.hasOwn(state.revealed || {}, String(i));
      return `<button class="word ${shown ? 'revealed' : ''}" data-word="${i}" ${!iCanPick || shown ? 'disabled' : ''}><span class="num">Nº ${i + 1}</span><span class="${shown ? 'val' : 'lock'}">${shown ? escapeHtml(state.revealed[i]) : '••••'}</span></button>`;
    }).join('');
    $('turnbar').hidden = state.phase === 'ended';
    $('skip-pick').hidden = !iCanPick || players.filter(p => p.connected).length < 2;
    const turnMessage = guessing ? (iCanGuess ? 'É sua vez de palpitar.' : `${guesser?.name || 'Outro jogador'} está na vez de palpitar.`) :
      iCanPick ? 'É sua vez! Escolha um número.' : picker ? `${picker.name} vai escolher uma palavra.` : 'Aguardando um jogador se reconectar.';
    if ($('board-caption').textContent !== turnMessage) $('board-caption').textContent = turnMessage;
    $('guess-panel').hidden = !guessing;
    $('guess-caption').textContent = iCanGuess ? 'É sua vez de responder.' : `${guesser?.name || 'Outro jogador'} está na vez de responder.`;
    $('guess-count').textContent = `Palpite ${idx + 1} de ${state.guessOrder.length}`;
    $('guess-clue').innerHTML = guessing ? Array.from({ length: state.wordCount }, (_, index) => {
      const word = state.revealed[index];
      if (!word) return '<span class="clue-gap" aria-hidden="true">___</span>';
      return index === state.clueIndex ? `<span class="clue-current">${escapeHtml(word)}</span>` : `<span>${escapeHtml(word)}</span>`;
    }).join(' ') : '';
    $('guess-order').textContent = state.guessOrder.map(id => players.find(p => p.id === id)?.name || '—').join(' → ');
    const guessForm = $('guess-form');
    const showGuessForm = iCanGuess && guessForm.hidden;
    guessForm.hidden = !iCanGuess;
    $('guess-input').disabled = !iCanGuess;
    $('guess-submit').disabled = !iCanGuess;
    $('guess-skip').disabled = !iCanGuess;
    if (!iCanGuess) $('guess-input').value = '';
    $('scoreboard').innerHTML = players.map(p => playerMarkup(p)).join('');
    $('event-log').innerHTML = (state.events || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
    $('round-result').hidden = state.phase !== 'ended';
    const standings = state.result?.standings;
    const showFinal = Boolean(standings) && $('match-result').hidden;
    $('match-result').hidden = !standings;
    if (state.phase === 'ended') {
      const result = state.result || {};
      const roundOutcome = result.winnerId ? `${result.winnerName || 'Alguém'} ganhou 1 ponto!` : 'Ninguém acertou desta vez.';
      $('result-title').textContent = standings ? 'Partida encerrada' : roundOutcome;
      $('round-outcome').textContent = roundOutcome;
      $('round-outcome').hidden = !standings;
      $('question-result').textContent = result.question || '';
      $('answer-result').textContent = result.answer || '';
      $('next-round').textContent = standings ? 'Preparar revanche' : 'Preparar próxima rodada';
      $('next-round').hidden = !isHost;
      $('next-round').disabled = !ready;
      $('waiting-next').textContent = standings ? 'Aguardando o anfitrião preparar a revanche.' : 'Aguardando o anfitrião preparar a próxima rodada.';
      $('waiting-next').hidden = isHost;
      if (standings) {
        $('match-summary').textContent = !standings.length ? 'Nenhum jogador terminou a partida.' : standings[1]?.rank === 1 ? 'Empate em primeiro lugar.' : `${standings[0].name} venceu a partida!`;
        $('match-standings').innerHTML = standings.map(({ name, score, rank }) => `<li class="score"><span class="count">${rank}º</span><span class="name">${escapeHtml(name)}</span><span class="points">${score} ${score === 1 ? 'ponto' : 'pontos'}</span></li>`).join('');
      }
    }
    if (showGuessForm && window.matchMedia('(max-width: 600px)').matches) {
      $('guess-panel').scrollIntoView({ block: 'nearest' });
    }
    if (showFinal && window.matchMedia('(max-width: 600px)').matches) $('round-result').scrollIntoView({ block: 'start' });
  }
  async function copy(text, successMessage) {
    showError('invite-status', '');
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        $('manual-copy').hidden = true;
        showError('invite-status', successMessage);
        return;
      } catch (error) { console.warn('Falha ao copiar o convite.', error); }
    }
    const field = $('manual-copy-value');
    field.value = text;
    $('manual-copy').hidden = false;
    field.focus();
    field.select();
  }
  function bind() {
    $('create-form').addEventListener('submit', e => {
      e.preventDefault(); showError('start-error', '');
      const name = short($('create-name').value);
      if (name) createRoom(name, $('host-spectator').checked);
    });
    $('join-form').addEventListener('submit', e => {
      e.preventDefault(); showError('start-error', '');
      const name = short($('join-name').value);
      if (name) joinRoom(name, $('join-code').value);
    });
    document.querySelectorAll('input[name="question-mode"]').forEach(x => x.addEventListener('change', () => {
      const custom = document.querySelector('input[name="question-mode"]:checked').value === 'custom';
      $('custom-fields').hidden = !custom;
      $('surprise-fields').hidden = custom;
    }));
    $('start-game').addEventListener('click', () => {
      const mode = document.querySelector('input[name="question-mode"]:checked')?.value || 'surprise';
      const question = mode === 'custom'
        ? { question: $('custom-question').value.trim(), answer: $('custom-answer').value.trim() }
        : { theme: $('question-theme').value, difficulty: $('question-difficulty').value };
      const match = state?.round === 0 ? { matchLength: Number($('match-length').value) } : {};
      action('start', { mode, ...question, ...match });
    });
    $('word-grid').addEventListener('click', e => {
      const button = e.target.closest('[data-word]');
      if (button && !button.disabled) action('reveal', { index: Number(button.dataset.word) });
    });
    $('skip-pick').addEventListener('click', () => action('skipPick'));
    $('guess-form').addEventListener('submit', e => {
      e.preventDefault(); const guess = $('guess-input').value.trim();
      if (!guess) return;
      action('guess', { guess }, sent => { if (sent) $('guess-input').value = ''; });
    });
    $('guess-skip').addEventListener('click', () => action('skipGuess'));
    $('next-round').addEventListener('click', () => {
      const next = state?.result?.standings ? 'rematch' : 'nextRound';
      action(next, {}, sent => { if (sent) { $('custom-question').value = ''; $('custom-answer').value = ''; } });
    });
    $('copy-code').addEventListener('click', () => copy(roomCode, 'Código copiado!'));
    $('copy-link').addEventListener('click', () => copy(invitation(), 'Link copiado!'));
    if (typeof navigator.share === 'function') {
      $('share-room').hidden = false;
      $('copy-link').classList.replace('primary', 'secondary');
      $('share-room').addEventListener('click', async () => {
        showError('invite-status', '');
        try { await navigator.share({ title: 'Pergunta Secreta', url: invitation() }); }
        catch (error) {
          if (error.name === 'AbortError') return;
          console.warn('Falha ao compartilhar o convite.', error);
          showError('invite-status', 'Use Copiar link de convite para enviar o link.');
        }
      });
    }
    $('leave-room').addEventListener('click', () => {
      const others = state?.players.filter(p => p.id !== myPlayerId).length || 0;
      const message = isHost && others ? 'Sair desta sala? Outro participante assumirá como anfitrião.' :
        isHost ? 'Sair da sala? Como você é a única pessoa, a sala será fechada.' : 'Deseja sair desta sala?';
      confirmRoom('Sair da sala', message, 'leaveRoom');
    });
    $('close-room').addEventListener('click', () => {
      confirmRoom('Encerrar sala', 'A partida será encerrada para todos e o código deixará de funcionar.', 'closeRoom');
    });
    function handleRemoveClick(e) {
      const target = e.target.closest('[data-kick]');
      if (!target || !isHost) return;
      confirmRoom('Remover participante', `Remover ${target.dataset.name} da sala? O participante perderá o acesso a esta partida.`, 'kickPlayer', { playerId: target.dataset.kick });
    }
    $('lobby-players').addEventListener('click', handleRemoveClick);
    $('scoreboard').addEventListener('click', handleRemoveClick);
    window.addEventListener('beforeunload', e => {
      if (isHost && ready && state?.phase === 'guess') { e.preventDefault(); e.returnValue = ''; }
    });
  }
  function initConnection() {
    if (location.protocol === 'file:') {
      online('Servidor necessário', 'bad');
      showError('start-error', 'Esta versão precisa rodar no servidor Node. Execute npm start ou publique como Web Service no Render.');
      return;
    }
    if (typeof io !== 'function') {
      online('Servidor indisponível', 'bad');
      showError('start-error', 'Não foi possível carregar o sistema multiplayer. Confira se o servidor está online.');
      return;
    }
    socket = io({ transports: ['polling', 'websocket'], reconnection: true, reconnectionDelay: 700, reconnectionDelayMax: 4000, timeout: 15000 });
    socket.on('connect', () => {
      if (session) joinSaved();
      else online('Conectado ao servidor', 'ok');
    });
    socket.on('roomState', next => {
      if (!ready) return;
      state = next;
      render();
    });
    socket.on('disconnect', () => {
      if (ready) {
        ready = false; reconnecting = true;
        online('Reconectando...', 'bad');
        $('connection-warning').hidden = false;
        $('connection-warning').textContent = 'A conexão caiu. Tentando entrar novamente na mesma sala...';
        render();
      } else online('Servidor desconectado', 'bad');
    });
    socket.on('connect_error', () => {
      online('Servidor indisponível', 'bad');
      if (!ready && !reconnecting) showError('start-error', 'Não foi possível conectar ao servidor. Se estiver no Render gratuito, ele pode estar iniciando. Tente novamente daqui a pouco.');
    });
    socket.on('removedFromRoom', payload => {
      if (payload?.code && payload.code !== roomCode) return;
      backToStart(payload?.message || 'Você foi removido da sala pelo anfitrião.');
    });
    socket.on('roomClosed', payload => {
      if (payload?.code && payload.code !== roomCode) return;
      backToStart(payload?.message || 'A sala foi encerrada.');
    });
    socket.on('sessionReplaced', () => {
      ready = false;
      clearSaved(true);
      if ($('room-dialog').open) $('room-dialog').close('cancel');
      render();
      $('connection-warning').hidden = false;
      $('connection-warning').textContent = 'Sua sessão foi aberta em outra aba. Use essa outra aba para jogar.';
      online('Sessão em outra aba', 'bad');
    });
  }

  bind();
  if (urlCode) { $('join-code').value = urlCode; $('join-name').focus(); }
  const previous = getSaved();
  if (previous && (!urlCode || previous.code === urlCode)) {
    session = previous;
    $('join-name').value = previous.name;
    $('join-code').value = previous.code;
    online('Retomando sua sala...');
  }
  initConnection();
})();
