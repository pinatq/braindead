// Initialization script injected into every native browser-pane webview (add_pane).
// Port of the Electron <webview> preload (src/preload/webview.ts in vibe-coder-master).
//
// SIGNALING: a page script can't reach the UI webview directly, so every message is sent
// as a FAKE NAVIGATION to a `vibecoder://<cmd>/?…` URL. Rust's `on_navigation` handler in
// lib.rs (already wired for the address bar) intercepts the scheme, emits the matching
// `pane:*` event to the React UI and CANCELS the navigation — the page never moves.
// This relies only on always-present webview features (init script + navigation delegate),
// not on `window.__TAURI__`/event ACLs inside external pages.
//
//   preload channel      -> fake navigation            -> React (tauri-bridge.ts -> BrowserPane)
//   pane-activate        -> vibecoder://activate       -> setActivePane
//   open-tab             -> vibecoder://open-tab?url=  -> new tab (tab bar appears, like master)
//   run-bind             -> vibecoder://run-bind?combo=-> actionForCombo + runBind
//   focus-url            -> vibecoder://focus-url      -> focus the address input
//   vim-window           -> vibecoder://win-motion?act=-> runWindowMotion
//   vim-window-prefix    -> vibecoder://win-prefix     -> armWinPending (statusline)
//   vim-hello            -> vibecoder://vim-hello      -> UI pushes the vim state (pane_eval)
//
// The UI pushes state INTO the page with pane_eval setting `window.__vimState`
// { vim, binds, reserved } — the script reads it lazily on every event and re-asks
// (vim-hello) after each page load.
//
// KEYBOARD PRIORITY (same contract as master's preload): app keybinds (reserved combos)
// are intercepted FIRST and forwarded to the app; vim-mode keys second; only the rest
// reaches the web page. In terminal panes the same chain is enforced by the UI webview
// (window-capture listener in useShortcuts.ts runs before xterm's handler).

// The pane id is baked in per webview (label `pane:{paneId}:{tabId}`), so events carry
// the full id and the owning BrowserPane filters by its `paneId:` prefix.
pub fn script(full_id: &str) -> String {
    TEMPLATE.replace("__PANE_ID__", full_id)
}

