/* ===== 橘猫三消 · 主逻辑 =====
   约束：ES2017 基线（禁 ?. / ?? / 对象展开 / flat / replaceAll）；
        零网络请求；交互统一 data-action + bindActions 事件委托；
        变量与函数参数 snake_case。 */

(function () {
  'use strict';

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }

  function fmt_num(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // 检测 flex gap 支持（Chrome 61 不支持），失败时挂 .no-flex-gap 走 margin 回退
  function detect_flex_gap() {
    var probe = document.createElement('div');
    probe.style.display = 'flex';
    probe.style.flexGap = '1px';
    var supported = probe.style.flexGap === '1px';
    if (supported) {
      probe.style.gap = '1px';
      supported = probe.style.gap === '1px';
    }
    if (!supported) { document.documentElement.classList.add('no-flex-gap'); }
  }

  // ---------- 状态 ----------
  var state = {
    current_level: 1,
    high_score: 0,
    stamina: 5,
    sound_on: true,
    score: 0,
    steps: 0,
    goal: 0,
    goal_done: 0,
    board: [],          // 一维数组，长度 cols * rows，元素为类型 index 或 -1
    selected: -1,       // 选中格子 index
    busy: false,        // 动画期间锁操作
    active_prop: '',    // 当前激活道具
    swap_source: -1,    // 换位道具第一格
    props: { hammer: 0, swap: 0, mint: 0 },
    stars: {}           // 关卡 -> 星级
  };

  var STORAGE_KEY = 'cat_ma…e_v1';

  function load_progress() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) { return; }
      var data = JSON.parse(raw);
      if (data && typeof data.high_score === 'number') { state.high_score = data.high_score; }
      if (data && typeof data.current_level === 'number') { state.current_level = data.current_level; }
      if (data && data.stars) { state.stars = data.stars; }
    } catch (err) {
      // 存储不可用时静默降级
    }
  }

  function save_progress() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        high_score: state.high_score,
        current_level: state.current_level,
        stars: state.stars
      }));
    } catch (err) {
      // 忽略
    }
  }

  // ---------- 路由 ----------
  var ROUTES = { '/': 'page-home', '/game': 'page-game' };

  function current_route() {
    var h = window.location.hash || '#/';
    return h.slice(1);
  }

  function go(route) {
    if (window.location.hash === '#' + route) { show_route(); }
    else { window.location.hash = '#' + route; }
  }

  function show_route() {
    var route = current_route();
    var page_id = ROUTES[route] || 'page-home';
    var pages = document.querySelectorAll('.page');
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (p.id === page_id) { p.classList.add('active'); }
      else { p.classList.remove('active'); }
    }
    if (page_id === 'page-home') { render_home(); }
    if (page_id === 'page-game') {
      if (state.board.length === 0) { start_level(state.current_level); }
      else { layout_board(); }
    }
  }

  // ---------- 猫脸 SVG ----------
  function cat_svg(type_index) {
    var t = CAT_TYPES[type_index];
    return '<svg class="tile__face" viewBox="0 0 100 100" aria-hidden="true">' +
      '<polygon points="26,36 34,10 48,28" fill="' + t.color + '"/>' +
      '<polygon points="74,36 66,10 52,28" fill="' + t.color + '"/>' +
      '<circle cx="50" cy="58" r="34" fill="' + t.color + '"/>' +
      '<path d="M40 30 l3 8 M50 27 l0 9 M60 30 l-3 8" stroke="' + t.face + '" stroke-width="3" stroke-linecap="round" fill="none"/>' +
      '<circle cx="38" cy="55" r="4" fill="#3D2E1F"/>' +
      '<circle cx="62" cy="55" r="4" fill="#3D2E1F"/>' +
      '<path d="M46 66 l-4 4 h8 z" fill="#3D2E1F"/>' +
      '<path d="M42 72 q4 5 8 0 q4 5 8 0" stroke="#3D2E1F" stroke-width="2.5" stroke-linecap="round" fill="none"/>' +
      '<circle cx="30" cy="64" r="5" fill="#FF8CA3" opacity="0.6"/>' +
      '<circle cx="70" cy="64" r="5" fill="#FF8CA3" opacity="0.6"/>' +
      '</svg>';
  }

  // ---------- 棋盘 ----------
  function idx(col, row) { return row * BOARD_COLS + col; }
  function col_of(i) { return i % BOARD_COLS; }
  function row_of(i) { return Math.floor(i / BOARD_COLS); }

  function rand_type() { return Math.floor(Math.random() * CAT_TYPES.length); }

  function make_board() {
    var cells = [];
    for (var i = 0; i < BOARD_COLS * BOARD_ROWS; i++) { cells.push(rand_type()); }
    // 消除初始三连，保证开局无自动匹配
    var guard = 0;
    while (find_matches(cells).length > 0 && guard < 200) {
      var ms = find_matches(cells);
      for (var j = 0; j < ms.length; j++) { cells[ms[j]] = rand_type(); }
      guard++;
    }
    return cells;
  }

  // 返回所有处于三连+ 的格子 index
  function find_matches(cells) {
    var mark = {};
    var c, r, i, run;
    // 横向
    for (r = 0; r < BOARD_ROWS; r++) {
      run = 1;
      for (c = 1; c <= BOARD_COLS; c++) {
        var cur = c < BOARD_COLS ? cells[idx(c, r)] : -2;
        var prev = cells[idx(c - 1, r)];
        if (c < BOARD_COLS && cur === prev && cur >= 0) { run++; }
        else {
          if (run >= 3 && prev >= 0) {
            for (i = c - run; i < c; i++) { mark[idx(i, r)] = true; }
          }
          run = 1;
        }
      }
    }
    // 纵向
    for (c = 0; c < BOARD_COLS; c++) {
      run = 1;
      for (r = 1; r <= BOARD_ROWS; r++) {
        var curv = r < BOARD_ROWS ? cells[idx(c, r)] : -2;
        var prevv = cells[idx(c, r - 1)];
        if (r < BOARD_ROWS && curv === prevv && curv >= 0) { run++; }
        else {
          if (run >= 3 && prevv >= 0) {
            for (i = r - run; i < r; i++) { mark[idx(c, i)] = true; }
          }
          run = 1;
        }
      }
    }
    var out = [];
    for (var k in mark) { if (mark.hasOwnProperty(k)) { out.push(Number(k)); } }
    return out;
  }

  function are_adjacent(a, b) {
    return Math.abs(col_of(a) - col_of(b)) + Math.abs(row_of(a) - row_of(b)) === 1;
  }

  // ---------- 渲染 ----------
  function render_home() {
    $('home-level-label').textContent = '第 ' + state.current_level + ' 关';
    $('home-stamina').textContent = state.stamina + '/5';
    $('home-high-score').textContent = fmt_num(state.high_score);
    $('sound-icon').textContent = state.sound_on ? '🔊' : '🔇';
  }

  function render_levels() {
    var grid = $('level-grid');
    var html = '';
    for (var i = 0; i < LEVELS.length; i++) {
      var lv = LEVELS[i];
      var locked = lv.level > state.current_level;
      var star = state.stars[lv.level] || 0;
      var star_html = star > 0 ? '★'.repeat(star) : (locked ? '🔒' : '—');
      html += '<button class="level-item' + (locked ? ' level-item--locked' : '') + '" type="button" ' +
        'data-action="pick-level" data-level="' + lv.level + '"' + (locked ? ' disabled' : '') + '>' +
        '<span class="level-item__no">' + lv.level + '</span>' +
        '<span class="level-item__star">' + star_html + '</span>' +
        '</button>';
    }
    grid.innerHTML = html;
  }

  function layout_board() {
    var board = $('board');
    // 测量外层容器（board-wrap 左右 padding 各 12px），避免依赖 board 自身被写死的内联宽度
    var w = board.parentNode.clientWidth - 24;
    if (w <= 0) {
      // 页面尚未显示（display:none 时宽度为 0），等激活后重试，防止格子被锁成 0px
      window.setTimeout(layout_board, 60);
      return;
    }
    var tile = Math.floor(w / BOARD_COLS);
    board.style.width = (tile * BOARD_COLS) + 'px';
    var tiles = board.children;
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].style.width = tile + 'px';
      tiles[i].style.height = tile + 'px';
    }
  }

  function render_board() {
    var board = $('board');
    var html = '';
    for (var i = 0; i < state.board.length; i++) {
      var t = state.board[i];
      if (t < 0) {
        html += '<div class="tile" data-index="' + i + '"></div>';
      } else {
        html += '<div class="tile" data-index="' + i + '" data-action="tap-tile">' + cat_svg(t) + '</div>';
      }
    }
    board.innerHTML = html;
    layout_board();
  }

  function tile_el(i) { return $('board').querySelector('[data-index="' + i + '"]'); }

  function render_game_hud() {
    var cfg = get_level_config(state.current_level);
    $('game-level-label').textContent = '第 ' + state.current_level + ' 关';
    $('game-goal-text').textContent = cfg.target_text;
    $('game-goal-progress').textContent = state.goal_done + '/' + state.goal;
    $('game-steps').textContent = state.steps;
    $('game-score').textContent = fmt_num(state.score);
    var pct = state.goal > 0 ? Math.min(100, Math.round(state.goal_done / state.goal * 100)) : 0;
    $('goal-bar').style.width = pct + '%';
    $('prop-hammer').textContent = state.props.hammer;
    $('prop-swap').textContent = state.props.swap;
    $('prop-mint').textContent = state.props.mint;
    var prop_btns = document.querySelectorAll('.prop');
    for (var i = 0; i < prop_btns.length; i++) {
      var key = prop_btns[i].getAttribute('data-prop');
      var active = state.active_prop === key;
      if (active) { prop_btns[i].classList.add('prop--active'); }
      else { prop_btns[i].classList.remove('prop--active'); }
      if (state.props[key] <= 0) { prop_btns[i].classList.add('prop--disabled'); }
      else { prop_btns[i].classList.remove('prop--disabled'); }
    }
  }

  function get_level_config(level_no) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].level === level_no) { return LEVELS[i]; }
    }
    return LEVELS[LEVELS.length - 1];
  }

  // ---------- 关卡流程 ----------
  function start_level(level_no) {
    var cfg = get_level_config(level_no);
    state.current_level = level_no;
    state.score = 0;
    state.steps = cfg.steps;
    state.goal = cfg.goal;
    state.goal_done = 0;
    state.selected = -1;
    state.active_prop = '';
    state.swap_source = -1;
    state.busy = false;
    state.props = {
      hammer: PROP_INITIAL.hammer,
      swap: PROP_INITIAL.swap,
      mint: PROP_INITIAL.mint
    };
    state.board = make_board();
    render_board();
    render_game_hud();
    hide_result();
    go('/game');
  }

  function show_combo(count) {
    var el = $('combo-banner');
    el.textContent = 'Nice! ' + count + ' Combo! 喵~ 🐾';
    el.classList.remove('opacity-hide');
    window.setTimeout(function () { el.classList.add('opacity-hide'); }, 1100);
  }

  // 结算：passed=true 通关，false 失败
  function finish_level(passed) {
    state.busy = true;
    var cfg = get_level_config(state.current_level);
    if (passed) {
      var ratio = state.steps / cfg.steps;
      var star = ratio > 0.5 ? 3 : (ratio > 0.2 ? 2 : 1);
      var old = state.stars[cfg.level] || 0;
      state.stars[cfg.level] = star > old ? star : old;
      if (state.current_level < LEVELS.length) { state.current_level++; }
    }
    if (state.score > state.high_score) { state.high_score = state.score; }
    save_progress();

    var target = state.goal * SCORE_PER_TARGET;

    var mask = $('result-mask');
    var gap = Math.max(0, target - state.score);
    $('result-face').textContent = passed ? '🎉' : '😿';
    $('result-title').textContent = passed ? '通关啦！' : '步数用完啦~';
    $('result-sub').textContent = passed
      ? '橘猫给你比了个心，继续下一关吧~'
      : '差一点点就通关了，橘猫给你揉揉爪~';
    $('result-score').textContent = fmt_num(state.score);
    $('result-gap-label').textContent = passed ? '已达成目标' : '差 ' + fmt_num(gap) + ' 分';
    $('result-target').textContent = '目标 ' + fmt_num(target);
    $('result-bar').style.width = Math.min(100, Math.round(state.score / target * 100)) + '%';
    var retry = $('result-retry-btn');
    retry.innerHTML = passed
      ? '<span class="btn__icon">▶</span> 下一关'
      : '<span class="btn__icon">＋</span> 再试一次 (+5步继续)';
    retry.setAttribute('data-action', passed ? 'next-level' : 'retry-level');
    mask.hidden = false;
  }

  function hide_result() { $('result-mask').hidden = true; }

  // ---------- FLIP 动画（只用 transform，不触发布局重排） ----------
  var SWAP_MS = 250;
  var FALL_MS = 250;

  function tile_size() {
    var el = $('board').children[0];
    return el ? el.offsetWidth : 0;
  }

  // moves: [{index, dx, dy}]，元素先偏移到 (dx,dy)，再过渡回原位
  function flip_animate(moves, duration, done) {
    var i, el;
    for (i = 0; i < moves.length; i++) {
      el = tile_el(moves[i].index);
      if (!el) { continue; }
      el.style.transition = 'none';
      el.style.transform = 'translate(' + moves[i].dx + 'px,' + moves[i].dy + 'px)';
    }
    void $('board').offsetWidth; // 强制 reflow，锁定起始帧
    for (i = 0; i < moves.length; i++) {
      el = tile_el(moves[i].index);
      if (!el) { continue; }
      el.style.transition = 'transform ' + duration + 'ms ease-out';
      el.style.transform = '';
    }
    window.setTimeout(function () {
      for (var j = 0; j < moves.length; j++) {
        el = tile_el(moves[j].index);
        if (el) { el.style.transition = ''; }
      }
      if (done) { done(); }
    }, duration + 30);
  }

  // ---------- 交换 / 消除 ----------
  function do_swap(a, b, callback) {
    var size = tile_size();
    var dx = (col_of(b) - col_of(a)) * size;
    var dy = (row_of(b) - row_of(a)) * size;
    var tmp = state.board[a];
    state.board[a] = state.board[b];
    state.board[b] = tmp;
    render_board();
    // a 位置的元素来自 b，起始偏移为 b→a 的反向
    flip_animate([
      { index: a, dx: dx, dy: dy },
      { index: b, dx: -dx, dy: -dy }
    ], SWAP_MS, function () {
      var m = find_matches(state.board);
      if (m.length === 0) {
        // 无匹配则动画换回
        var t2 = state.board[a];
        state.board[a] = state.board[b];
        state.board[b] = t2;
        render_board();
        flip_animate([
          { index: a, dx: dx, dy: dy },
          { index: b, dx: -dx, dy: -dy }
        ], SWAP_MS, function () {
          if (callback) { callback(false); }
        });
      } else {
        if (callback) { callback(true); }
      }
    });
  }

  // 下落并返回 FLIP 位移表：{index, dx, dy}（dy 为负 = 从上方落下来）
  function apply_gravity() {
    var size = tile_size();
    var moves = [];
    for (var c = 0; c < BOARD_COLS; c++) {
      var stack = []; // [{type, from_row}]
      for (var r = BOARD_ROWS - 1; r >= 0; r--) {
        var v = state.board[idx(c, r)];
        if (v >= 0) { stack.push({ type: v, from_row: r }); }
      }
      for (var r2 = BOARD_ROWS - 1; r2 >= 0; r2--) {
        var fill = stack.shift();
        if (typeof fill === 'object') {
          state.board[idx(c, r2)] = fill.type;
          var dist = r2 - fill.from_row; // >0 表示下移了几格
          if (dist > 0) { moves.push({ index: idx(c, r2), dx: 0, dy: -dist * size }); }
        } else {
          state.board[idx(c, r2)] = rand_type();
          // 新块从棋盘顶部外落入
          moves.push({ index: idx(c, r2), dx: 0, dy: -(r2 + 1) * size });
        }
      }
    }
    return moves;
  }

  function resolve_cascade(combo) {
    var matches = find_matches(state.board);
    if (matches.length > 0) {
      if (combo > 1) { show_combo(combo); }
      var gained = 0;
      var orange_cleared = 0;
      for (var i = 0; i < matches.length; i++) {
        var t = state.board[matches[i]];
        gained += 100 * combo;
        if (t === 0) { orange_cleared++; }
        var el = tile_el(matches[i]);
        if (el) { el.classList.add('tile--clearing'); }
      }
      state.score += gained;
      state.goal_done += orange_cleared;
      window.setTimeout(function () {
        for (var j = 0; j < matches.length; j++) { state.board[matches[j]] = -1; }
        var moves = apply_gravity();
        render_board();
        render_game_hud();
        flip_animate(moves, FALL_MS, function () { resolve_cascade(combo + 1); });
      }, 240);
      return;
    }
    // 无匹配但棋盘有洞（道具消除产生）：先补满再判定
    if (state.board.indexOf(-1) >= 0) {
      var moves2 = apply_gravity();
      render_board();
      flip_animate(moves2, FALL_MS, function () { resolve_cascade(combo); });
      return;
    }
    state.busy = false;
    render_game_hud();
    check_end();
  }

  function check_end() {
    if (state.goal_done >= state.goal) { finish_level(true); return; }
    if (state.steps <= 0) { finish_level(false); return; }
  }

  function spend_step() {
    state.steps--;
    render_game_hud();
  }

  // ---------- 交互 ----------
  function on_tile_tap(i) {
    if (state.busy) { return; }

    // 道具：小锤直接消除
    if (state.active_prop === 'hammer') {
      state.props.hammer--;
      state.active_prop = '';
      state.busy = true;
      if (state.board[i] === 0) { state.goal_done++; }
      state.board[i] = -1;
      state.score += 100;
      render_board();
      window.setTimeout(function () { resolve_cascade(1); }, 200);
      render_game_hud();
      return;
    }
    // 道具：薄荷消除全屏同类型
    if (state.active_prop === 'mint') {
      var target_type = state.board[i];
      if (target_type < 0) { return; }
      state.props.mint--;
      state.active_prop = '';
      state.busy = true;
      for (var k = 0; k < state.board.length; k++) {
        if (state.board[k] === target_type) {
          if (target_type === 0) { state.goal_done++; }
          state.board[k] = -1;
        }
      }
      state.score += 150;
      render_board();
      window.setTimeout(function () { resolve_cascade(1); }, 220);
      render_game_hud();
      return;
    }
    // 道具：换位（任意两格）
    if (state.active_prop === 'swap') {
      if (state.swap_source < 0) {
        state.swap_source = i;
        highlight(i);
        render_game_hud();
        return;
      }
      var a = state.swap_source;
      state.swap_source = -1;
      if (a === i) { clear_highlight(); state.active_prop = ''; render_game_hud(); return; }
      state.props.swap--;
      state.active_prop = '';
      clear_highlight();
      state.busy = true;
      var tmp = state.board[a];
      state.board[a] = state.board[i];
      state.board[i] = tmp;
      render_board();
      window.setTimeout(function () { resolve_cascade(1); }, 200);
      render_game_hud();
      return;
    }

    // 常规：选中 + 交换相邻
    if (state.selected < 0) {
      state.selected = i;
      highlight(i);
      return;
    }
    if (state.selected === i) {
      state.selected = -1;
      clear_highlight();
      return;
    }
    if (!are_adjacent(state.selected, i)) {
      clear_highlight();
      state.selected = i;
      highlight(i);
      return;
    }
    var from = state.selected;
    state.selected = -1;
    clear_highlight();
    state.busy = true;
    do_swap(from, i, function (ok) {
      if (ok) {
        spend_step();
        resolve_cascade(1);
      } else {
        state.busy = false;
      }
    });
  }

  function highlight(i) {
    var el = tile_el(i);
    if (el) { el.classList.add('tile--selected'); }
  }
  function clear_highlight() {
    var els = document.querySelectorAll('.tile--selected');
    for (var i = 0; i < els.length; i++) { els[i].classList.remove('tile--selected'); }
  }

  // ---------- 拖拽交换（移动端手势优先，桌面鼠标兜底） ----------
  var drag = { start_i: -1, x: 0, y: 0, moved: false, suppress_click: false };

  function tile_index_from_point(x, y) {
    var el = document.elementFromPoint(x, y);
    var board = $('board');
    while (el && el !== board) {
      if (el.classList && el.classList.contains('tile')) {
        return parseInt(el.getAttribute('data-index'), 10);
      }
      el = el.parentNode;
    }
    return -1;
  }

  function try_drag_swap(from, dx, dy) {
    var horizontal = Math.abs(dx) > Math.abs(dy);
    var to_col = col_of(from) + (horizontal ? (dx > 0 ? 1 : -1) : 0);
    var to_row = row_of(from) + (horizontal ? 0 : (dy > 0 ? 1 : -1));
    if (to_col < 0 || to_col >= BOARD_COLS || to_row < 0 || to_row >= BOARD_ROWS) { return; }
    var to = idx(to_col, to_row);
    clear_highlight();
    state.selected = -1;
    state.busy = true;
    do_swap(from, to, function (ok) {
      if (ok) {
        spend_step();
        resolve_cascade(1);
      } else {
        state.busy = false;
      }
    });
  }

  function on_drag_start(x, y) {
    if (state.busy || state.active_prop) { return; } // 道具模式与动画期间不进入拖拽
    var i = tile_index_from_point(x, y);
    if (i < 0 || state.board[i] < 0) { return; }
    drag.start_i = i;
    drag.x = x;
    drag.y = y;
    drag.moved = false;
  }

  function on_drag_move(x, y) {
    if (drag.start_i < 0 || drag.moved) { return; }
    var dx = x - drag.x;
    var dy = y - drag.y;
    var tile = tile_el(drag.start_i);
    var threshold = tile ? Math.max(14, tile.offsetWidth * 0.4) : 20;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) { return; }
    drag.moved = true;
    drag.suppress_click = true; // 拖拽完成后吞掉随后的 click，避免误选
    window.setTimeout(function () { drag.suppress_click = false; }, 350);
    try_drag_swap(drag.start_i, dx, dy);
    drag.start_i = -1;
  }

  function on_drag_end() { drag.start_i = -1; }

  function bind_board_gestures() {
    var board = $('board');
    board.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { return; }
      on_drag_start(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    board.addEventListener('touchmove', function (e) {
      if (e.touches.length !== 1) { return; }
      if (drag.start_i >= 0 && e.cancelable) { e.preventDefault(); }
      on_drag_move(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    board.addEventListener('touchend', on_drag_end);
    board.addEventListener('touchcancel', on_drag_end);
    // 桌面调试兜底：鼠标拖拽
    board.addEventListener('mousedown', function (e) {
      on_drag_start(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', function (e) {
      if (drag.start_i >= 0) { on_drag_move(e.clientX, e.clientY); }
    });
    document.addEventListener('mouseup', on_drag_end);
  }

  // ---------- 事件委托 ----------
  function bind_actions() {
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!el) { return; }
      var action = el.getAttribute('data-action');

      if (action === 'toggle-sound') {
        state.sound_on = !state.sound_on;
        render_home();
      } else if (action === 'pet-cat') {
        pet_cat();
      } else if (action === 'start-game') {
        start_level(state.current_level);
      } else if (action === 'open-levels') {
        render_levels();
        $('level-sheet').hidden = false;
      } else if (action === 'close-levels') {
        $('level-sheet').hidden = true;
      } else if (action === 'pick-level') {
        var lv = parseInt(el.getAttribute('data-level'), 10);
        $('level-sheet').hidden = true;
        start_level(lv);
      } else if (action === 'tap-tile') {
        if (drag.suppress_click) { drag.suppress_click = false; return; } // 拖拽刚完成，忽略伴随的 click
        on_tile_tap(parseInt(el.getAttribute('data-index'), 10));
      } else if (action === 'use-prop') {
        var key = el.getAttribute('data-prop');
        if (state.props[key] <= 0) { return; }
        state.active_prop = state.active_prop === key ? '' : key;
        state.swap_source = -1;
        clear_highlight();
        render_game_hud();
      } else if (action === 'pause-game') {
        go('/');
      } else if (action === 'retry-level') {
        state.steps += 5;
        state.busy = false;
        hide_result();
        render_game_hud();
      } else if (action === 'next-level') {
        // finish_level 已将 current_level 前移，此处直接开新局
        start_level(state.current_level);
      } else if (action === 'back-home') {
        hide_result();
        state.board = [];
        state.busy = false;
        go('/');
      }
    });
  }

  function pet_cat() {
    var mascot = $('cat-mascot');
    var bubble = $('heart-bubble');
    var deg = Math.random() > 0.5 ? 4 : -4;
    mascot.style.transform = 'scale(1.08) rotate(' + deg + 'deg)';
    bubble.classList.remove('opacity-hide');
    window.setTimeout(function () { mascot.style.transform = ''; }, 180);
    window.setTimeout(function () { bubble.classList.add('opacity-hide'); }, 1200);
  }

  // ---------- 启动 ----------
  function init() {
    detect_flex_gap();
    load_progress();
    render_home();
    bind_actions();
    bind_board_gestures();
    window.addEventListener('hashchange', show_route);
    window.addEventListener('resize', function () {
      if (state.board.length > 0) { layout_board(); }
    });
    show_route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
