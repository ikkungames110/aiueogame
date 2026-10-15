// あいうえバトル: ゲームロジック（ホストが権威を持つ。ブラウザ / Node 両対応）
(function (root) {
  'use strict';

  const SLOTS = 7;
  const MIN_LEN = 2;
  const BLANK = '×';

  // 50音ボード（列は右から あ か さ … わ）
  const BOARD_COLUMNS = [
    ['あ', 'い', 'う', 'え', 'お'],
    ['か', 'き', 'く', 'け', 'こ'],
    ['さ', 'し', 'す', 'せ', 'そ'],
    ['た', 'ち', 'つ', 'て', 'と'],
    ['な', 'に', 'ぬ', 'ね', 'の'],
    ['は', 'ひ', 'ふ', 'へ', 'ほ'],
    ['ま', 'み', 'む', 'め', 'も'],
    ['や', null, 'ゆ', null, 'よ'],
    ['ら', 'り', 'る', 'れ', 'ろ'],
    ['わ', null, 'を', null, 'ん'],
  ];
  const EXTRA = ['ー'];
  const ATTACKABLE = new Set(BOARD_COLUMNS.flat().filter(Boolean).concat(EXTRA));
  // ×（あまりマス）は攻撃できず、×以外が全部開いたら脱落

  const NORMALIZE = {};
  const pairs = [
    'がか', 'ぎき', 'ぐく', 'げけ', 'ごこ', 'ざさ', 'じし', 'ずす', 'ぜせ', 'ぞそ',
    'だた', 'ぢち', 'づつ', 'でて', 'どと', 'ばは', 'びひ', 'ぶふ', 'べへ', 'ぼほ',
    'ぱは', 'ぴひ', 'ぷふ', 'ぺへ', 'ぽほ', 'ぁあ', 'ぃい', 'ぅう', 'ぇえ', 'ぉお',
    'っつ', 'ゃや', 'ゅゆ', 'ょよ', 'ゎわ', 'ゔう', 'ゕか', 'ゖけ',
  ];
  for (const p of pairs) NORMALIZE[p[0]] = p[1];

  const THEMES = [
    '食べもの', '動物', 'コンビニにあるもの', '文房具', 'おかず', '乗りもの', '野菜',
    'くだもの', 'スポーツ', '家にあるもの', '学校にあるもの', 'お菓子', '飲みもの',
    '職業', '虫', '海にいるもの', '国の名前', '楽器', '花', '遊園地にあるもの',
    'キッチンにあるもの', '体の部分', '天気', '服・身につけるもの', 'お店', '色',
    '病院にあるもの', '公園にあるもの', '鳥', '魚', '季節のもの', 'おもちゃ',
  ];

  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  }

  function normalizeChar(ch) {
    return NORMALIZE[ch] || ch;
  }

  // 入力文字列 → 7マスの [{c: 表示文字, n: 攻撃判定用の文字}]。不正ならエラー文字列を throw
  function parseWord(input) {
    const raw = Array.from(toHiragana(String(input).trim()).replace(/[\s　]/g, '').replace(/[〜~－-]/g, 'ー'));
    if (raw.length < MIN_LEN || raw.length > SLOTS) {
      throw new Error(`${MIN_LEN}〜${SLOTS}文字で入力してください（今は${raw.length}文字）`);
    }
    const slots = raw.map((c) => {
      const n = normalizeChar(c);
      if (!ATTACKABLE.has(n)) throw new Error(`「${c}」は使えません。ひらがなで入力してください`);
      // 札は濁点・小文字のない形で書く（例：ぎょうざ → きようさ）
      return { c: n, n };
    });
    while (slots.length < SLOTS) slots.push({ c: BLANK, n: BLANK });
    return slots;
  }

  function createGame(players, opts) {
    const o = Object.assign({ maxAttacks: 2, theme: '' }, opts);
    return {
      phase: 'input',
      theme: o.theme,
      maxAttacks: o.maxAttacks,
      players: players.map((p) => ({
        id: p.id, name: p.name, word: null, revealed: Array(SLOTS).fill(false), out: false, rank: null,
      })),
      turn: 0,
      attacksThisTurn: 0,
      used: [],
      log: [],
      winnerIds: [],
    };
  }

  function findPlayer(g, id) {
    return g.players.find((p) => p.id === id);
  }

  function submitWord(g, id, input) {
    if (g.phase !== 'input') throw new Error('いまは言葉を決めるタイミングではありません');
    const p = findPlayer(g, id);
    if (!p) throw new Error('プレイヤーが見つかりません');
    p.word = parseWord(input);
    if (g.players.every((q) => q.word || q.out)) startPlay(g);
  }

  function startPlay(g) {
    g.phase = 'play';
    g.turn = Math.floor(Math.random() * g.players.length);
    if (g.players[g.turn].out) advanceTurn(g);
    g.attacksThisTurn = 0;
    g.log.push(`全員の言葉が決まりました。${g.players[g.turn].name} さんから攻撃です！`);
  }

  function alivePlayers(g) {
    return g.players.filter((p) => !p.out);
  }

  function advanceTurn(g) {
    const n = g.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (g.turn + i) % n;
      if (!g.players[idx].out) {
        g.turn = idx;
        g.attacksThisTurn = 0;
        return;
      }
    }
  }

  // 脱落処理。同時に脱落した人は同順位
  function eliminate(g, list, reason) {
    if (!list.length) return;
    const rank = alivePlayers(g).length - list.length + 1;
    for (const p of list) {
      p.out = true;
      p.rank = Math.max(rank, 1);
      g.log.push(`💥 ${p.name} さん脱落！（${reason}）`);
    }
  }

  function isAllOpen(p) {
    return p.word.every((s, i) => p.revealed[i] || s.n === BLANK);
  }

  function checkEnd(g) {
    const alive = alivePlayers(g);
    if (alive.length <= 1) {
      g.phase = 'end';
      if (alive.length === 1) {
        alive[0].rank = 1;
        g.winnerIds = [alive[0].id];
        g.log.push(`🏆 ${alive[0].name} さんの勝利！`);
      } else {
        const best = Math.min(...g.players.map((p) => p.rank || 99));
        g.winnerIds = g.players.filter((p) => p.rank === best).map((p) => p.id);
        g.log.push('🏆 同時脱落で引き分け！');
      }
      return true;
    }
    return false;
  }

  function attack(g, id, chRaw) {
    if (g.phase !== 'play') throw new Error('いまは攻撃できません');
    const attacker = g.players[g.turn];
    if (attacker.id !== id) throw new Error('あなたの番ではありません');
    const ch = normalizeChar(chRaw);
    if (!ATTACKABLE.has(ch)) throw new Error('その文字は攻撃できません');
    if (g.used.includes(ch)) throw new Error('その文字はもう使われています');

    g.used.push(ch);
    g.attacksThisTurn++;
    const hits = [];
    for (const p of g.players) {
      if (p.out) continue;
      let count = 0;
      p.word.forEach((s, i) => {
        if (s.n === ch && !p.revealed[i]) {
          p.revealed[i] = true;
          count++;
        }
      });
      if (count) hits.push({ p, count });
    }
    if (hits.length) {
      g.log.push(`${attacker.name} さんの攻撃「${ch}」→ ` + hits.map((h) => `${h.p.name}${h.count > 1 ? `×${h.count}` : ''}`).join('、') + ' にヒット！');
    } else {
      g.log.push(`${attacker.name} さんの攻撃「${ch}」→ だれにも当たらなかった`);
    }

    eliminate(g, hits.map((h) => h.p).filter(isAllOpen), `${attacker.name} さんの「${ch}」で全部開いた`);
    if (checkEnd(g)) return { hit: hits.length > 0 };

    if (hits.length && !attacker.out && g.attacksThisTurn < g.maxAttacks) {
      g.log.push(`${attacker.name} さん、連続攻撃！`);
    } else {
      advanceTurn(g);
    }
    return { hit: hits.length > 0 };
  }

  // 切断したプレイヤーを脱落扱いにする
  function dropPlayer(g, id) {
    const p = findPlayer(g, id);
    if (!p || p.out || g.phase === 'end') return;
    const wasTurn = g.phase === 'play' && g.players[g.turn] === p;
    eliminate(g, [p], '切断');
    if (g.phase === 'input' && g.players.every((q) => q.word || q.out)) {
      if (!checkEnd(g)) startPlay(g);
      return;
    }
    if (!checkEnd(g) && wasTurn) advanceTurn(g);
  }

  // 各プレイヤーに送る公開情報（自分の言葉と、終了後は全員の言葉が見える）
  function viewFor(g, viewerId) {
    return {
      phase: g.phase,
      theme: g.theme,
      maxAttacks: g.maxAttacks,
      turnId: g.phase === 'play' ? g.players[g.turn].id : null,
      attacksThisTurn: g.attacksThisTurn,
      used: g.used.slice(),
      log: g.log.slice(-60),
      winnerIds: g.winnerIds.slice(),
      players: g.players.map((p) => {
        const showAll = p.id === viewerId || g.phase === 'end';
        return {
          id: p.id,
          name: p.name,
          ready: !!p.word,
          out: p.out,
          rank: p.rank,
          slots: p.word
            ? p.word.map((s, i) => ({
              c: p.revealed[i] || showAll ? s.c : null,
              revealed: p.revealed[i],
            }))
            : null,
        };
      }),
    };
  }

  const api = {
    SLOTS, BLANK, BOARD_COLUMNS, EXTRA, THEMES,
    normalizeChar, parseWord, createGame, submitWord, attack, dropPlayer, viewFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AiueGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