const TEMPLATE: &str = r#"
(function () {
  // Sygnał do aplikacji: udawana nawigacja na vibecoder:// — on_navigation w Rust ją
  // przechwytuje, emituje event do UI i anuluje (strona zostaje w miejscu).
  function go(cmd, params) {
    var parts = [];
    params = params || {};
    for (var k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    parts.push('t=' + Date.now()); // nonce: identyczne komendy pod rząd też nawigują
    location.href = 'vibecoder://' + cmd + '/?' + parts.join('&');
  }

  // ================= Stan z UI (vim/bindy) =================
  // UI ustawia window.__vimState = { vim, binds, reserved } przez pane_eval.
  function vimState() {
    var s = window.__vimState || {};
    return { vim: !!s.vim, binds: s.binds || {}, reserved: s.reserved || {} };
  }
  go('vim-hello', {}); // zgłoś się — UI odeśle bieżący stan (port: vim-hello)

  // ================= Port shared/vimKeys.ts =================
  function matchVimKey(token, e, dbl) {
    if (!token) return false;
    if (token.indexOf('C-') === 0) {
      var want = token.slice(2) === 'Space' ? ' ' : token.slice(2);
      return !!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === want.toLowerCase();
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (token.length === 2 && token[0] === token[1]) {
      if (e.key !== token[0]) return false;
      var now = Date.now();
      var ok = !!dbl && dbl.key === token[0] && now - dbl.time < 500;
      if (dbl) { dbl.key = ok ? '' : token[0]; dbl.time = now; }
      return ok;
    }
    return e.key === (token === 'Space' ? ' ' : token);
  }
  function isDoubleFirst(e, tokens) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    return tokens.some(function (t) { return t.length === 2 && t[0] === t[1] && t[0] === e.key; });
  }
  var WIN_MOTION_IDS = [
    'win.focusLeft', 'win.focusDown', 'win.focusUp', 'win.focusRight',
    'win.cycle', 'win.cyclePrev', 'win.close', 'win.splitDown', 'win.splitRight', 'win.only'
  ];

  // ================= Odtwarzanie mediów =================
  // Port zdarzeń media-started-playing / media-paused z Electronowego <webview>: karta,
  // w której leci film, nie może zostać uśpiona przez eco mode. Nasłuch w fazie capture
  // na document łapie też <video> dodane do DOM później (YouTube, reels).
  document.addEventListener('play', function () { go('media', { on: 1 }); }, true);
  document.addEventListener('pause', function () { go('media', { on: 0 }); }, true);
  document.addEventListener('ended', function () { go('media', { on: 0 }); }, true);

  // ================= Nawigacja w SPA =================
  // history.pushState nie odpala on_navigation po stronie Rusta, więc pasek adresu
  // zostawał na starym URL-u (YouTube, X, GitHub). Podpinamy się pod API historii.
  // ponytail: raportujemy sam adres — pozycji w historii WKWebView i tak nie zdradza,
  // stos wstecz/dalej dalej liczy BrowserPane.
  (function () {
    var last = location.href;
    var tell = function () {
      if (location.href === last) return;
      last = location.href;
      go('spa-nav', { url: last });
    };
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      history[m] = function () {
        var r = orig.apply(this, arguments);
        setTimeout(tell, 0);
        return r;
      };
    });
    window.addEventListener('popstate', function () { setTimeout(tell, 0); }, true);
    window.addEventListener('hashchange', function () { setTimeout(tell, 0); }, true);
  })();

  // Klik / focus w treści => aktywuj panel (niebieska ramka) — jak mousedown w preloadzie.
  // `click: 1` = prawdziwe kliknięcie użytkownika. Focus leci seriami (autofocus, iframe'y,
  // skrypty strony wołające .focus()), więc odbiorca musi umieć je odróżnić — inaczej każda
  // reakcja podpięta pod pane:activate dostaje lawinę zdarzeń.
  window.addEventListener('mousedown', function () { go('activate', { click: 1 }); }, true);
  window.addEventListener('focus', function () { go('activate', {}); }, true);

  // ================= Linki → nowa karta =================
  function hrefFrom(target) {
    var el = target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    return (el && el.href) || null;
  }
  // Środkowy klik (scroll-click) na linku => nowa karta (pasek kart pokazuje się jak w master).
  window.addEventListener('auxclick', function (e) {
    if (e.button !== 1) return;
    var href = hrefFrom(e.target);
    if (href) { e.preventDefault(); go('open-tab', { url: href }); }
  }, true);
  // Klik z ⌘/Ctrl na linku => nowa karta.
  window.addEventListener('click', function (e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    var href = hrefFrom(e.target);
    if (href) { e.preventDefault(); go('open-tab', { url: href }); }
  }, true);

  // ================= Skróty programu (priorytet nad stroną) =================
  var MODS = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS', 'ContextMenu'];
  function comboOf(e) {
    var key = e.key;
    if (MODS.indexOf(key) !== -1) return '';
    if (key === ' ') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
    var parts = [];
    if (e.metaKey) parts.push('Meta');
    if (e.ctrlKey) parts.push('Control');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(key);
    return parts.join('+');
  }

  // ================= Vim mode (Vimium-lite) =================
  var HINT_CHARS = 'sadfjklewcmpgh';
  function isEditable(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  // ---- Link hints ('f') ----
  var hintLayer = null;
  var hintMap = [];
  var hintTyped = '';
  function genLabels(n) {
    var c = HINT_CHARS.split('');
    if (n <= c.length) return c.slice(0, n);
    var out = [];
    for (var i = 0; i < c.length; i++)
      for (var j = 0; j < c.length; j++)
        if (out.length < n) out.push(c[i] + c[j]);
    return out;
  }
  function clearHints() {
    if (hintLayer) hintLayer.remove();
    hintLayer = null;
    hintMap = [];
    hintTyped = '';
  }
  function showHints() {
    clearHints();
    var sel = 'a[href], button, input:not([type=hidden]), textarea, select, [role="button"], [role="link"], [onclick]';
    var W = window.innerWidth, H = window.innerHeight;
    var els = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W;
    });
    if (!els.length) return;
    var labels = genLabels(els.length);
    var layer = document.createElement('div');
    layer.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;pointer-events:none');
    els.forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      var tag = document.createElement('span');
      tag.textContent = labels[i].toUpperCase();
      tag.setAttribute('style',
        'position:fixed;left:' + Math.max(0, r.left) + 'px;top:' + Math.max(0, r.top) + 'px;' +
        'background:#facc15;color:#111;font:700 11px/1.4 system-ui,sans-serif;' +
        'padding:1px 4px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.5)');
      layer.appendChild(tag);
      hintMap.push({ label: labels[i], el: el, tag: tag });
    });
    document.body.appendChild(layer);
    hintLayer = layer;
  }
  function activateHint(el) {
    if (isEditable(el)) el.focus();
    else el.click();
  }
  function onHintKey(e) {
    if (e.key === 'Escape') { clearHints(); return true; }
    if (e.key === 'Backspace') hintTyped = hintTyped.slice(0, -1);
    else if (/^[a-z]$/i.test(e.key)) hintTyped += e.key.toLowerCase();
    else return true;
    var matches = hintMap.filter(function (h) { return h.label.indexOf(hintTyped) === 0; });
    if (matches.length === 0) clearHints();
    else if (matches.length === 1 && matches[0].label === hintTyped) {
      var el = matches[0].el;
      clearHints();
      activateHint(el);
    } else {
      hintMap.forEach(function (h) {
        h.tag.style.opacity = h.label.indexOf(hintTyped) === 0 ? '1' : '0.25';
      });
    }
    return true;
  }

  // Kolejne pole formularza przy każdym 'i'.
  var inputIdx = -1;
  function focusNextInput() {
    var sel = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea';
    var W = window.innerWidth, H = window.innerHeight;
    var els = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(function (el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W;
    });
    if (!els.length) return;
    inputIdx = (inputIdx + 1) % els.length;
    var el = els[inputIdx];
    el.focus();
    el.scrollIntoView({ block: 'center' });
  }

  var winPending = false;
  var winTimer = null;
  var dblState = { key: '', time: 0 };

  window.addEventListener('keydown', function (e) {
    var st = vimState();
    // Bindy programu (panele/karty) z modyfikatorem mają PRIORYTET nad stroną — oddaj je hostowi.
    if (e.metaKey || e.ctrlKey || e.altKey) {
      var combo = comboOf(e);
      if (combo && st.reserved[combo]) {
        e.preventDefault();
        e.stopPropagation();
        go('run-bind', { combo: combo });
        return;
      }
    }
    if (!st.vim) {
      if (hintLayer) clearHints();
      return;
    }
    // Aktywne link-hints przejmują klawisze.
    if (hintLayer) {
      if (onHintKey(e)) { e.preventDefault(); e.stopPropagation(); }
      return;
    }

    var vb = st.binds;

    // Prefiks Ctrl-w: drugi klawisz = nawigacja oknami (forward do hosta).
    if (winPending) {
      winPending = false;
      if (winTimer) clearTimeout(winTimer);
      var act = null;
      for (var i = 0; i < WIN_MOTION_IDS.length; i++) {
        if (matchVimKey(vb[WIN_MOTION_IDS[i]], e)) { act = WIN_MOTION_IDS[i]; break; }
      }
      if (act) go('win-motion', { act: act });
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (matchVimKey(vb['win.prefix'], e)) {
      winPending = true;
      if (winTimer) clearTimeout(winTimer);
      winTimer = setTimeout(function () { winPending = false; }, 2200);
      go('win-prefix', {});
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // Pisanie w polach — nie przeszkadzamy (Esc wychodzi z pola).
    if (isEditable(document.activeElement)) {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    // Pozostałe kombinacje z modyfikatorem zostawiamy stronie (Ctrl-w już obsłużony).
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var half = window.innerHeight / 2;
    var handled = true;
    if (matchVimKey(vb['browser.hints'], e, dblState)) showHints();
    else if (matchVimKey(vb['browser.nextInput'], e, dblState)) focusNextInput();
    else if (matchVimKey(vb['browser.address'], e, dblState)) go('focus-url', {});
    else if (matchVimKey(vb['browser.back'], e, dblState)) history.back();
    else if (matchVimKey(vb['browser.fwd'], e, dblState)) history.forward();
    else if (matchVimKey(vb['browser.down'], e, dblState)) window.scrollBy({ top: 60 });
    else if (matchVimKey(vb['browser.up'], e, dblState)) window.scrollBy({ top: -60 });
    else if (matchVimKey(vb['browser.left'], e, dblState)) window.scrollBy({ left: -60 });
    else if (matchVimKey(vb['browser.right'], e, dblState)) window.scrollBy({ left: 60 });
    else if (matchVimKey(vb['browser.halfDown'], e, dblState)) window.scrollBy({ top: half });
    else if (matchVimKey(vb['browser.halfUp'], e, dblState)) window.scrollBy({ top: -half });
    else if (matchVimKey(vb['browser.top'], e, dblState)) window.scrollTo({ top: 0 });
    else if (matchVimKey(vb['browser.bottom'], e, dblState)) window.scrollTo({ top: document.body.scrollHeight });
    else if (e.key === 'Escape') clearHints();
    else if (isDoubleFirst(e, [vb['browser.top']])) {
      /* pierwsze 'g' z 'gg' — połykamy, czekając na drugie */
    } else handled = false;

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
})();
"#;
