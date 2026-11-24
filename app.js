/* 期末冲刺 · 刷题 */ 
(function () {
  'use strict';

  const D = window.BANK;
  const LSKEY = 'szk_v1';
  const ALL_CH = D.chapters.map(c => c.name);

  /* ---------------- 状态 ---------------- */
  let st = {
    ans: {},          // id -> {p:[..], ok:bool, t:ts}
    fav: [],          // [id]
    filter: { ch: 'all', mode: 'all' },  // mode: all|todo|wrong|fav|dm
    pos: 0,           // 当前题在列表中的位置
    tab: 'quiz'
  };
  try {
    const raw = localStorage.getItem(LSKEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        st.ans = o.ans || {};
        st.fav = o.fav || [];
        st.filter = o.filter || st.filter;
      }
    }
  } catch (e) {}

  const save = debounce(() => {
    try { localStorage.setItem(LSKEY, JSON.stringify({ ans: st.ans, fav: st.fav, filter: st.filter })); } catch (e) {}
  }, 220);

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------------- 数据加工 ---------------- */
  const byId = {};
  D.choice.forEach(q => { byId[q.id] = q; });

  function wrongIds() {
    return Object.keys(st.ans).filter(id => st.ans[id] && st.ans[id].ok === false).map(Number);
  }

  function pool() {
    const f = st.filter;
    let arr = D.choice;
    if (f.ch !== 'all') arr = arr.filter(q => q.ch === f.ch);
    if (f.mode === 'todo') arr = arr.filter(q => !st.ans[q.id]);
    else if (f.mode === 'wrong') arr = arr.filter(q => st.ans[q.id] && st.ans[q.id].ok === false);
    else if (f.mode === 'fav') arr = arr.filter(q => st.fav.indexOf(q.id) >= 0);
    else if (f.mode === 'dm') arr = arr.filter(q => q.dm);
    return arr;
  }

  /* ---------------- 统计 ---------------- */
  function stat() {
    const ids = Object.keys(st.ans);
    const done = ids.length;
    const right = ids.filter(id => st.ans[id].ok).length;
    return {
      done: done,
      total: D.choice.length,
      right: right,
      wrong: done - right,
      rate: done ? Math.round(right / done * 100) : 0
    };
  }

  /* ---------------- 渲染：刷题 ---------------- */
  let pend = [];      // 多选暂存

  function renderQuiz() {
    const list = pool();
    const el = $('#screen-quiz');
    if (st.pos >= list.length) st.pos = Math.max(0, list.length - 1);

    if (!list.length) {
      el.innerHTML = '<div class="empty"><div class="big">✓</div>这个筛选条件下没有题目<br><span style="font-size:13px">换个条件试试</span></div>';
      return;
    }

    const q = list[st.pos];
    const rec = st.ans[q.id];
    const closed = !!rec;
    pend = [];

    const s = stat();
    const head = `
      <div class="bar"><i style="width:${(st.pos + 1) / list.length * 100}%"></i></div>
      <div class="qhead">
        <span class="idx">${st.pos + 1} / ${list.length}</span>
        <span class="tag ${q.t === 'multi' ? 'multi' : ''}">${q.t === 'multi' ? '多选' : '单选'}</span>
        ${q.dm ? '<span class="tag" style="color:var(--warn);border-color:var(--warn)">老师精简版未收录</span>' : ''}
        <span class="sp"></span>
        <span>${esc(q.ch.split('  ')[0])}</span>
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
      const good = rec.ok;
      verdict = `<div class="verdict ${good ? 'ok' : 'bad'}">${good ? '✓ 回答正确' : '✗ 回答错误'}　正确答案 ${q.a.split('').join('')}</div>`;
    }

    const ana = closed ? `
      <div class="ana">
        <div class="src">出处：${esc(q.src)}</div>
        <div class="txt">${esc(q.an)}</div>
      </div>` : '';

    let btns;
    if (!closed) {
      btns = `<div class="actions">
        <button class="btn primary" id="btn-submit" disabled>请选择答案</button>
      </div>`;
    } else {
      const faved = st.fav.indexOf(q.id) >= 0;
      btns = `<div class="actions">
        <button class="btn ghost" id="btn-fav">${faved ? '<span style="color:var(--accent)">★</span>' : '☆'}</button>
        <button class="btn primary" id="btn-next">${st.pos + 1 >= list.length ? '这批做完了' : '下一题'}</button>
      </div>`;
    }

    el.innerHTML = `<div class="qwrap">${head}
      <div class="opts">${opts}</div>
      ${verdict}${ana}${btns}</div>`;

    // 交互
    el.querySelectorAll('.opt').forEach(b => {
      b.addEventListener('click', () => onPick(q, b.dataset.k, b));
    });
    const sub = el.querySelector('#btn-submit');
    if (sub) sub.addEventListener('click', () => submit(q));
    const nx = el.querySelector('#btn-next');
    if (nx) nx.addEventListener('click', () => next());
    const fv = el.querySelector('#btn-fav');
    if (fv) fv.addEventListener('click', () => toggleFav(q.id));
  }

  function onPick(q, k, btn) {
    if (st.ans[q.id]) return;
    if (q.t === 'single') {
      // 单选：只选中，等用户自己点提交
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
    const m = $('main');
    if (m) m.scrollTop = 0;
  }

  function toggleFav(id) {
    const i = st.fav.indexOf(id);
    if (i >= 0) { st.fav.splice(i, 1); toast('已取消收藏'); }
    else { st.fav.push(id); toast('已收藏'); }
    save();
    renderQuiz();
  }

  /* ---------------- 渲染：简答 ---------------- */
  function renderShort() {
    const el = $('#screen-short');
    el.innerHTML = '<div class="hint">共 ' + D.short.length + ' 条必背知识点，点击展开答案。页码为教材页码。</div>' +
      D.short.map(s => `
        <details class="qa">
          <summary><span class="badge">${esc(s.page)}</span><span class="q">${esc(s.title)}</span></summary>
          <div class="body">${fmt(s.body)}</div>
        </details>`).join('');
  }

  /* ---------------- 渲染：论述 ---------------- */
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

  function fmt(t) {
    // 段落内的编号保持原样；转义后换行保留
    return esc(t).replace(/\n/g, '<br>');
  }

  /* ---------------- 渲染：我的 ---------------- */
  function renderMe() {
    const s = stat();
    const el = $('#screen-me');
    el.innerHTML = `
      <div class="stats">
        <div><b>${s.done}</b><span>已做 / ${s.total}</span></div>
        <div><b>${s.rate}%</b><span>正确率</span></div>
        <div><b>${s.wrong}</b><span>错题</span></div>
      </div>
      <div class="row" data-act="wrong"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span>
        <span class="r-main">错题本<span class="r-sub">重做做错的题</span></span>
        <span class="r-val">${s.wrong} 题 ›</span></div>
      <div class="row" data-act="fav"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 4l2.5 5.2 5.5.8-4 3.9 1 5.6L12 16.8 6.9 19.5l1-5.6-4-3.9 5.5-.8z"/></svg></span>
        <span class="r-main">我的收藏<span class="r-sub">标记待复习的题</span></span>
        <span class="r-val">${st.fav.length} 题 ›</span></div>
      <div class="row" data-act="dm"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4.5L21 20H3z"/><path d="M12 10.5v4M12 17.2v.2"/></svg></span>
        <span class="r-main">精简版未收录<span class="r-sub">老师发的文档里删掉的 20 道题</span></span>
        <span class="r-val">${D.choice.filter(q => q.dm).length} 题 ›</span></div>
      <div class="row" data-act="reset"><span class="r-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 1 2.6 5.9"/><path d="M4 12V7M4 12h5"/></svg></span>
        <span class="r-main">清空所有记录<span class="r-sub">做题进度与收藏都会删除</span></span>
        <span class="r-val">›</span></div>
      <div class="hint" style="margin-top:22px;text-align:center">
        ${esc(D.meta.title)}<br>
        选择题 ${D.meta.counts.choice} · 简答 ${D.meta.counts.short} · 论述 ${D.meta.counts.essay}
      </div>`;

    el.querySelectorAll('.row').forEach(r => {
      r.addEventListener('click', () => {
        const a = r.dataset.act;
        if (a === 'wrong') gotoQuiz('wrong');
        else if (a === 'fav') gotoQuiz('fav');
        else if (a === 'dm') gotoQuiz('dm');
        else if (a === 'reset') {
          if (confirm('确定清空所有做题记录和收藏？')) {
            st.ans = {}; st.fav = []; st.pos = 0;
            localStorage.removeItem(LSKEY);
            renderAll();
            toast('已清空');
          }
        }
      });
    });
  }

  function gotoQuiz(mode) {
    st.filter.mode = mode;
    st.filter.ch = 'all';
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
      <div class="grp" style="margin-top:0">章节</div>
      <div class="chips" id="ch-chips">
        <button class="chip ${f.ch === 'all' ? 'on' : ''}" data-ch="all">全部<span class="n">${D.choice.length}</span></button>
        ${ALL_CH.map(c => `<button class="chip ${f.ch === c ? 'on' : ''}" data-ch="${esc(c)}">${esc(c.split('  ')[0])}<span class="n">${counts[c] || 0}</span></button>`).join('')}
      </div>
      <div class="grp">状态</div>
      <div class="chips" id="mode-chips">
        <button class="chip ${f.mode === 'all' ? 'on' : ''}" data-m="all">全部</button>
        <button class="chip ${f.mode === 'todo' ? 'on' : ''}" data-m="todo">未做过</button>
        <button class="chip ${f.mode === 'wrong' ? 'on' : ''}" data-m="wrong">错题</button>
        <button class="chip ${f.mode === 'fav' ? 'on' : ''}" data-m="fav">收藏</button>
        <button class="chip ${f.mode === 'dm' ? 'on' : ''}" data-m="dm">精简版未收录</button>
      </div>
      <div class="actions" style="margin-top:18px">
        <button class="btn" id="f-cancel">取消</button>
        <button class="btn primary" id="f-ok">应用</button>
      </div>`;

    let ch = f.ch, mode = f.mode;
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
      st.filter.ch = ch; st.filter.mode = mode; st.pos = 0;
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

  function renderAll() {
    switchTab(st.tab || 'quiz');
  }

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
    $('#sheet-mask').addEventListener('click', e => { if (e.target.id === 'sheet-mask') closeFilter(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindChrome();
    bindSwipe();
    renderAll();
  });

  // 离线
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
