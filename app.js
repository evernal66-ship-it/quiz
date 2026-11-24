/* 期末冲刺 · 刷题 */
(function () {
  'use strict';

  const D = window.BANK;
  const LSKEY = 'szk_v1';
  const ALL_CH = D.chapters.map(c => c.name);

  /* ---------------- 状态 ---------------- */
  let st = {
    ans: {},          // 选择题: id -> {p:[..], ok:bool, t:ts}
    mem: {},          // 简答/论述: id -> {ok:bool, t:ts}   自己评「记住了」
    fav: [],
    filter: { ch: 'all', type: 'all', mode: 'all' },
    pos: 0,
    seed: 0,
    tab: 'quiz',
    exam: null        // 模拟考试
  };
  try {
    const raw = localStorage.getItem(LSKEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        st.ans = o.ans || {};
        st.mem = o.mem || {};
        st.fav = o.fav || [];
        if (o.filter && o.filter.type) st.filter = o.filter;
        else if (o.filter) st.filter = { ch: o.filter.ch || 'all', type: 'all', mode: o.filter.mode || 'all' };
        st.seed = o.seed || 0;
        st.pos = o.pos || 0;
        st.exam = o.exam || null;
      }
    }
  } catch (e) {}
  if (!st.seed) st.seed = Math.floor(Math.random() * 1e9);

  const save = debounce(() => {
    try {
      localStorage.setItem(LSKEY, JSON.stringify({
        ans: st.ans, mem: st.mem, fav: st.fav,
        filter: st.filter, seed: st.seed, pos: st.pos, exam: st.exam
      }));
    } catch (e) {}
  }, 220);
  // 立即落盘（不经过 debounce），用于首次启动与页面隐藏时
  function saveNow() {
    try {
      localStorage.setItem(LSKEY, JSON.stringify({
        ans: st.ans, mem: st.mem, fav: st.fav,
        filter: st.filter, seed: st.seed, pos: st.pos, exam: st.exam
      }));
    } catch (e) {}
  }
  addEventListener('pagehide', saveNow);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = t => esc(t).replace(/\n/g, '<br>');

  /* ---------------- 乱序：稳定哈希排序 ---------------- */
  function hash32(n) {
    n = n >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b) >>> 0;
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b) >>> 0;
    return (n ^ (n >>> 16)) >>> 0;
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function keyOf(seed, id) {
    const n = typeof id === 'number' ? id : hashStr(String(id));
    return hash32((hash32(seed) ^ n) >>> 0);
  }
  // 按 seed 稳定打乱：同一 seed 下顺序固定，切题不会跳
  function shuffled(arr) {
    const s = st.seed;
    return arr.slice().sort((a, b) => {
      const d = keyOf(s, a.id) - keyOf(s, b.id);
      return d !== 0 ? d : (String(a.id) < String(b.id) ? -1 : 1);
    });
  }
  function reshuffle() {
    st.seed = Math.floor(Math.random() * 1e9);
    st.pos = 0;
    save();
    if (st.tab === 'quiz') renderQuiz();
    toast('已重新打乱顺序');
  }
  // 真随机打乱（用于抽题，不影响题序）
  function rnd(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------- 数据加工 ---------------- */
  const byId = {};
  D.choice.forEach(q => { byId[q.id] = q; });

  // 简答/论述统一成题目对象，方便混排
  const SHORT_ITEMS = D.short.map((s, i) => ({
    id: 's' + i, kind: 'short', ch: '', s: s.title, page: s.page, body: s.body
  }));
  const ESSAY_ITEMS = D.essay.map((e, i) => ({
    id: 'e' + i, kind: 'essay', ch: e.group, s: e.q, points: e.points, group: e.group
  }));
  const ALL_ITEMS = D.choice.concat(SHORT_ITEMS, ESSAY_ITEMS);

  function visible(q) {
    const f = st.filter;
    if (f.ch !== 'all') {
      if (!q.ch) return false;                    // 简答没有章节归属
      if (q.ch !== f.ch) return false;
    }
    if (f.type !== 'all' && (q.kind || 'choice') !== f.type) return false;
    const rec = q.kind ? st.mem[q.id] : st.ans[q.id];
    if (f.mode === 'todo') return !rec;
    if (f.mode === 'wrong') return rec && rec.ok === false;
    if (f.mode === 'fav') return st.fav.indexOf(q.id) >= 0;
    if (f.mode === 'dm') return !!q.dm;
    return true;
  }

  function pool() { return shuffled(ALL_ITEMS.filter(visible)); }

  /* ---------------- 统计 ---------------- */
  function stat() {
    const ids = Object.keys(st.ans);
    const done = ids.length;
    const right = ids.filter(id => st.ans[id].ok).length;
    const memIds = Object.keys(st.mem);
    const memOk = memIds.filter(id => st.mem[id].ok).length;
    return {
      done: done, total: D.choice.length, right: right,
      wrong: done - right,
      rate: done ? Math.round(right / done * 100) : 0,
      memAll: SHORT_ITEMS.length + ESSAY_ITEMS.length,
      memDone: memIds.length, memOk: memOk
    };
  }

  // 全量统计：按题型 / 按章节
  function statAll() {
    const by = {
      single: { done: 0, ok: 0, total: 0, label: '单选题' },
      multi: { done: 0, ok: 0, total: 0, label: '多选题' },
      short: { done: 0, ok: 0, total: 0, label: '简答题' },
      essay: { done: 0, ok: 0, total: 0, label: '论述题' }
    };
    D.choice.forEach(q => {
      const b = by[q.t]; b.total++;
      const a = st.ans[q.id]; if (a) { b.done++; if (a.ok) b.ok++; }
    });
    SHORT_ITEMS.forEach(q => {
      by.short.total++;
      const m = st.mem[q.id]; if (m) { by.short.done++; if (m.ok) by.short.ok++; }
    });
    ESSAY_ITEMS.forEach(q => {
      by.essay.total++;
      const m = st.mem[q.id]; if (m) { by.essay.done++; if (m.ok) by.essay.ok++; }
    });
    const ch = {};
    D.choice.forEach(q => {
      const c = q.ch.split('  ')[0];
      if (!ch[c]) ch[c] = { done: 0, ok: 0, total: 0 };
      ch[c].total++;
      const a = st.ans[q.id]; if (a) { ch[c].done++; if (a.ok) ch[c].ok++; }
    });
    let done = 0, ok = 0, total = 0;
    Object.values(by).forEach(b => { done += b.done; ok += b.ok; total += b.total; });
    // 待复习 = 做错的 + 没记住的
    const wrongN = Object.keys(st.ans).filter(id => !st.ans[id].ok).length
      + Object.keys(st.mem).filter(id => !st.mem[id].ok).length;
    return { by, ch, done, ok, total, wrongN, rate: done ? Math.round(ok / done * 100) : 0 };
  }

  /* ---------------- 渲染：刷题 ---------------- */
  let pend = [];      // 当前题暂选

  function renderQuiz() {
    const list = pool();
    const el = $('#screen-quiz');
    if (st.pos >= list.length) st.pos = Math.max(0, list.length - 1);

    if (!list.length) {
      el.innerHTML = '<div class="empty"><div class="big">✓</div>这个筛选条件下没有题目<br><span style="font-size:13px">换个条件试试</span></div>';
      return;
    }

    const q = list[st.pos];
    const kind = q.kind || 'choice';
    const rec = kind === 'choice' ? st.ans[q.id] : st.mem[q.id];
    const closed = !!rec;
    pend = [];

    if (kind !== 'choice') {
      el.innerHTML = cardRecite(q, rec, list);
      bindRecite(q, list);
      return;
    }

    const multi = q.t === 'multi';
    const head = `
      <div class="bar"><i style="width:${(st.pos + 1) / list.length * 100}%"></i></div>
      <div class="qhead">
        <span class="idx">${st.pos + 1} / ${list.length}</span>
        <span class="tag ${multi ? 'multi' : ''}">${multi ? '多选' : '单选'}</span>
        ${q.dm ? '<span class="tag" style="color:var(--warn);border-color:var(--warn)">精简版未收录</span>' : ''}
        <span class="sp"></span>
        <span>${esc((q.ch || '').split('  ')[0])}</span>
      </div>
      <div class="stem">${esc(q.s)}</div>`;

    const opts = ['A', 'B', 'C', 'D'].map(k => {
      const txt = q.o[k];
      if (!txt) return '';
      let cls = 'opt';
      if (closed) {
        if (q.a.indexOf(k) >= 0) cls += ' right';
        else if (rec.p.indexOf(k) >= 0) cls += ' wrong';
      }
      return `<button class="${cls}" data-k="${k}" ${closed ? 'disabled' : ''}>
        <span class="k">${k}</span><span class="txt">${esc(txt)}</span>
      </button>`;
    }).join('');

    let verdict = '';
    if (closed) {
      verdict = `<div class="verdict ${rec.ok ? 'ok' : 'bad'}">${rec.ok ? '✓ 回答正确' : '✗ 回答错误'}　正确答案 ${q.a.split('').join('')}</div>`;
    }
    const ana = closed ? `
      <div class="ana">
        <div class="src">出处：${esc(q.src)}</div>
        <div class="txt">${esc(q.an)}</div>
      </div>` : '';

    let btns;
    const lastOne = st.pos + 1 >= list.length;
    if (!closed) {
      btns = `<div class="actions">
        <button class="btn ghost skip" id="btn-skip">${lastOne ? '这批做完了' : '跳过'}</button>
        <button class="btn primary" id="btn-submit" disabled>请选择答案</button>
      </div>`;
    } else {
      const faved = st.fav.indexOf(q.id) >= 0;
      btns = `<div class="actions">
        <button class="btn ghost" id="btn-fav">${faved ? '<span style="color:var(--accent)">★</span>' : '☆'}</button>
        <button class="btn primary" id="btn-next">${lastOne ? '这批做完了' : '下一题'}</button>
      </div>`;
    }

    el.innerHTML = `<div class="qwrap">${head}
      <div class="opts">${opts}</div>
      ${verdict}${ana}${btns}</div>`;

    el.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => onPick(q, b.dataset.k, b)));
    const sub = el.querySelector('#btn-submit');
    if (sub) sub.addEventListener('click', () => submit(q));
    const nx = el.querySelector('#btn-next');
    if (nx) nx.addEventListener('click', next);
    const sk = el.querySelector('#btn-skip');
    if (sk) sk.addEventListener('click', next);
    const fv = el.querySelector('#btn-fav');
    if (fv) fv.addEventListener('click', () => toggleFav(q.id));
  }

  /* ---- 简答 / 论述 速背卡 ---- */
  function cardRecite(q, rec, list) {
    const isEssay = q.kind === 'essay';
    const pageTag = isEssay
      ? `<span class="tag">${q.points.length} 个要点</span>`
      : `<span class="tag">${esc(q.page)}</span>`;
    const chTag = isEssay
      ? `<span class="sp"></span><span>${esc(q.group.split('  ')[0])}</span>`
      : `<span class="sp"></span><span>简答</span>`;

    const body = isEssay
      ? q.points.map(p => '<p>' + fmt(p) + '</p>').join('')
      : '<p>' + fmt(q.body) + '</p>';

    const shown = !!rec || (q._revealed === true);
    const answer = shown
      ? `<div class="ana recite"><div class="src">参考答案</div><div class="txt">${body}</div></div>`
      : '';

    let verdict = '';
    if (rec) {
      verdict = `<div class="verdict ${rec.ok ? 'ok' : 'bad'}">${rec.ok ? '✓ 已标记：记住了' : '✗ 已标记：还没记住'}</div>`;
    }

    let btns;
    if (!shown) {
      btns = `<div class="actions"><button class="btn primary" id="btn-reveal">显示答案</button></div>`;
    } else if (!rec) {
      btns = `<div class="actions">
        <button class="btn ghost" id="btn-nope">还没记住</button>
        <button class="btn primary" id="btn-yes">记住了</button>
      </div>`;
    } else {
      const faved = st.fav.indexOf(q.id) >= 0;
      btns = `<div class="actions">
        <button class="btn ghost" id="btn-fav">${faved ? '<span style="color:var(--accent)">★</span>' : '☆'}</button>
        <button class="btn primary" id="btn-next">${st.pos + 1 >= list.length ? '这批做完了' : '下一题'}</button>
      </div>`;
    }

    return `<div class="qwrap">
      <div class="bar"><i style="width:${(st.pos + 1) / list.length * 100}%"></i></div>
      <div class="qhead">
        <span class="idx">${st.pos + 1} / ${list.length}</span>
        ${pageTag}${chTag}
      </div>
      <div class="stem">${esc(q.s)}</div>
      ${verdict}${answer}${btns}</div>`;
  }

  function bindRecite(q, list) {
    const el = $('#screen-quiz');
    const rv = el.querySelector('#btn-reveal');
    if (rv) rv.addEventListener('click', () => { q._revealed = true; renderQuiz(); });
    const yes = el.querySelector('#btn-yes');
    if (yes) yes.addEventListener('click', () => markMem(q, true));
    const no = el.querySelector('#btn-nope');
    if (no) no.addEventListener('click', () => markMem(q, false));
    const nx = el.querySelector('#btn-next');
    if (nx) nx.addEventListener('click', next);
    const fv = el.querySelector('#btn-fav');
    if (fv) fv.addEventListener('click', () => toggleFav(q.id));
  }

  function markMem(q, ok) {
    st.mem[q.id] = { ok: ok, t: Date.now() };
    delete q._revealed;
    save();
    renderQuiz();
    if (!ok) toast('已记入待复习');
  }

  function onPick(q, k, btn) {
    if (st.ans[q.id]) return;
    if (q.t === 'single') {
      pend = [k];
      document.querySelectorAll('.opt').forEach(b =>
        b.classList.toggle('picked', b.dataset.k === k));
    } else {
      const i = pend.indexOf(k);
      if (i >= 0) pend.splice(i, 1); else pend.push(k);
      btn.classList.toggle('picked');
    }
    updateSubmit(q);
  }

  function updateSubmit(q) {
    const sub = $('#btn-submit');
    if (!sub) return;
    const n = pend.length;
    sub.disabled = n === 0;
    sub.textContent = n === 0 ? '请选择答案'
      : (q.t === 'multi' ? `提交答案（已选 ${n} 项）` : '提交答案');
  }

  function submit(q) {
    if (!pend.length) return;
    commit(q);
  }

  function commit(q) {
    const picked = pend.slice().sort();
    const right = q.a.split('').sort();
    const ok = picked.length === right.length && picked.every((k, i) => k === right[i]);
    st.ans[q.id] = { p: picked, ok: ok, t: Date.now() };
    save();
    renderQuiz();
    if (!ok) toast('已记入错题本');
  }

  function next() {
    const list = pool();
    if (st.pos + 1 >= list.length) {
      st.pos = 0;
      renderQuiz();
      toast('已回到第一题，继续加油');
      return;
    }
    st.pos++;
    renderQuiz();
    save();
    const m = $('main');
    if (m) m.scrollTop = 0;
  }

  function toggleFav(id) {
    const i = st.fav.indexOf(id);
    if (i >= 0) { st.fav.splice(i, 1); toast('已取消收藏'); }
    else { st.fav.push(id); toast('已收藏'); }
    save();
    if (st.exam && st.exam.on) renderExam(); else renderQuiz();
  }

  /* ================= 模拟考试 ================= */
  // 按章节平均抽取：轮流出题，章序随机，保证每章覆盖
  function pickBalanced(items, n) {
    const by = {};
    items.forEach(q => { (by[q.ch] = by[q.ch] || []).push(q); });
    Object.keys(by).forEach(k => { by[k] = rnd(by[k]); });
    const keys = rnd(Object.keys(by));
    const out = [];
    let round = 0;
    while (out.length < n && round < 200) {
      let added = false;
      for (const k of keys) {
        if (out.length >= n) break;
        if (by[k].length) { out.push(by[k].pop()); added = true; }
      }
      if (!added) break;
      round++;
    }
    return out;
  }

  const EXAM_N = { single: 25, multi: 10 };

  function startExam() {
    const singles = D.choice.filter(q => q.t === 'single');
    const multis = D.choice.filter(q => q.t === 'multi');
    const s1 = pickBalanced(singles, EXAM_N.single);
    const s2 = pickBalanced(multis, EXAM_N.multi);
    st.exam = {
      on: true,
      ids: s1.map(q => q.id).concat(s2.map(q => q.id)),
      ans: {},
      i: 0,
      t0: Date.now(),
      done: false
    };
    save();
    if (st.tab !== 'quiz') switchTab('quiz');
    renderExam();
  }

  function examList() { return st.exam.ids.map(id => byId[id]).filter(Boolean); }

  function renderExam() {
    const el = $('#screen-quiz');
    const ex = st.exam;
    if (!ex) { renderQuiz(); return; }
    const list = examList();

    if (ex.done) { renderExamResult(); return; }

    const q = list[ex.i];
    if (!q) { renderQuiz(); return; }
    const picked = ex.ans[q.id] || [];
    const multi = q.t === 'multi';

    const opts = ['A', 'B', 'C', 'D'].map(k => {
      if (!q.o[k]) return '';
      const on = picked.indexOf(k) >= 0 ? ' picked' : '';
      return `<button class="opt${on}" data-k="${k}"><span class="k">${k}</span><span class="txt">${esc(q.o[k])}</span></button>`;
    }).join('');

    const answered = Object.keys(ex.ans).length;
    el.innerHTML = `<div class="qwrap exam">
      <div class="exambar">
        <span class="ex-tag">⚡ 模拟测试</span>
        <span class="ex-time" id="ex-time">--:--</span>
        <span class="sp"></span>
        <button class="mini" id="ex-quit">退出</button>
      </div>
      <div class="bar"><i style="width:${(ex.i + 1) / list.length * 100}%"></i></div>
      <div class="qhead">
        <span class="idx">${ex.i + 1} / ${list.length}</span>
        <span class="tag ${multi ? 'multi' : ''}">${multi ? '多选' : '单选'}</span>
        <span class="sp"></span>
        <span class="ch">${esc(q.ch.split('  ')[0])}</span>
        <span>已答 ${answered}</span>
      </div>
      <div class="stem">${esc(q.s)}</div>
      <div class="opts">${opts}</div>
      <div class="actions">
        <button class="btn ghost" id="ex-prev" ${ex.i === 0 ? 'disabled' : ''}>上一题</button>
        ${ex.i + 1 < list.length
        ? '<button class="btn primary" id="ex-next">下一题</button>'
        : '<button class="btn primary" id="ex-finish">交卷</button>'}
      </div>
      <div class="actions">
        <button class="btn ghost wide" id="ex-submit">提前交卷（已答 ' + answered + '/' + list.length + '）</button>
      </div>
    </div>`;

    el.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.k;
      let cur = st.exam.ans[q.id] || [];
      if (multi) {
        const i = cur.indexOf(k);
        if (i >= 0) cur.splice(i, 1); else cur.push(k);
      } else {
        cur = [k];
      }
      st.exam.ans[q.id] = cur.slice().sort();
      save();
      renderExam();
    }));

    const g = id => el.querySelector('#' + id);
    if (g('ex-prev')) g('ex-prev').addEventListener('click', () => { st.exam.i--; renderExam(); });
    if (g('ex-next')) g('ex-next').addEventListener('click', () => { st.exam.i++; renderExam(); });
    if (g('ex-finish')) g('ex-finish').addEventListener('click', finishExam);
    if (g('ex-submit')) g('ex-submit').addEventListener('click', () => {
      const n = Object.keys(st.exam.ans).length;
      if (confirm(`还有 ${list.length - n} 道没答，确定交卷？`)) finishExam();
    });
    if (g('ex-quit')) g('ex-quit').addEventListener('click', () => {
      if (confirm('退出模拟测试？本次作答不保存。')) {
        st.exam = null; save(); renderQuiz();
      }
    });

    tickExam();
    const m = $('main'); if (m) m.scrollTop = 0;
  }

  let exTimer;
  function tickExam() {
    clearInterval(exTimer);
    const paint = () => {
      const t = $('#ex-time');
      if (!t || !st.exam || st.exam.done) { clearInterval(exTimer); return; }
      const s = Math.floor((Date.now() - st.exam.t0) / 1000);
      t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    };
    paint();
    exTimer = setInterval(paint, 1000);
  }

  function finishExam() {
    clearInterval(exTimer);
    const ex = st.exam, list = examList();
    let right = 0;
    const rows = list.map(q => {
      const picked = ex.ans[q.id] || [];
      const correct = q.a.split('').sort();
      const ok = picked.length === correct.length && picked.every((k, i) => k === correct[i]);
      if (ok) right++;
      // 写入正式记录
      st.ans[q.id] = { p: picked, ok: ok, t: Date.now() };
      return { q: q, picked: picked, ok: ok };
    });
    ex.result = { right: right, total: list.length, used: Math.floor((Date.now() - ex.t0) / 1000) };
    ex.done = true;
    save();
    renderExamResult();
  }

  function renderExamResult() {
    clearInterval(exTimer);
    const el = $('#screen-quiz');
    const ex = st.exam;
    const r = ex.result || { right: 0, total: ex.ids.length, used: 0 };
    const list = examList();
    const pct = r.total ? Math.round(r.right / r.total * 100) : 0;

    // 按章节统计
    const byCh = {};
    list.forEach(q => {
      const k = (q.ch || '').split('  ')[0] || '其他';
      byCh[k] = byCh[k] || { n: 0, ok: 0 };
      byCh[k].n++;
      const rec = st.ans[q.id];
      if (rec && rec.ok) byCh[k].ok++;
    });
    const chRows = Object.keys(byCh).map(k => {
      const v = byCh[k];
      const p = Math.round(v.ok / v.n * 100);
      return `<div class="chrow"><span class="cn">${esc(k)}</span>
        <span class="cbar"><i style="width:${p}%"></i></span>
        <span class="cv">${v.ok}/${v.n}</span></div>`;
    }).join('');

    const review = list.map((q, i) => {
      const rec = st.ans[q.id] || { p: [], ok: false };
      const mine = rec.p.length ? rec.p.join('') : '未答';
      return `<details class="qa">
        <summary>
          <span class="badge" style="color:${rec.ok ? 'var(--ok)' : 'var(--bad)'};border-color:currentColor">${rec.ok ? '✓' : '✗'}</span>
          <span class="q">${i + 1}. ${esc(q.s)}</span>
        </summary>
        <div class="body">
          <p><b>你的答案</b>：${esc(mine)}　<b>正确答案</b>：${esc(q.a.split('').join(''))}</p>
          <p class="rsrc">出处：${esc(q.src)}</p>
          <p>${esc(q.an)}</p>
        </div>
      </details>`;
    }).join('');

    el.innerHTML = `<div class="qwrap">
      <div class="result">
        <div class="score ${pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'bad'}">${pct}<span>%</span></div>
        <div class="sub">答对 ${r.right} / ${r.total} 题　用时 ${Math.floor(r.used / 60)} 分 ${r.used % 60} 秒</div>
      </div>
      <div class="grp">各章正确率</div>
      <div class="chart">${chRows}</div>
      <div class="grp">逐题回顾</div>
      ${review}
      <div class="actions" style="margin-top:18px">
        <button class="btn" id="ex-close">结束</button>
        <button class="btn primary" id="ex-again">再来一套</button>
      </div>
    </div>`;

    const el2 = el.querySelector('#ex-close');
    if (el2) el2.addEventListener('click', () => { st.exam = null; save(); renderQuiz(); });
    const el3 = el.querySelector('#ex-again');
    if (el3) el3.addEventListener('click', startExam);
    const m = $('main'); if (m) m.scrollTop = 0;
  }

  /* ---------------- 渲染：简答清单 ---------------- */
  function renderShort() {
    const el = $('#screen-short');
    el.innerHTML = '<div class="hint">共 ' + D.short.length + ' 条必背知识点，点击展开答案。页码为教材页码。</div>' +
      D.short.map((s, i) => `
        <details class="qa">
          <summary><span class="badge">${esc(s.page)}</span><span class="q">${esc(s.title)}</span></summary>
          <div class="body">${fmt(s.body)}</div>
        </details>`).join('');
  }

  /* ---------------- 渲染：论述清单 ---------------- */
  function renderEssay() {
    const el = $('#screen-essay');
    const byGroup = {};
    D.essay.forEach(e => {
      const g = e.group.split('  ')[0];
      (byGroup[g] = byGroup[g] || []).push(e);
    });
    let html = '<div class="hint">共 ' + D.essay.length + ' 道论述题，按章节分组。点击展开要点。</div>';
    Object.keys(byGroup).forEach(g => {
      html += `<div class="grp">${esc(g)}</div>`;
      byGroup[g].forEach(e => {
        html += `<details class="qa">
          <summary><span class="badge">${e.points.length}点</span><span class="q">${esc(e.q)}</span></summary>
          <div class="body">${e.points.map(p => '<p>' + fmt(p) + '</p>').join('')}</div>
        </details>`;
      });
    });
    el.innerHTML = html;
  }

  /* ---------------- 渲染：我的 ---------------- */
  function renderMe() {
    const s = stat();
    const el = $('#screen-me');
    const A = statAll();
    const bar = (b) => {
      const r = b.done ? Math.round(b.ok / b.done * 100) : 0;
      const w = b.done ? r : 0;
      const cls = !b.done ? '' : (r >= 80 ? 'good' : r >= 60 ? 'mid' : 'bad');
      const col = !b.done ? 'var(--line2)' : (r >= 80 ? 'var(--ok)' : r >= 60 ? 'var(--warn)' : 'var(--bad)');
      return `<div class="chrow">
        <span class="cn">${b.label}</span>
        <span class="cbar"><i style="width:${w}%;background:${col}"></i></span>
        <span class="cv">${b.done ? b.ok + '/' + b.done : '—'}</span>
        <span class="cv ${cls}" style="flex:0 0 40px">${b.done ? r + '%' : '未做'}</span>
      </div>`;
    };
    const chKeys = Object.keys(A.ch);
    const chRows = chKeys.map(k => {
      const b = A.ch[k];
      const r = b.done ? Math.round(b.ok / b.done * 100) : 0;
      const col = !b.done ? 'var(--line2)' : (r >= 80 ? 'var(--ok)' : r >= 60 ? 'var(--warn)' : 'var(--bad)');
      return `<div class="chrow">
        <span class="cn">${esc(k)}</span>
        <span class="cbar"><i style="width:${b.done ? r : 0}%;background:${col}"></i></span>
        <span class="cv">${b.done ? b.ok + '/' + b.done : '—'}</span>
        <span class="cv" style="flex:0 0 40px">${b.done ? r + '%' : '未做'}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="stats">
        <div><b>${A.done}</b><span>累计作答 / ${A.total}</span></div>
        <div><b>${A.rate}%</b><span>总正确率</span></div>
        <div><b>${A.wrongN}</b><span>待复习</span></div>
      </div>
      <div class="card">
        <div class="cardh">各题型正确率</div>
        <div class="chart">${bar(A.by.single)}${bar(A.by.multi)}${bar(A.by.short)}${bar(A.by.essay)}</div>
      </div>
      <div class="card">
        <div class="cardh" id="ch-toggle">各章正确率<span class="mini" id="ch-tog">展开</span></div>
        <div class="chart" id="ch-chart" hidden>${chRows}</div>
      </div>
      <div class="row" data-act="exam"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg></span>
        <span class="r-main">模拟测试<span class="r-sub">随机抽 25 单选 + 10 多选，各章平均</span></span>
        <span class="r-val">开始 ›</span></div>
      <div class="row" data-act="wrong"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span>
        <span class="r-main">错题本<span class="r-sub">做错的题 + 没记住的简答论述</span></span>
        <span class="r-val">${A.wrongN} 题 ›</span></div>
      <div class="row" data-act="fav"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 4l2.5 5.2 5.5.8-4 3.9 1 5.6L12 16.8 6.9 19.5l1-5.6-4-3.9 5.5-.8z"/></svg></span>
        <span class="r-main">我的收藏<span class="r-sub">标记待复习的题</span></span>
        <span class="r-val">${st.fav.length} 题 ›</span></div>
      <div class="row" data-act="dm"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4.5L21 20H3z"/><path d="M12 10.5v4M12 17.2v.2"/></svg></span>
        <span class="r-main">精简版未收录<span class="r-sub">老师发的文档里删掉的 20 道题</span></span>
        <span class="r-val">${D.choice.filter(q => q.dm).length} 题 ›</span></div>
      <div class="row" data-act="mem"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg></span>
        <span class="r-main">简答 / 论述 背诵<span class="r-sub">已背 ${s.memOk} / ${s.memAll}，未记住的单独复背</span></span>
        <span class="r-val">›</span></div>
      <div class="row" data-act="reset"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 1 2.6 5.9"/><path d="M4 12V7M4 12h5"/></svg></span>
        <span class="r-main">清空所有记录<span class="r-sub">做题进度与收藏都会删除</span></span>
        <span class="r-val">›</span></div>
      <div class="hint" style="margin-top:22px;text-align:center">
        ${esc(D.meta.title)}<br>
        选择题 ${D.meta.counts.choice} · 简答 ${D.meta.counts.short} · 论述 ${D.meta.counts.essay}
      </div>`;

    const tog = el.querySelector('#ch-tog');
    const chart = el.querySelector('#ch-chart');
    if (tog) tog.addEventListener('click', () => {
      chart.hidden = !chart.hidden;
      tog.innerText = chart.hidden ? '展开' : '收起';
    });

    el.querySelectorAll('.row').forEach(r => {
      r.addEventListener('click', () => {
        const a = r.dataset.act;
        if (a === 'exam') startExam();
        else if (a === 'wrong') gotoQuiz('wrong', 'choice');
        else if (a === 'fav') gotoQuiz('fav', 'all');
        else if (a === 'dm') gotoQuiz('dm', 'choice');
        else if (a === 'mem') gotoQuiz('wrong', 'all');
        else if (a === 'reset') {
          if (confirm('确定清空所有做题记录和收藏？')) {
            st.ans = {}; st.mem = {}; st.fav = []; st.pos = 0; st.exam = null;
            localStorage.removeItem(LSKEY);
            renderAll();
            toast('已清空');
          }
        }
      });
    });
  }

  function gotoQuiz(mode, type) {
    st.filter.mode = mode;
    st.filter.ch = 'all';
    st.filter.type = type || 'all';
    st.pos = 0;
    switchTab('quiz');
    renderQuiz();
  }

  /* ---------------- 筛选面板 ---------------- */
  function openFilter() {
    const m = $('#sheet-mask');
    const s = $('#sheet-body');
    const f = st.filter;
    const counts = {};
    D.choice.forEach(q => { counts[q.ch] = (counts[q.ch] || 0) + 1; });

    s.innerHTML = `
      <h3>筛选范围</h3>
      <div class="grp" style="margin-top:0">题型</div>
      <div class="chips" id="type-chips">
        <button class="chip ${f.type === 'all' ? 'on' : ''}" data-t="all">全部<span class="n">${ALL_ITEMS.length}</span></button>
        <button class="chip ${f.type === 'choice' ? 'on' : ''}" data-t="choice">选择题<span class="n">${D.choice.length}</span></button>
        <button class="chip ${f.type === 'short' ? 'on' : ''}" data-t="short">简答<span class="n">${SHORT_ITEMS.length}</span></button>
        <button class="chip ${f.type === 'essay' ? 'on' : ''}" data-t="essay">论述<span class="n">${ESSAY_ITEMS.length}</span></button>
      </div>
      <div class="grp">章节</div>
      <div class="chips" id="ch-chips">
        <button class="chip ${f.ch === 'all' ? 'on' : ''}" data-ch="all">全部<span class="n">${D.choice.length}</span></button>
        ${ALL_CH.map(c => `<button class="chip ${f.ch === c ? 'on' : ''}" data-ch="${esc(c)}">${esc(c.split('  ')[0])}<span class="n">${counts[c] || 0}</span></button>`).join('')}
      </div>
      <div class="grp">状态</div>
      <div class="chips" id="mode-chips">
        <button class="chip ${f.mode === 'all' ? 'on' : ''}" data-m="all">全部</button>
        <button class="chip ${f.mode === 'todo' ? 'on' : ''}" data-m="todo">未做过 / 还没背</button>
        <button class="chip ${f.mode === 'wrong' ? 'on' : ''}" data-m="wrong">做错 / 没记住</button>
        <button class="chip ${f.mode === 'fav' ? 'on' : ''}" data-m="fav">收藏</button>
        <button class="chip ${f.mode === 'dm' ? 'on' : ''}" data-m="dm">精简版未收录</button>
      </div>
      <div class="actions" style="margin-top:18px">
        <button class="btn" id="f-cancel">取消</button>
        <button class="btn primary" id="f-ok">应用</button>
      </div>`;

    let ch = f.ch, mode = f.mode, type = f.type;
    s.querySelectorAll('#type-chips .chip').forEach(b => b.addEventListener('click', () => {
      type = b.dataset.t;
      s.querySelectorAll('#type-chips .chip').forEach(x => x.classList.toggle('on', x === b));
    }));
    s.querySelectorAll('#ch-chips .chip').forEach(b => b.addEventListener('click', () => {
      ch = b.dataset.ch;
      s.querySelectorAll('#ch-chips .chip').forEach(x => x.classList.toggle('on', x === b));
    }));
    s.querySelectorAll('#mode-chips .chip').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.m;
      s.querySelectorAll('#mode-chips .chip').forEach(x => x.classList.toggle('on', x === b));
    }));
    s.querySelector('#f-cancel').addEventListener('click', closeFilter);
    s.querySelector('#f-ok').addEventListener('click', () => {
      st.filter.ch = ch; st.filter.mode = mode; st.filter.type = type; st.pos = 0;
      save(); closeFilter(); renderQuiz(); switchTab('quiz');
      const n = pool().length;
      toast(n ? `共 ${n} 题` : '该条件下没有题目');
    });
    m.classList.add('on');
  }
  function closeFilter() { $('#sheet-mask').classList.remove('on'); }

  /* ---------------- Tab ---------------- */
  function switchTab(t) {
    st.tab = t;
    $$('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    $$('.screen').forEach(s => s.classList.remove('on'));
    const el = $('#screen-' + t);
    if (el) el.classList.add('on');
    if (t === 'quiz') renderQuiz();
    else if (t === 'short') renderShort();
    else if (t === 'essay') renderEssay();
    else if (t === 'me') renderMe();
    const m = $('main');
    if (m) m.scrollTop = 0;
  }

  function renderAll() { switchTab(st.tab || 'quiz'); }

  /* ---------------- toast ---------------- */
  let tTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(tTimer);
    tTimer = setTimeout(() => t.classList.remove('on'), 1500);
  }

  /* ---------------- 手势：左右滑切题 ---------------- */
  function bindSwipe() {
    const m = $('main');
    let x0 = 0, y0 = 0, t0 = 0, tracking = false;
    m.addEventListener('touchstart', e => {
      if (st.tab !== 'quiz' || e.touches.length !== 1) { tracking = false; return; }
      if (st.exam && st.exam.on) { tracking = false; return; }
      if (e.target.closest('details,.sheet,.chips')) { tracking = false; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
      t0 = Date.now(); tracking = true;
    }, { passive: true });
    m.addEventListener('touchend', e => {
      if (!tracking) return;
      tracking = false;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      if (Date.now() - t0 > 700) return;
      if (Math.abs(dx) < 62 || Math.abs(dy) > 46) return;
      const list = pool();
      if (dx < 0) { if (st.pos + 1 < list.length) { st.pos++; renderQuiz(); } }
      else { if (st.pos > 0) { st.pos--; renderQuiz(); } }
    }, { passive: true });
  }

  /* ---------------- 按钮绑定 ---------------- */
  function bindChrome() {
    $$('.tabbar button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.t)));
    $('#btn-filter').addEventListener('click', openFilter);
    const sh = $('#btn-shuffle');
    if (sh) sh.addEventListener('click', reshuffle);
    const ex = $('#btn-exam');
    if (ex) ex.addEventListener('click', startExam);
    $('#sheet-mask').addEventListener('click', e => { if (e.target.id === 'sheet-mask') closeFilter(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindChrome();
    bindSwipe();
    // 首次启动把随机 seed 立刻落盘，保证乱序在刷新后保持
    saveNow();
    // 上次模考没做完：问一次
    if (st.exam && st.exam.on && !st.exam.done) {
      const ok = confirm('上次有一套模拟测试没做完，继续？\n（选取消则放弃这次）');
      if (!ok) { st.exam = null; save(); }
    }
    renderAll();
  });

  // 离线
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
