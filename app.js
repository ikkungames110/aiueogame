// あいうえバトル: 画面と P2P 通信（PeerJS / WebRTC）
// ホストがゲーム状態を持ち、各ゲストへ「その人から見える情報」だけを送るスター型構成
(function () {
  'use strict';
  const G = window.AiueGame;
  const ID_PREFIX = 'aiueobattle-';
  const MAX_PLAYERS = 6;
  const $ = (s) => document.querySelector(s);

  const net = {
    peer: null,
    isHost: false,
    myId: null,
    conns: new Map(), // ホスト: peerId → DataConnection
    hostConn: null, // ゲスト: ホストへの接続
  };

  // ホストだけが持つ状態
  const host = {
    code: '',
    members: [], // {id, name}
    settings: { theme: G.THEMES[0], maxAttacks: 2 },
    game: null,
  };

  // 画面に表示中の状態（ホスト・ゲスト共通）
  let view = null;

  // ---------- 共通ユーティリティ ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function savedName() {
    try { return localStorage.getItem('aiue-name') || ''; } catch (e) { return ''; }
  }
  function saveName(n) {
    try { localStorage.setItem('aiue-name', n); } catch (e) { /* noop */ }
  }

  function getName() {
    const n = $('#name').value.trim().slice(0, 12);
    if (!n) {
      toast('名前を入力してください');
      $('#name').focus();
      return null;
    }
    saveName(n);
    return n;
  }

  function peerErrorMessage(err) {
    switch (err && err.type) {
      case 'peer-unavailable': return '部屋が見つかりません。コードを確認してください';
      case 'unavailable-id': return 'その部屋コードは使用中です。もう一度作り直してください';
      case 'network': case 'server-error': case 'socket-error': return 'シグナリングサーバーに接続できません';
      case 'browser-incompatible': return 'このブラウザは WebRTC に対応していません';
      default: return '通信エラー: ' + ((err && err.type) || err);
    }
  }

  // ---------- ホスト ----------
  function createRoom() {
    const name = getName();
    if (!name) return;
    setConnecting(true);
    host.code = randomCode();
    const peer = new Peer(ID_PREFIX + host.code);
    net.peer = peer;
    net.isHost = true;
    peer.on('open', (id) => {
      net.myId = id;
      host.members = [{ id, name }];
      history.replaceState(null, '', '?room=' + host.code);
      setConnecting(false);
      hostBroadcast();
    });
    peer.on('connection', (conn) => {
      conn.on('open', () => net.conns.set(conn.peer, conn));
      conn.on('data', (msg) => {
        try {
          hostHandle(conn.peer, msg);
        } catch (e) {
          conn.send({ t: 'error', message: e.message });
        }
      });
      conn.on('close', () => hostOnLeave(conn.peer));
      conn.on('error', () => hostOnLeave(conn.peer));
    });
    peer.on('error', (err) => {
      setConnecting(false);
      toast(peerErrorMessage(err));
      if (!net.myId) resetToTitle();
    });
    peer.on('disconnected', () => {
      // シグナリングサーバーから切れても既存の P2P 接続は生きているので再接続だけ試みる
      if (!peer.destroyed) peer.reconnect();
    });
  }

  function hostOnLeave(peerId) {
    if (!net.conns.has(peerId)) return;
    net.conns.delete(peerId);
    const m = host.members.find((x) => x.id === peerId);
    if (!m) return;
    if (host.game && host.game.phase !== 'end' && host.game.players.some((p) => p.id === peerId)) {
      G.dropPlayer(host.game, peerId);
    }
    host.members = host.members.filter((x) => x.id !== peerId);
    toast(`${m.name} さんが退出しました`);
    hostBroadcast();
  }

  function hostHandle(from, msg) {
    const isSelf = from === net.myId;
    switch (msg.t) {
      case 'join': {
        const conn = net.conns.get(from);
        if (host.game && host.game.phase !== 'end') throw new Error('ゲーム中のため参加できません');
        if (host.members.length >= MAX_PLAYERS) throw new Error(`満員です（最大${MAX_PLAYERS}人）`);
        let name = String(msg.name || 'ななし').trim().slice(0, 12) || 'ななし';
        while (host.members.some((m) => m.name === name)) name += '＊';
        host.members.push({ id: from, name });
        if (host.game && host.game.phase === 'end') host.game = null;
        if (conn) conn.send({ t: 'joined' });
        toast(`${name} さんが参加しました`);
        break;
      }
      case 'word':
        G.submitWord(host.game, from, msg.word);
        break;
      case 'attack':
        G.attack(host.game, from, msg.ch);
        break;
      case 'settings':
        if (!isSelf) return;
        Object.assign(host.settings, msg.settings);
        break;
      case 'start':
        if (!isSelf) return;
        if (host.members.length < 2) throw new Error('2人以上で開始できます');
        if (!host.settings.theme.trim()) throw new Error('お題を決めてください');
        host.game = G.createGame(host.members, host.settings);
        break;
      case 'lobby':
        if (!isSelf) return;
        host.game = null;
        break;
      default:
        return;
    }
    hostBroadcast();
  }

  function stateFor(id) {
    return {
      code: host.code,
      hostId: net.myId,
      members: host.members,
      settings: host.settings,
      game: host.game ? G.viewFor(host.game, id) : null,
    };
  }

  function hostBroadcast() {
    for (const [id, conn] of net.conns) {
      if (host.members.some((m) => m.id === id)) conn.send({ t: 'state', state: stateFor(id) });
    }
    onState(stateFor(net.myId));
  }

  // ---------- ゲスト ----------
  function joinRoom() {
    const name = getName();
    if (!name) return;
    const code = $('#code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      toast('5文字の部屋コードを入力してください');
      return;
    }
    setConnecting(true);
    const peer = new Peer();
    net.peer = peer;
    net.isHost = false;
    peer.on('open', (id) => {
      net.myId = id;
      const conn = peer.connect(ID_PREFIX + code, { reliable: true });
      net.hostConn = conn;
      conn.on('open', () => conn.send({ t: 'join', name }));
      conn.on('data', (msg) => {
        if (msg.t === 'state') {
          setConnecting(false);
          history.replaceState(null, '', '?room=' + code);
          onState(msg.state);
        } else if (msg.t === 'error') {
          toast(msg.message);
          if (!view) {
            setConnecting(false);
            resetToTitle();
          }
        }
      });
      conn.on('close', () => {
        toast('ホストとの接続が切れました');
        resetToTitle();
      });
    });
    peer.on('error', (err) => {
      setConnecting(false);
      toast(peerErrorMessage(err));
      if (!view) resetToTitle();
    });
  }

  // 自分のアクションを送る（ホストならその場で処理）
  function send(msg) {
    if (net.isHost) {
      try {
        hostHandle(net.myId, msg);
      } catch (e) {
        toast(e.message);
      }
    } else if (net.hostConn && net.hostConn.open) {
      net.hostConn.send(msg);
    }
  }

  function resetToTitle() {
    if (net.peer && !net.peer.destroyed) net.peer.destroy();
    net.peer = null;
    net.hostConn = null;
    net.conns.clear();
    net.myId = null;
    view = null;
    host.game = null;
    setConnecting(false);
    show('title');
  }

  // ---------- 描画 ----------
  function show(screen) {
    for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== 'screen-' + screen;
  }

  function setConnecting(on) {
    $('#connecting').hidden = !on;
    for (const b of document.querySelectorAll('#screen-title button')) b.disabled = on;
  }

  let lastPhase = null;
  function onState(state) {
    const prevLogLen = view && view.game ? view.game.log.length : 0;
    view = state;
    const g = state.game;
    const phase = g ? g.phase : 'lobby';
    if (phase !== lastPhase && phase === 'input') $('#word').value = '';
    lastPhase = phase;
    if (!g) renderLobby();
    else if (g.phase === 'input') renderInput();
    else renderPlay(prevLogLen);
  }

  function renderLobby() {
    show('lobby');
    const s = view;
    const amHost = net.isHost;
    $('#room-code').textContent = s.code;
    $('#member-count').textContent = `${s.members.length} / ${MAX_PLAYERS}`;
    $('#members').innerHTML = s.members.map((m) => `<li>${m.id === s.hostId ? '<span class="badge">ホスト</span>' : ''}${esc(m.name)}${m.id === net.myId ? '<span class="you">（あなた）</span>' : ''}</li>`).join('');

    $('#host-settings').hidden = !amHost;
    $('#guest-wait').hidden = amHost;
    $('#lobby-theme').textContent = s.settings.theme || '（未定）';
    $('#lobby-max').textContent = s.settings.maxAttacks;
    if (amHost) {
      const themeInput = $('#theme');
      if (document.activeElement !== themeInput) themeInput.value = s.settings.theme;
      $('#max-attacks').value = String(s.settings.maxAttacks);
      $('#start').disabled = s.members.length < 2;
      $('#start').textContent = s.members.length < 2 ? 'あと1人以上集まると開始できます' : 'ゲーム開始！';
    }
  }

  function slotsHtml(slots, opts) {
    const o = opts || {};
    if (!slots) return '<div class="slots"></div>';
    return '<div class="slots">' + slots.map((s, i) => {
      const cls = ['slot'];
      let ch = s.c;
      if (s.revealed) cls.push('open');
      else if (ch !== null) cls.push('mine');
      else ch = '';
      if (ch === G.BLANK) cls.push('blank');
      if (o.flash && o.flash.has(i)) cls.push('flash');
      return `<div class="${cls.join(' ')}"><span>${esc(ch)}</span></div>`;
    }).join('') + '</div>';
  }

  function renderInput() {
    show('input');
    const g = view.game;
    $('#input-theme').textContent = g.theme;
    const me = g.players.find((p) => p.id === net.myId);
    const done = me && me.ready;
    $('#word-form').hidden = done;
    $('#word-done').hidden = !done;
    if (done) $('#my-word-confirmed').innerHTML = slotsHtml(me.slots);
    else updatePreview();
    $('#ready-list').innerHTML = g.players.map((p) => `<li class="${p.ready ? 'ok' : ''}${p.out ? ' gone' : ''}">${p.ready ? '✅' : p.out ? '🚪' : '✏️'} ${esc(p.name)}</li>`).join('');
  }

  function updatePreview() {
    const v = $('#word').value;
    let slots;
    let err = '';
    try {
      slots = G.parseWord(v).map((s) => ({ c: s.c, revealed: false }));
    } catch (e) {
      err = v.trim() ? e.message : '';
      const chars = Array.from(v.replace(/\s/g, '')).slice(0, G.SLOTS);
      slots = Array.from({ length: G.SLOTS }, (_, i) => ({ c: chars[i] || null, revealed: false }));
    }
    $('#preview').innerHTML = slotsHtml(slots);
    $('#word-error').textContent = err;
    $('#submit-word').disabled = !!err || !v.trim();
  }

  function renderPlay(prevLogLen) {
    show('play');
    const g = view.game;
    const myTurn = g.phase === 'play' && g.turnId === net.myId;
    const turnPlayer = g.players.find((p) => p.id === g.turnId);
    $('#play-theme').textContent = g.theme;

    const status = $('#status');
    status.className = 'status';
    if (g.phase === 'end') {
      const winners = g.players.filter((p) => g.winnerIds.includes(p.id)).map((p) => p.name);
      status.textContent = `🏆 ${winners.join('・')} さんの勝ち！`;
      status.classList.add('end');
    } else if (myTurn) {
      status.textContent = g.attacksThisTurn > 0 ? '連続攻撃！もう1文字えらんでください' : 'あなたの番です！攻撃する文字をえらんでください';
      status.classList.add('mine');
    } else {
      status.textContent = `${turnPlayer ? turnPlayer.name : ''} さんが攻撃中…`;
    }

    // 直前の攻撃で開いたマスを光らせる
    const used = new Set(g.used);
    const lastCh = g.used[g.used.length - 1];
    const fresh = prevLogLen < g.log.length;
    $('#players').innerHTML = g.players.map((p) => {
      const cls = ['player'];
      if (p.id === g.turnId) cls.push('turn');
      if (p.out) cls.push('out');
      if (p.id === net.myId) cls.push('me');
      if (g.winnerIds.includes(p.id)) cls.push('winner');
      const flash = new Set();
      if (fresh && lastCh && p.slots) p.slots.forEach((s, i) => { if (s.revealed && s.c && G.normalizeChar(s.c) === lastCh) flash.add(i); });
      const tag = p.out ? `<span class="rank">${p.rank}位</span>` : g.winnerIds.includes(p.id) ? '<span class="rank win">1位</span>' : '';
      return `<div class="${cls.join(' ')}">
        <div class="pname">${p.id === g.turnId ? '▶ ' : ''}${esc(p.name)}${p.id === net.myId ? '<span class="you">（あなた）</span>' : ''}${tag}</div>
        ${slotsHtml(p.slots, { flash })}
      </div>`;
    }).join('');

    // 50音ボード
    const cell = (ch) => {
      if (!ch) return '<div class="key empty"></div>';
      const isUsed = used.has(ch);
      return `<button class="key${isUsed ? ' used' : ''}${ch === lastCh ? ' last' : ''}" data-ch="${ch}" ${isUsed || !myTurn ? 'disabled' : ''}>${ch}</button>`;
    };
    const cols = G.BOARD_COLUMNS.slice().reverse(); // 右から あ かさ…
    let html = '';
    for (let r = 0; r < 5; r++) for (const col of cols) html += cell(col[r]);
    $('#board').innerHTML = html;
    $('#board-extra').innerHTML = G.EXTRA.map(cell).join('');
    $('#board-wrap').classList.toggle('active', myTurn);

    const log = $('#log');
    log.innerHTML = g.log.map((l) => `<li>${esc(l)}</li>`).join('');
    log.scrollTop = log.scrollHeight;

    $('#end-actions').hidden = g.phase !== 'end';
    $('#again').hidden = !net.isHost;
    $('#again-wait').hidden = net.isHost;
  }

  // ---------- イベント ----------
  function bind() {
    $('#name').value = savedName();
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      $('#code').value = roomParam.toUpperCase();
      $('#join-hint').hidden = false;
    }

    $('#create').addEventListener('click', createRoom);
    $('#join').addEventListener('click', joinRoom);
    $('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });

    $('#copy-link').addEventListener('click', async () => {
      const url = location.origin + location.pathname + '?room=' + view.code;
      try {
        await navigator.clipboard.writeText(url);
        toast('招待リンクをコピーしました');
      } catch (e) {
        prompt('このリンクを共有してください', url);
      }
    });

    $('#theme').addEventListener('change', () => send({ t: 'settings', settings: { theme: $('#theme').value.trim().slice(0, 30) } }));
    $('#draw-theme').addEventListener('click', () => {
      const cur = host.settings.theme;
      let t = cur;
      while (t === cur) t = G.THEMES[Math.floor(Math.random() * G.THEMES.length)];
      send({ t: 'settings', settings: { theme: t } });
    });
    $('#max-attacks').addEventListener('change', () => send({ t: 'settings', settings: { maxAttacks: Number($('#max-attacks').value) } }));
    $('#start').addEventListener('click', () => send({ t: 'start' }));

    $('#word').addEventListener('input', updatePreview);
    $('#word-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const w = $('#word').value;
      try {
        G.parseWord(w);
      } catch (err) {
        toast(err.message);
        return;
      }
      send({ t: 'word', word: w });
      $('#word').value = '';
    });

    $('#board-wrap').addEventListener('click', (e) => {
      const b = e.target.closest('button.key');
      if (!b || b.disabled) return;
      send({ t: 'attack', ch: b.dataset.ch });
    });

    $('#again').addEventListener('click', () => send({ t: 'lobby' }));
    $('#leave').addEventListener('click', () => {
      history.replaceState(null, '', location.pathname);
      resetToTitle();
    });
    $('#rules-btn').addEventListener('click', () => $('#rules').showModal());
    $('#rules-close').addEventListener('click', () => $('#rules').close());
  }

  bind();
  show('title');
})();
