(function () {
  'use strict';

  /* ================= данные и индексы ================= */
  var SETS = window.VOCAB_SETS || [];
  var LEVELS = {
    1: { name: 'Лёгкий', cefr: 'A1' },
    2: { name: 'Средний', cefr: 'A2' },
    3: { name: 'Сложный', cefr: 'B1' }
  };
  var KEY = 'vocab-trainer.v1';
  var MASTER_STREAK = 3; // сколько правильных подряд, чтобы слово перестало быть «слабым»

  var $app = document.getElementById('app');
  var $nav = document.getElementById('nav');

  var ALL = [];
  var SET_BY_ID = {};
  var enIdx = new Map();      // английское слово -> карточки
  var ruIdx = new Map();      // русское слово -> карточки
  var ruPrimary = new Map();  // основное русское слово -> карточки

  function norm(s) {
    return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function addTo(map, key, card) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(card);
  }

  SETS.forEach(function (s) {
    SET_BY_ID[s.id] = s;
    s.cards.forEach(function (c) {
      c.setId = s.id;
      c.id = s.id + ':' + c.en[0] + ':' + c.ru[0] + (c.hint ? ':' + c.hint : '');
      ALL.push(c);
      c.en.forEach(function (w) { addTo(enIdx, norm(w), c); });
      c.ru.forEach(function (w) { addTo(ruIdx, norm(w), c); });
      addTo(ruPrimary, norm(c.ru[0]), c);
    });
  });

  // Связанные карточки: общее английское или русское слово
  var relCache = new Map();
  function related(c) {
    if (relCache.has(c.id)) return relCache.get(c.id);
    var out = new Set();
    c.en.forEach(function (w) { (enIdx.get(norm(w)) || []).forEach(function (x) { if (x !== c) out.add(x); }); });
    c.ru.forEach(function (w) { (ruIdx.get(norm(w)) || []).forEach(function (x) { if (x !== c) out.add(x); }); });
    var arr = Array.from(out);
    relCache.set(c.id, arr);
    return arr;
  }

  /* ================= хранилище ================= */
  var db = load();
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY));
      if (d && d.stats) {
        d.settings = d.settings || {};
        return d;
      }
    } catch (e) { /* ignore */ }
    return { stats: {}, settings: { showDef: false, autoSpeak: false, speakOnFlip: false } };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('Не удалось сохранить прогресс (возможно, отключено хранилище браузера)'); }
  }
  function isWeak(c) {
    var s = db.stats[c.id];
    return !!s && s.w > 0 && s.s < MASTER_STREAK;
  }
  function isMastered(c) {
    var s = db.stats[c.id];
    return !!s && s.s >= MASTER_STREAK;
  }
  function record(c, ok) {
    var s = db.stats[c.id] || { r: 0, w: 0, s: 0, t: 0 };
    if (ok) { s.r++; s.s++; } else { s.w++; s.s = 0; }
    s.t = Date.now();
    db.stats[c.id] = s;
    save();
  }

  /* ================= озвучка ================= */
  function speak(text) {
    if (!('speechSynthesis' in window)) { toast('Озвучка не поддерживается в этом браузере'); return; }
    var synth = window.speechSynthesis;
    synth.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    var vs = synth.getVoices();
    var v = vs.find(function (x) { return x.lang === 'en-US'; }) ||
            vs.find(function (x) { return x.lang && x.lang.indexOf('en') === 0; });
    if (v) u.voice = v;
    synth.speak(u);
  }
  if ('speechSynthesis' in window) { window.speechSynthesis.getVoices(); }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }

  /* ================= состояние интерфейса ================= */
  var state = {
    view: 'home',
    filter: { level: '', cat: '', q: '' },
    study: null,
    setup: null,
    dict: null,
    res: null
  };

  function go(v) {
    state.view = v;
    if (v === 'setup' && !state.setup) state.setup = initSetup();
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    renderNav();
    var views = { home: viewHome, study: viewStudy, setup: viewSetup, dict: viewDict, result: viewResult, weak: viewWeak };
    views[state.view]();
    if (state.view === 'dict' && state.dict.phase === 'ask') {
      var inp = document.getElementById('ans');
      if (inp) inp.focus();
      var it = state.dict.items[state.dict.i];
      if (db.settings.autoSpeak && it.dir === 'en-ru') setTimeout(function () { speak(it.card.en[0]); }, 60);
    }
  }

  function renderNav() {
    var w = ALL.filter(isWeak).length;
    var v = state.view;
    var items = [
      ['home', 'Наборы', v === 'home' || v === 'study'],
      ['setup', 'Диктант', v === 'setup' || v === 'dict' || v === 'result'],
      ['weak', 'Слабые места' + (w ? ' (' + w + ')' : ''), v === 'weak']
    ];
    $nav.innerHTML = items.map(function (x) {
      return '<button data-act="go" data-v="' + x[0] + '" class="' + (x[2] ? 'active' : '') + '">' + x[1] + '</button>';
    }).join('');
  }

  /* ================= главная: наборы ================= */
  function levelBadge(l) {
    var L = LEVELS[l] || LEVELS[1];
    return '<span class="badge l' + l + '" title="Уровень сложности">' + L.name + ' · ' + L.cefr + '</span>';
  }

  function viewHome() {
    var cats = Array.from(new Set(SETS.map(function (s) { return s.cat; })));
    var f = state.filter;
    var lv = Array.from(new Set(SETS.map(function (s) { return s.level; }))).sort();
    $app.innerHTML =
      '<h2>Наборы карточек</h2>' +
      '<p class="muted">Выбери набор и учи слова по карточкам или сразу пиши диктант.</p>' +
      '<div class="filters">' +
        '<input id="q" type="search" placeholder="Поиск слова (по-русски или по-английски)" value="' + esc(f.q) + '">' +
        '<select id="fLevel"><option value="">Любой уровень</option>' +
          lv.map(function (l) { return '<option value="' + l + '"' + (String(f.level) === String(l) ? ' selected' : '') + '>' + LEVELS[l].name + ' (' + LEVELS[l].cefr + ')</option>'; }).join('') +
        '</select>' +
        '<select id="fCat"><option value="">Все разделы</option>' +
          cats.map(function (c) { return '<option' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div id="homeList"></div>';
    fillHome();
  }

  function setCard(s) {
    var total = s.cards.length;
    var m = s.cards.filter(isMastered).length;
    var w = s.cards.filter(isWeak).length;
    return '<div class="panel set">' +
      '<h4>' + esc(s.title) + '</h4>' +
      '<div class="meta">' + levelBadge(s.level) + '<span>' + total + ' слов</span>' +
        (w ? '<span style="color:var(--bad)">слабых: ' + w + '</span>' : '') + '</div>' +
      '<p>' + esc(s.desc || '') + '</p>' +
      '<div class="progress" title="Выучено: ' + m + ' из ' + total + '"><i style="width:' + Math.round(m / total * 100) + '%"></i></div>' +
      '<div class="muted" style="margin-top:4px">Выучено: ' + m + ' / ' + total + '</div>' +
      '<div class="row">' +
        '<button class="primary" data-act="study" data-id="' + esc(s.id) + '">Учить карточки</button>' +
        '<button data-act="dictSet" data-id="' + esc(s.id) + '">Диктант</button>' +
      '</div></div>';
  }

  function fillHome() {
    var f = state.filter;
    var box = document.getElementById('homeList');
    var q = norm(f.q);
    var h = '';
    if (q) {
      var found = ALL.filter(function (c) {
        return norm(c.ru.join(' ') + ' ' + c.hint + ' ' + c.en.join(' ')).indexOf(q) !== -1;
      }).slice(0, 60);
      h += '<h3>Найдено слов: ' + found.length + '</h3><div class="panel list">';
      if (!found.length) h += '<div class="muted">Ничего не найдено.</div>';
      found.forEach(function (c) {
        h += '<div class="item"><div class="grow"><b>' + esc(c.ru[0]) + '</b>' + (c.hint ? ' <span class="muted">(' + esc(c.hint) + ')</span>' : '') +
          ' — ' + esc(c.en.join(' / ')) + ' <span class="ipa" style="font-size:15px">' + esc(c.ipa[0]) + '</span></div>' +
          '<button class="icon" data-act="speak" data-t="' + esc(c.en[0]) + '">🔊</button>' +
          '<span class="tag">' + esc(SET_BY_ID[c.setId].title) + '</span></div>';
      });
      h += '</div>';
      box.innerHTML = h;
      return;
    }
    var cats = Array.from(new Set(SETS.map(function (s) { return s.cat; })));
    cats.forEach(function (cat) {
      if (f.cat && f.cat !== cat) return;
      var sets = SETS.filter(function (s) { return s.cat === cat && (!f.level || String(s.level) === String(f.level)); });
      if (!sets.length) return;
      h += '<h2>' + esc(cat) + '</h2>';
      var subs = Array.from(new Set(sets.map(function (s) { return s.sub; })));
      subs.forEach(function (sub) {
        h += '<h3>' + esc(sub) + '</h3><div class="grid">' +
          sets.filter(function (s) { return s.sub === sub; }).map(setCard).join('') + '</div>';
      });
    });
    if (!h) h = '<div class="muted">Нет наборов с такими фильтрами.</div>';
    box.innerHTML = h;
  }

  /* ================= изучение карточек ================= */
  function startStudy(cards, title) {
    var front = (state.study && state.study.front) || 'ru';
    state.study = { deck: cards.slice(), i: 0, flip: false, front: front, title: title };
    go('study');
  }

  function relHtml(c) {
    var r = related(c);
    if (!r.length) return '';
    return '<div class="related"><div class="muted">🔗 Другие значения и связанные слова:</div>' +
      r.map(function (x) {
        return '<div class="rel"><b>' + esc(x.ru[0]) + '</b>' + (x.hint ? ' <span class="muted">(' + esc(x.hint) + ')</span>' : '') +
          ' — ' + esc(x.en[0]) + ' <span class="ipa" style="font-size:15px">' + esc(x.ipa[0]) + '</span> ' +
          '<button class="icon" data-act="speak" data-t="' + esc(x.en[0]) + '">🔊</button> ' +
          '<span class="tag">' + esc(SET_BY_ID[x.setId].title) + '</span></div>';
      }).join('') + '</div>';
  }
  function ruFace(c) {
    var others = c.ru.slice(1);
    return '<div class="word">' + esc(c.ru[0]) + '</div>' +
      (c.hint ? '<div class="hint">(' + esc(c.hint) + ')</div>' : '') +
      (others.length ? '<div class="muted">также: ' + esc(others.join(', ')) + '</div>' : '') +
      '<p class="def">' + esc(c.def) + '</p>';
  }
  function enFace(c, withExample) {
    var h = c.en.map(function (w, i) {
      return '<div class="enrow"><span class="word">' + esc(w) + '</span> <span class="ipa">' + esc(c.ipa[i] || c.ipa[0]) + '</span> ' +
        '<button class="icon" data-act="speak" data-t="' + esc(w) + '" title="Произношение">🔊</button></div>';
    }).join('');
    h += '<div class="muted">' + esc(c.pos || '') + '</div>';
    if (withExample && c.ex) {
      h += '<p class="ex">“' + esc(c.ex) + '” <button class="icon" data-act="speak" data-t="' + esc(c.ex) + '" title="Прослушать пример">🔊</button></p>';
    }
    return h;
  }

  function viewStudy() {
    var s = state.study;
    if (s.i >= s.deck.length) {
      $app.innerHTML = '<div class="panel center"><h2>Готово! 🎉</h2><p>Ты прошёл все карточки: ' + esc(s.title) + '.</p>' +
        '<div class="controls"><button class="primary" data-act="restartStudy">Ещё раз</button>' +
        '<button data-act="dictAfter">Диктант по этим словам</button>' +
        '<button data-act="go" data-v="home">К наборам</button></div></div>';
      return;
    }
    var c = s.deck[s.i];
    var rel = related(c).length;
    var frontHtml, backHtml;
    if (s.front === 'ru') {
      frontHtml = ruFace(c);
      backHtml = enFace(c, true) + relHtml(c);
    } else {
      frontHtml = enFace(c, false);
      backHtml = ruFace(c) + (c.ex ? '<p class="ex">“' + esc(c.ex) + '”</p>' : '') + relHtml(c);
    }
    var wk = isWeak(c) ? ' <span class="badge l3">слабое слово</span>' : '';
    $app.innerHTML =
      '<div class="toolbar"><div class="left"><button class="small" data-act="go" data-v="home">← Наборы</button><b>' + esc(s.title) + '</b></div>' +
        '<div class="right"><span class="muted">' + (s.i + 1) + ' / ' + s.deck.length + '</span></div></div>' +
      '<div class="progress blue"><i style="width:' + Math.round(s.i / s.deck.length * 100) + '%"></i></div>' +
      '<div class="toolbar" style="margin-top:10px"><div class="left">' +
        '<button class="small" data-act="front">Лицевая сторона: ' + (s.front === 'ru' ? 'русский' : 'английский') + '</button>' +
        '<button class="small" data-act="shuffle">🔀 Перемешать</button></div>' +
        '<div class="right"><label class="opt" style="margin:0"><input type="checkbox" data-setting="speakOnFlip"' + (db.settings.speakOnFlip ? ' checked' : '') + '> озвучивать при переворачивании</label></div></div>' +
      '<div class="flash" data-act="flip" tabindex="0">' +
        '<div class="side-label">' + (s.flip ? (s.front === 'ru' ? 'Английский' : 'Русский') : (s.front === 'ru' ? 'Русский' : 'Английский')) + wk + '</div>' +
        (s.flip ? backHtml : frontHtml + (rel ? '<div class="chip">🔗 есть связанные значения (' + rel + ')</div>' : '')) +
        (s.flip ? '' : '<div class="muted" style="margin-top:16px">Нажми на карточку или пробел, чтобы перевернуть</div>') +
      '</div>' +
      '<div class="controls">' +
        '<button data-act="prev"' + (s.i === 0 ? ' disabled' : '') + '>‹ Назад</button>' +
        '<button class="bad" data-act="dontknow">Не знаю</button>' +
        '<button class="good" data-act="know">Знаю</button>' +
        '<button data-act="next">Дальше ›</button>' +
      '</div>' +
      '<p class="muted center" style="text-align:center">Клавиши: пробел — перевернуть, ← → — листать. «Знаю» и «Не знаю» влияют на список слабых слов.</p>';
  }

  /* ================= диктант: настройка ================= */
  function initSetup(pre) {
    var old = state.setup || {};
    var sel = {};
    SETS.forEach(function (s) {
      sel[s.id] = { on: !!(pre && pre.indexOf(s.id) !== -1), n: Math.min(10, s.cards.length) };
    });
    var wk = ALL.filter(isWeak).length;
    sel.__weak = { on: !!(pre && pre.indexOf('__weak') !== -1), n: Math.max(1, Math.min(wk > 20 ? 20 : wk, wk || 1)) };
    return { sel: sel, mode: old.mode || 'mix', prio: old.prio !== false };
  }

  function setupSize(id) {
    return id === '__weak' ? ALL.filter(isWeak).length : SET_BY_ID[id].cards.length;
  }

  function viewSetup() {
    var st = state.setup;
    var weakCount = ALL.filter(isWeak).length;
    var h = '<h2>Словарный диктант</h2>' +
      '<p class="muted">Выбери наборы и сколько слов взять из каждого. Ответ нужно написать без ошибок.</p>';

    h += '<div class="panel"><div class="setup-row"><label class="grow"><input type="checkbox" class="chk" data-set="__weak"' + (st.sel.__weak.on ? ' checked' : '') + (weakCount ? '' : ' disabled') + '>' +
      '<span><b>⚠️ Мои слабые слова</b> <span class="muted">(' + weakCount + ')</span></span></label>' +
      '<input type="number" class="num" data-set="__weak" min="1" max="' + Math.max(1, weakCount) + '" value="' + st.sel.__weak.n + '"' + (weakCount ? '' : ' disabled') + '></div></div>';

    var cats = Array.from(new Set(SETS.map(function (s) { return s.cat; })));
    cats.forEach(function (cat) {
      h += '<h3>' + esc(cat) + '</h3><div class="panel">';
      SETS.filter(function (s) { return s.cat === cat; }).forEach(function (s) {
        var sel = st.sel[s.id];
        h += '<div class="setup-row"><label class="grow"><input type="checkbox" class="chk" data-set="' + esc(s.id) + '"' + (sel.on ? ' checked' : '') + '>' +
          '<span>' + esc(s.title) + ' <span class="muted">· ' + esc(s.sub) + ' · ' + s.cards.length + ' слов</span> ' + levelBadge(s.level) + '</span></label>' +
          '<input type="number" class="num" data-set="' + esc(s.id) + '" min="1" max="' + s.cards.length + '" value="' + sel.n + '" title="Сколько слов взять из набора"></div>';
      });
      h += '</div>';
    });

    h += '<h3>Режим</h3><div class="panel">' +
      radio('mode', 'ru-en', 'Русский → английский (пишу слово по-английски)', st.mode) +
      radio('mode', 'en-ru', 'Английский → русский (пишу перевод по-русски)', st.mode) +
      radio('mode', 'mix', 'Вперемешку', st.mode) +
      '<hr style="border:none;border-top:1px solid var(--line)">' +
      '<label class="opt"><input type="checkbox" id="optPrio"' + (st.prio ? ' checked' : '') + '> Сначала брать слова, в которых я ошибался</label>' +
      '<label class="opt"><input type="checkbox" data-setting="showDef"' + (db.settings.showDef ? ' checked' : '') + '> В режиме «рус → англ» показывать определение как подсказку</label>' +
      '<label class="opt"><input type="checkbox" data-setting="autoSpeak"' + (db.settings.autoSpeak ? ' checked' : '') + '> В режиме «англ → рус» произносить слово автоматически</label>' +
      '</div>' +
      '<div class="sticky-start"><button class="primary" data-act="startDict">Начать диктант</button>' +
      '<button data-act="selAll">Выбрать все наборы</button><button data-act="selNone">Снять выбор</button>' +
      '<span class="muted">Слов в диктанте: <b id="total">0</b></span></div>';
    $app.innerHTML = h;
    updateTotal();
  }
  function radio(name, val, label, cur) {
    return '<label class="opt"><input type="radio" name="' + name + '" value="' + val + '"' + (cur === val ? ' checked' : '') + '> ' + label + '</label>';
  }
  function updateTotal() {
    var st = state.setup, total = 0;
    Object.keys(st.sel).forEach(function (id) {
      if (st.sel[id].on) total += Math.min(st.sel[id].n, setupSize(id));
    });
    var el = document.getElementById('total');
    if (el) el.textContent = total;
  }

  function buildItems(cards, mode) {
    return cards.map(function (card) {
      return { card: card, dir: mode === 'mix' ? (Math.random() < 0.5 ? 'ru-en' : 'en-ru') : mode };
    });
  }

  function startFromSetup() {
    var st = state.setup;
    var chosen = new Map();
    var pools = SETS.map(function (s) { return { id: s.id, cards: s.cards }; });
    pools.push({ id: '__weak', cards: ALL.filter(isWeak) });
    pools.forEach(function (p) {
      var sel = st.sel[p.id];
      if (!sel || !sel.on) return;
      var pool = st.prio
        ? shuffle(p.cards.filter(isWeak)).concat(shuffle(p.cards.filter(function (c) { return !isWeak(c); })))
        : shuffle(p.cards);
      var n = Math.max(0, Math.min(sel.n, pool.length));
      pool.slice(0, n).forEach(function (c) { chosen.set(c.id, c); });
    });
    var cards = Array.from(chosen.values());
    if (!cards.length) { toast('Выбери хотя бы один набор'); return; }
    startDict(buildItems(shuffle(cards), st.mode));
  }

  /* ================= диктант: ход ================= */
  function groupFor(it) {
    var c = it.card;
    var g = it.dir === 'ru-en' ? ruPrimary.get(norm(c.ru[0])) : enIdx.get(norm(c.en[0]));
    return g ? Array.from(g) : [c];
  }
  function answersFor(it) {
    var key = it.dir === 'ru-en' ? 'en' : 'ru';
    var out = [];
    groupFor(it).forEach(function (c) {
      c[key].forEach(function (w) {
        if (!out.some(function (x) { return norm(x) === norm(w); })) out.push(w);
      });
    });
    return out;
  }
  function isCorrect(it, val) {
    var v = norm(val);
    if (!v) return false;
    return answersFor(it).some(function (w) { return norm(w) === v; });
  }

  function startDict(items) {
    state.dict = { items: items, i: 0, phase: 'ask', log: [], cur: null };
    go('dict');
  }

  function answer(val, skipped) {
    var d = state.dict;
    if (d.phase !== 'ask') return;
    var it = d.items[d.i];
    var ok = !skipped && isCorrect(it, val);
    record(it.card, ok);
    d.cur = { ok: ok, val: val, skipped: skipped };
    d.log.push({ card: it.card, dir: it.dir, ok: ok, val: val, skipped: skipped, answers: answersFor(it) });
    d.phase = 'fb';
    render();
  }
  function nextQ() {
    var d = state.dict;
    d.i++;
    d.phase = 'ask';
    d.cur = null;
    if (d.i >= d.items.length) { state.res = { log: d.log }; go('result'); return; }
    render();
  }

  function viewDict() {
    var d = state.dict, it = d.items[d.i], c = it.card, fb = d.phase === 'fb';
    var label, prompt;
    if (it.dir === 'ru-en') {
      label = 'Напиши по-английски';
      prompt = '<div class="word">' + esc(c.ru[0]) + '</div>' + (c.hint ? '<div class="hint">(' + esc(c.hint) + ')</div>' : '') +
        (db.settings.showDef ? '<p class="def">' + esc(c.def) + '</p>' : '');
    } else {
      label = 'Напиши перевод по-русски';
      prompt = '<div class="word">' + esc(c.en[0]) + ' <button class="icon" data-act="speak" data-t="' + esc(c.en[0]) + '">🔊</button></div>' +
        '<div class="ipa">' + esc(c.ipa[0]) + '</div>' +
        (groupFor(it).length > 1 ? '<div class="muted">У слова несколько значений — подойдёт любое.</div>' : '');
    }
    var fbHtml = '';
    if (fb) {
      var ans = answersFor(it);
      if (d.cur.ok) {
        fbHtml = '<div class="fb ok"><b style="color:var(--ok)">✅ Верно!</b>' + (ans.length > 1 ? '<div>Все варианты: <b>' + esc(ans.join(' / ')) + '</b></div>' : '') + '</div>';
      } else {
        fbHtml = '<div class="fb no"><b style="color:var(--bad)">❌ ' + (d.cur.skipped ? 'Пропущено' : 'Неверно') + '</b>' +
          (!d.cur.skipped ? '<div>Твой ответ: <b>' + esc(d.cur.val || '—') + '</b></div>' : '') +
          '<div>Правильно: <b>' + esc(ans.join(' / ')) + '</b>' +
          (it.dir === 'ru-en' ? ' <button class="icon" data-act="speak" data-t="' + esc(c.en[0]) + '">🔊</button> <span class="ipa" style="font-size:15px">' + esc(c.ipa[0]) + '</span>' : '') + '</div></div>';
      }
    }
    $app.innerHTML =
      '<div class="toolbar"><div class="left"><button class="small" data-act="quitDict">✕ Завершить</button></div>' +
        '<div class="right"><span class="muted">' + (d.i + 1) + ' / ' + d.items.length + '</span></div></div>' +
      '<div class="progress blue"><i style="width:' + Math.round(d.i / d.items.length * 100) + '%"></i></div>' +
      '<div class="panel q"><div class="label">' + label + '</div>' + prompt +
        '<div class="answer-row"><input id="ans" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Твой ответ…"' +
          (fb ? ' disabled value="' + esc(d.cur.val) + '"' : '') + '>' +
          (fb ? '<button class="primary" data-act="nextQ">Дальше ↵</button>'
              : '<button class="primary" data-act="check">Проверить ↵</button><button data-act="skip">Не знаю</button>') +
        '</div>' + fbHtml + '</div>' +
      '<p class="muted" style="text-align:center">Enter — проверить / перейти дальше. Регистр букв и «е/ё» не важны, остальное — важно.</p>';
  }

  function viewResult() {
    var log = state.res.log;
    var ok = log.filter(function (x) { return x.ok; }).length;
    var bad = log.length - ok;
    var pct = log.length ? Math.round(ok / log.length * 100) : 0;
    var h = '<div class="panel center"><h2>Результат: ' + ok + ' из ' + log.length + ' (' + pct + '%)</h2>' +
      '<p>' + (bad === 0 ? 'Без ошибок! 🎉' : 'Ошибки попали в «Слабые места» — их можно повторить.') + '</p>' +
      '<div class="controls">' +
      (bad ? '<button class="primary" data-act="retryWrong">Повторить ошибки (' + bad + ')</button>' : '') +
      '<button data-act="go" data-v="setup">Новый диктант</button>' +
      '<button data-act="go" data-v="home">К наборам</button></div></div>' +
      '<h3>Разбор</h3><div class="panel list">';
    log.forEach(function (x) {
      var q = x.dir === 'ru-en' ? x.card.ru[0] + (x.card.hint ? ' (' + x.card.hint + ')' : '') : x.card.en[0];
      h += '<div class="item"><span class="mark">' + (x.ok ? '✅' : '❌') + '</span><div class="grow"><b>' + esc(q) + '</b> → ' + esc(x.answers.join(' / ')) +
        (!x.ok ? '<div class="muted">твой ответ: ' + esc(x.val || '—') + '</div>' : '') + '</div></div>';
    });
    h += '</div>';
    $app.innerHTML = h;
  }

  /* ================= слабые места ================= */
  function viewWeak() {
    var weak = ALL.filter(isWeak).sort(function (a, b) { return db.stats[b.id].w - db.stats[a.id].w; });
    var mastered = ALL.filter(isMastered).length;
    var h = '<h2>Слабые места</h2>' +
      '<p class="muted">Сюда попадают слова, в которых ты ошибался. Слово уходит из списка, когда ты ответишь на него правильно ' + MASTER_STREAK + ' раза подряд.</p>' +
      '<div class="panel"><div class="meta">Всего слов: <b>' + ALL.length + '</b> · Выучено: <b>' + mastered + '</b> · Слабых: <b>' + weak.length + '</b></div></div>';
    if (weak.length) {
      h += '<div class="controls" style="justify-content:flex-start"><button class="primary" data-act="studyWeak">Учить слабые карточки</button>' +
        '<button data-act="dictWeak">Диктант по слабым</button></div>' +
        '<div class="panel list" style="margin-top:12px">';
      weak.forEach(function (c) {
        var s = db.stats[c.id];
        h += '<div class="item"><div class="grow"><b>' + esc(c.ru[0]) + '</b>' + (c.hint ? ' <span class="muted">(' + esc(c.hint) + ')</span>' : '') +
          ' — ' + esc(c.en[0]) + ' <span class="ipa" style="font-size:15px">' + esc(c.ipa[0]) + '</span>' +
          '<div class="muted">ошибок: ' + s.w + ' · верно подряд: ' + s.s + '/' + MASTER_STREAK + ' · ' + esc(SET_BY_ID[c.setId].title) + '</div></div>' +
          '<button class="icon" data-act="speak" data-t="' + esc(c.en[0]) + '">🔊</button>' +
          '<button class="small" data-act="forgive" data-id="' + esc(c.id) + '" title="Убрать из слабых">Знаю это</button></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="panel center" style="margin-top:12px">Слабых слов пока нет. Пройди диктант — и ошибки появятся здесь 🙂</div>';
    }
    h += '<h3>Данные</h3><div class="panel"><p class="muted" style="margin-top:0">Прогресс хранится в браузере на этом устройстве. Чтобы перенести его на другое устройство, сохрани в файл и загрузи там.</p>' +
      '<div class="controls" style="justify-content:flex-start"><button data-act="export">⬇ Сохранить прогресс в файл</button>' +
      '<button data-act="import">⬆ Загрузить из файла</button><button class="bad" data-act="reset">Сбросить весь прогресс</button></div>' +
      '<input type="file" id="impFile" accept=".json,application/json" hidden></div>';
    $app.innerHTML = h;
  }

  /* ================= события ================= */
  document.body.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    var s = state.study;

    switch (act) {
      case 'go':
        if (el.getAttribute('data-v') === 'setup') state.setup = initSetup(); // обновить число слабых слов
        go(el.getAttribute('data-v')); break;
      case 'speak': speak(el.getAttribute('data-t')); break;
      case 'study': startStudy(SET_BY_ID[id].cards, SET_BY_ID[id].title); break;
      case 'dictSet': state.setup = initSetup([id]); go('setup'); break;
      case 'flip':
        s.flip = !s.flip;
        if (s.flip && s.front === 'ru' && db.settings.speakOnFlip) speak(s.deck[s.i].en[0]);
        render(); break;
      case 'next': s.i++; s.flip = false; render(); break;
      case 'prev': s.i = Math.max(0, s.i - 1); s.flip = false; render(); break;
      case 'know': record(s.deck[s.i], true); s.i++; s.flip = false; render(); break;
      case 'dontknow': record(s.deck[s.i], false); s.i++; s.flip = false; render(); break;
      case 'shuffle': s.deck = shuffle(s.deck); s.i = 0; s.flip = false; render(); break;
      case 'front': s.front = s.front === 'ru' ? 'en' : 'ru'; s.flip = false; render(); break;
      case 'restartStudy': s.i = 0; s.flip = false; s.deck = shuffle(s.deck); render(); break;
      case 'dictAfter': startDict(buildItems(shuffle(s.deck), 'mix')); break;
      case 'selAll':
        Object.keys(state.setup.sel).forEach(function (k) { if (k !== '__weak') state.setup.sel[k].on = true; });
        viewSetup(); break;
      case 'selNone':
        Object.keys(state.setup.sel).forEach(function (k) { state.setup.sel[k].on = false; });
        viewSetup(); break;
      case 'startDict': startFromSetup(); break;
      case 'check': answer(document.getElementById('ans').value, false); break;
      case 'skip': answer('', true); break;
      case 'nextQ': nextQ(); break;
      case 'quitDict':
        if (state.dict.log.length) { state.res = { log: state.dict.log }; go('result'); }
        else go('setup');
        break;
      case 'retryWrong':
        startDict(shuffle(state.res.log.filter(function (x) { return !x.ok; }).map(function (x) { return { card: x.card, dir: x.dir }; })));
        break;
      case 'studyWeak': startStudy(shuffle(ALL.filter(isWeak)), 'Слабые слова'); break;
      case 'dictWeak':
        state.setup = initSetup(['__weak']);
        state.setup.sel.__weak.n = Math.min(20, ALL.filter(isWeak).length);
        go('setup'); break;
      case 'forgive':
        var st = db.stats[id];
        if (st) { st.s = MASTER_STREAK; save(); }
        render(); break;
      case 'export': exportData(); break;
      case 'import': document.getElementById('impFile').click(); break;
      case 'reset':
        if (confirm('Удалить весь прогресс и список слабых слов? Это нельзя отменить.')) {
          db.stats = {}; save(); toast('Прогресс сброшен'); render();
        }
        break;
    }
  });

  document.body.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'q') { state.filter.q = t.value; fillHome(); }
    if (t.classList && t.classList.contains('num')) {
      var id = t.getAttribute('data-set');
      var max = setupSize(id);
      var n = parseInt(t.value, 10);
      if (isNaN(n) || n < 1) n = 1;
      if (n > max) n = max;
      state.setup.sel[id].n = n;
      updateTotal();
    }
  });

  document.body.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'fLevel') { state.filter.level = t.value; fillHome(); }
    else if (t.id === 'fCat') { state.filter.cat = t.value; fillHome(); }
    else if (t.classList && t.classList.contains('chk')) { state.setup.sel[t.getAttribute('data-set')].on = t.checked; updateTotal(); }
    else if (t.name === 'mode') { state.setup.mode = t.value; }
    else if (t.id === 'optPrio') { state.setup.prio = t.checked; }
    else if (t.getAttribute && t.getAttribute('data-setting')) {
      db.settings[t.getAttribute('data-setting')] = t.checked; save();
    }
    else if (t.id === 'impFile') { importData(t.files[0]); }
    if (t.classList && t.classList.contains('num')) { t.value = state.setup.sel[t.getAttribute('data-set')].n; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    var v = state.view;
    if (v === 'dict') {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (state.dict.phase === 'ask') answer(document.getElementById('ans').value, false);
        else nextQ();
      }
      return;
    }
    if (v === 'study') {
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      var s = state.study;
      if (s.i >= s.deck.length) return;
      if (e.key === ' ' || e.key === 'Enter') {
        if (tag === 'BUTTON') return;
        e.preventDefault();
        s.flip = !s.flip;
        if (s.flip && s.front === 'ru' && db.settings.speakOnFlip) speak(s.deck[s.i].en[0]);
        render();
      } else if (e.key === 'ArrowRight') { s.i++; s.flip = false; render(); }
      else if (e.key === 'ArrowLeft') { s.i = Math.max(0, s.i - 1); s.flip = false; render(); }
    }
  });

  /* ================= экспорт / импорт ================= */
  function exportData() {
    var blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vocab-progress.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importData(file) {
    if (!file) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        if (!d || typeof d.stats !== 'object') throw new Error('bad');
        db = { stats: d.stats, settings: d.settings || db.settings };
        save();
        toast('Прогресс загружен');
        render();
      } catch (err) {
        toast('Не удалось прочитать файл');
      }
    };
    r.readAsText(file);
  }

  render();
})();
