// ==UserScript==
// @name         Mobile Video Controls
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Clean, mobile-first fullscreen player: double-tap seek, swipe seek, hold for 2x, speed picker, Android back button closes.
// @author       You
// @match        *://*/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kowshikvajrala/mobile-video-controls/main/mobile-video-controls.user.js
// @updateURL    https://raw.githubusercontent.com/kowshikvajrala/mobile-video-controls/main/mobile-video-controls.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (window.__vpcLoaded) return;
    window.__vpcLoaded = true;

    const SEEK_STEP = 10;
    const DOUBLE_TAP_MS = 280;
    const HIDE_DELAY = 3000;
    const LONG_PRESS_MS = 450;
    const BOOST_RATE = 2;
    const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];

    /* =============================
       HELPERS
    ============================== */
    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) seconds = 0;
        seconds = Math.floor(seconds);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = String(seconds % 60).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    }

    function formatDelta(seconds) {
        return (seconds < 0 ? '−' : '+') + formatTime(Math.abs(seconds));
    }

    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

    // Some sites (e.g. YouTube) enforce Trusted Types, which blocks plain innerHTML.
    let ttPolicy = null;
    try {
        ttPolicy = window.trustedTypes && window.trustedTypes.createPolicy('vpc-ui', { createHTML: (s) => s });
    } catch (e) { /* policy name not allowed; fall back to plain strings */ }
    const html = (s) => (ttPolicy ? ttPolicy.createHTML(s) : s);

    const svg = (path, extra = '') =>
        `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/>${extra}</svg>`;

    const ICON = {
        play: svg('M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z'),
        pause: svg('M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'),
        replay: svg('M12 5V2L7 6.5 12 11V7.5a5.5 5.5 0 1 1-5.5 5.5H4a8 8 0 1 0 8-8z',
            '<text x="12" y="16.2" text-anchor="middle" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif">10</text>'),
        forward: svg('M12 5V2l5 4.5L12 11V7.5a5.5 5.5 0 1 0 5.5 5.5H20a8 8 0 1 1-8-8z',
            '<text x="12" y="16.2" text-anchor="middle" font-size="6.5" font-weight="700" font-family="system-ui,sans-serif">10</text>'),
        close: svg('M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.42 6.3-6.3 6.29 6.3 1.42-1.42-6.3-6.29 6.3-6.3z'),
        fsEnter: svg('M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'),
        fsExit: svg('M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z'),
        open: svg('M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z'),
        rotate: svg('M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 18.29 0 12 0l-.66.03 3.81 3.81 1.33-1.32zm-6.25-.77a1.5 1.5 0 0 0-2.12 0L1.75 8.11a1.5 1.5 0 0 0 0 2.12l12.02 12.02a1.5 1.5 0 0 0 2.12 0l6.36-6.36a1.5 1.5 0 0 0 0-2.12L10.23 1.75zm4.6 19.44L2.81 9.17l6.36-6.36 12.02 12.02-6.36 6.36zm-7.31.29C4.25 19.94 1.91 16.76 1.55 13H.05C.56 19.16 5.71 24 12 24l.66-.03-3.81-3.81-1.33 1.32z'),
        tri: svg('M8 5v14l11-7z'),
    };

    /* =============================
       STYLES (scoped inside shadow DOM)
    ============================== */
    const CSS = `
        :host { all: initial; }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        svg { width: 100%; height: 100%; fill: currentColor; display: block; }

        .root {
            --accent: #0fbfef;
            --fg: #fff;
            --muted: rgba(255,255,255,.72);
            font-family: Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
            color: var(--fg);
            -webkit-user-select: none; user-select: none;
        }

        /* Floating launcher */
        .fab {
            all: unset;
            position: fixed;
            right: max(16px, env(safe-area-inset-right));
            bottom: max(88px, calc(env(safe-area-inset-bottom) + 72px));
            width: 48px; height: 48px;
            border-radius: 50%;
            display: grid; place-items: center;
            background: rgba(20,20,20,.78);
            color: var(--accent);
            border: 1px solid rgba(255,255,255,.12);
            box-shadow: 0 6px 20px rgba(0,0,0,.4);
            -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
            pointer-events: auto;
            cursor: pointer;
            transition: opacity .25s, transform .25s;
        }
        .fab svg { width: 22px; height: 22px; }
        .fab:active { transform: scale(.92); }
        .fab.away { opacity: 0; transform: translateY(12px); pointer-events: none; }
        .fab[hidden] { display: none; }

        /* Overlay */
        .overlay {
            position: fixed; inset: 0;
            background: #000;
            display: none;
            pointer-events: auto;
            overflow: hidden;
            touch-action: none;
        }
        .overlay.open { display: block; }
        .stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
        .gesture { position: absolute; inset: 0; }

        /* Controls layer */
        .ui { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .2s; }
        .ui.visible { opacity: 1; }
        .ui.visible .hit { pointer-events: auto; }
        .ui::before, .ui::after { content: ""; position: absolute; left: 0; right: 0; pointer-events: none; }
        .ui::before { top: 0; height: 120px; background: linear-gradient(rgba(0,0,0,.6), transparent); }
        .ui::after { bottom: 0; height: 170px; background: linear-gradient(transparent, rgba(0,0,0,.75)); }

        .btn {
            all: unset;
            position: relative;
            display: grid; place-items: center;
            width: 44px; height: 44px;
            border-radius: 50%;
            color: var(--fg);
            cursor: pointer;
            transition: background .15s, transform .15s;
        }
        .btn svg { width: 24px; height: 24px; }
        .btn:active { background: rgba(255,255,255,.18); transform: scale(.94); }

        .top {
            position: absolute; top: 0; left: 0; right: 0; z-index: 1;
            display: flex; align-items: center; gap: 8px;
            padding: max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) 0 max(10px, env(safe-area-inset-left));
        }
        .spacer { flex: 1; }
        .pill {
            all: unset;
            height: 32px; padding: 0 14px;
            border-radius: 16px;
            display: flex; align-items: center;
            background: rgba(255,255,255,.14);
            font-size: 14px; font-weight: 600; letter-spacing: .2px;
            cursor: pointer;
        }
        .pill:active { background: rgba(255,255,255,.26); }

        .center {
            position: absolute; left: 50%; top: 50%; z-index: 1;
            transform: translate(-50%, -50%);
            display: flex; align-items: center; gap: clamp(28px, 10vw, 72px);
        }
        .center .btn { width: 52px; height: 52px; background: rgba(0,0,0,.28); }
        .center .btn svg { width: 30px; height: 30px; }
        .center .btn.main { width: 68px; height: 68px; background: rgba(0,0,0,.4); }
        .center .btn.main svg { width: 38px; height: 38px; }

        .bottom {
            position: absolute; left: 0; right: 0; bottom: 0; z-index: 1;
            padding: 0 max(16px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
        }
        .row { display: flex; align-items: center; height: 40px; }
        .time { font-size: 13px; font-variant-numeric: tabular-nums; color: var(--fg); }
        .time .dur { color: var(--muted); }
        .row .btn { margin-right: -10px; }

        .bar { position: relative; height: 32px; cursor: pointer; touch-action: none; }
        .track {
            position: absolute; left: 0; right: 0; top: 50%;
            height: 3px; margin-top: -1.5px;
            border-radius: 2px; overflow: hidden;
            background: rgba(255,255,255,.28);
            transition: height .15s, margin-top .15s;
        }
        .buffered, .played { position: absolute; inset: 0; transform-origin: left; transform: scaleX(0); }
        .buffered { background: rgba(255,255,255,.4); }
        .played { background: var(--accent); }
        .thumb {
            position: absolute; top: 50%; left: 0;
            width: 14px; height: 14px; margin: -7px 0 0 -7px;
            border-radius: 50%; background: var(--accent);
            box-shadow: 0 0 0 4px rgba(15,191,239,.0);
            transition: transform .15s, box-shadow .15s;
        }
        .bar.drag .track { height: 5px; margin-top: -2.5px; }
        .bar.drag .thumb { transform: scale(1.3); box-shadow: 0 0 0 6px rgba(15,191,239,.25); }

        /* Thin progress line while controls are hidden */
        .mini { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgba(255,255,255,.2); transition: opacity .2s; }
        .mini > div { height: 100%; background: var(--accent); transform-origin: left; transform: scaleX(0); }
        .ui.visible ~ .mini { opacity: 0; }

        /* Play/pause & fullscreen icon state */
        .overlay:not(.paused) .i-play, .overlay.paused .i-pause { display: none; }
        .overlay:not(.fs) .i-fs-exit, .overlay.fs .i-fs-enter { display: none; }

        /* Double-tap ripples */
        .ripple {
            position: absolute; top: 0; bottom: 0; width: 38%;
            display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
            background: rgba(255,255,255,.12);
            opacity: 0; transition: opacity .2s;
            pointer-events: none;
            font-size: 13px; font-weight: 500;
        }
        .ripple.left { left: 0; border-radius: 0 50% 50% 0 / 0 50% 50% 0; }
        .ripple.right { right: 0; border-radius: 50% 0 0 50% / 50% 0 0 50%; }
        .ripple.show { opacity: 1; }
        .arrows { display: flex; }
        .ripple.left .arrows { transform: scaleX(-1); }
        .arrows svg { width: 16px; height: 16px; opacity: .3; animation: arw 0.9s infinite; }
        .arrows svg:nth-child(2) { animation-delay: .15s; }
        .arrows svg:nth-child(3) { animation-delay: .3s; }
        @keyframes arw { 0%, 100% { opacity: .25; } 40% { opacity: 1; } }

        /* Center toast (swipe / scrub preview) */
        .toast {
            position: absolute; left: 50%; top: 22%;
            transform: translate(-50%, -50%);
            padding: 8px 16px; border-radius: 12px;
            background: rgba(0,0,0,.6);
            text-align: center;
            opacity: 0; transition: opacity .15s;
            pointer-events: none;
        }
        .toast.show { opacity: 1; }
        .toast-main { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
        .toast-sub { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
        .toast-sub:empty { display: none; }

        /* Hold-for-2x badge */
        .badge {
            position: absolute; left: 50%; top: max(16px, env(safe-area-inset-top));
            transform: translateX(-50%);
            display: flex; align-items: center; gap: 6px;
            padding: 6px 14px; border-radius: 16px;
            background: rgba(0,0,0,.6);
            font-size: 14px; font-weight: 600;
            opacity: 0; transition: opacity .15s;
            pointer-events: none;
        }
        .badge svg { width: 14px; height: 14px; }
        .badge.show { opacity: 1; }

        /* Buffering spinner */
        .spinner {
            position: absolute; left: 50%; top: 50%;
            width: 44px; height: 44px; margin: -22px 0 0 -22px;
            border: 3px solid rgba(255,255,255,.25); border-top-color: #fff;
            border-radius: 50%;
            animation: spin .8s linear infinite;
            display: none; pointer-events: none;
        }
        .overlay.loading .spinner { display: block; }
        .overlay.loading .center .main { opacity: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Speed sheet */
        .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.45); opacity: 0; pointer-events: none; transition: opacity .2s; }
        .backdrop.open { opacity: 1; pointer-events: auto; }
        .sheet {
            position: absolute; left: 0; right: 0; bottom: 0;
            margin: 0 auto; max-width: 520px;
            padding: 8px 16px max(16px, env(safe-area-inset-bottom));
            background: #1f1f1f;
            border-radius: 18px 18px 0 0;
            transform: translateY(105%);
            transition: transform .25s cubic-bezier(.2,.8,.2,1);
            pointer-events: auto;
        }
        .sheet.open { transform: none; }
        .grip { width: 36px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.25); margin: 4px auto 12px; }
        .sheet-title { font-size: 14px; color: var(--muted); margin: 0 4px 12px; }
        .chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)); gap: 8px; }
        .chip {
            all: unset;
            height: 40px; border-radius: 20px;
            display: grid; place-items: center;
            background: rgba(255,255,255,.08);
            font-size: 14px; font-weight: 500;
            cursor: pointer;
        }
        .chip:active { background: rgba(255,255,255,.18); }
        .chip.sel { background: var(--accent); color: #002330; font-weight: 700; }
    `;

    const TEMPLATE = `
        <style>${CSS}</style>
        <div class="root">
            <button class="fab" hidden aria-label="Open video player">${ICON.open}</button>

            <div class="overlay paused">
                <div class="stage"></div>
                <div class="gesture"></div>

                <div class="ripple left"><div class="arrows">${ICON.tri}${ICON.tri}${ICON.tri}</div><div class="rtext"></div></div>
                <div class="ripple right"><div class="arrows">${ICON.tri}${ICON.tri}${ICON.tri}</div><div class="rtext"></div></div>
                <div class="spinner"></div>

                <div class="ui">
                    <div class="top">
                        <button class="btn hit" data-act="close" aria-label="Close">${ICON.close}</button>
                        <div class="spacer"></div>
                        <button class="btn hit" data-act="rotate" aria-label="Rotate screen">${ICON.rotate}</button>
                        <button class="pill hit speed-label" data-act="speed" aria-label="Playback speed">1x</button>
                    </div>
                    <div class="center">
                        <button class="btn hit" data-act="back" aria-label="Back ${SEEK_STEP} seconds">${ICON.replay}</button>
                        <button class="btn hit main" data-act="play" aria-label="Play or pause">
                            <span class="i-play">${ICON.play}</span><span class="i-pause">${ICON.pause}</span>
                        </button>
                        <button class="btn hit" data-act="fwd" aria-label="Forward ${SEEK_STEP} seconds">${ICON.forward}</button>
                    </div>
                    <div class="bottom">
                        <div class="row">
                            <div class="time"><span class="cur">0:00</span><span class="dur"> / 0:00</span></div>
                            <div class="spacer"></div>
                            <button class="btn hit" data-act="fs" aria-label="Fullscreen">
                                <span class="i-fs-enter">${ICON.fsEnter}</span><span class="i-fs-exit">${ICON.fsExit}</span>
                            </button>
                        </div>
                        <div class="bar hit">
                            <div class="track"><div class="buffered"></div><div class="played"></div></div>
                            <div class="thumb"></div>
                        </div>
                    </div>
                </div>
                <div class="mini"><div></div></div>

                <div class="toast"><div class="toast-main"></div><div class="toast-sub"></div></div>
                <div class="badge">${BOOST_RATE}x ${ICON.tri}</div>

                <div class="backdrop"></div>
                <div class="sheet" role="dialog" aria-label="Playback speed">
                    <div class="grip"></div>
                    <div class="sheet-title">Playback speed</div>
                    <div class="chips">
                        ${SPEEDS.map((s) => `<button class="chip" data-speed="${s}">${s === 1 ? 'Normal' : s + 'x'}</button>`).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    /* =============================
       BUILD UI (single instance for the whole page)
    ============================== */
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = html(TEMPLATE);
    document.documentElement.appendChild(host);

    const $ = (sel) => shadow.querySelector(sel);
    const fab = $('.fab');
    const overlay = $('.overlay');
    const stage = $('.stage');
    const gesture = $('.gesture');
    const ui = $('.ui');
    const curEl = $('.cur');
    const durEl = $('.dur');
    const speedLabel = $('.speed-label');
    const bar = $('.bar');
    const track = $('.track');
    const bufferedEl = $('.buffered');
    const playedEl = $('.played');
    const thumb = $('.thumb');
    const miniEl = $('.mini > div');
    const toast = $('.toast');
    const toastMain = $('.toast-main');
    const toastSub = $('.toast-sub');
    const badge = $('.badge');
    const ripples = { left: $('.ripple.left'), right: $('.ripple.right') };
    const backdrop = $('.backdrop');
    const sheet = $('.sheet');
    const chips = [...shadow.querySelectorAll('.chip')];

    /* =============================
       STATE
    ============================== */
    let current = null;        // video currently shown in the overlay
    let saved = null;          // where the video came from + its original attributes
    let listeners = null;      // AbortController for per-video listeners
    let rafId = 0;
    let hideTimer = 0;
    let pushedHistory = false;
    let sheetOpen = false;
    let scrubbing = false;
    let scrubTime = 0;
    let boosting = false;
    let boostPrevRate = 1;
    let orientationMode = null; // null = auto, or 'landscape' / 'portrait' chosen via rotate button

    /* =============================
       PLAYBACK
    ============================== */
    function togglePlay() {
        if (!current) return;
        if (current.paused || current.ended) current.play().catch(() => { });
        else current.pause();
    }

    function seekTo(t) {
        if (!current) return;
        const d = current.duration;
        current.currentTime = isFinite(d) ? clamp(t, 0, d) : Math.max(0, t);
    }

    function seekBy(sec) {
        if (current) seekTo(current.currentTime + sec);
    }

    function setSpeed(rate) {
        if (!current) return;
        current.playbackRate = rate;
        render();
    }

    function startBoost() {
        if (!current || current.paused || boosting) return;
        boosting = true;
        boostPrevRate = current.playbackRate;
        current.playbackRate = Math.max(BOOST_RATE, boostPrevRate);
        badge.classList.add('show');
        hideUI();
        if (navigator.vibrate) navigator.vibrate(12);
    }

    function stopBoost() {
        if (!boosting) return;
        boosting = false;
        if (current) current.playbackRate = boostPrevRate;
        badge.classList.remove('show');
    }

    /* =============================
       RENDER
    ============================== */
    function render() {
        const v = current;
        if (!v) return;

        const d = v.duration;
        const hasDur = isFinite(d) && d > 0;
        const t = scrubbing ? scrubTime : v.currentTime;
        const ratio = hasDur ? clamp(t / d, 0, 1) : 0;

        playedEl.style.transform = `scaleX(${ratio})`;
        miniEl.style.transform = `scaleX(${ratio})`;
        thumb.style.left = `${ratio * 100}%`;

        let bufEnd = 0;
        const b = v.buffered;
        for (let i = 0; i < b.length; i++) {
            if (b.start(i) <= v.currentTime + 0.5) bufEnd = Math.max(bufEnd, b.end(i));
        }
        bufferedEl.style.transform = `scaleX(${hasDur ? clamp(bufEnd / d, 0, 1) : 0})`;

        const curText = formatTime(t);
        if (curEl.textContent !== curText) curEl.textContent = curText;
        const durText = hasDur ? ` / ${formatTime(d)}` : (d === Infinity ? ' · LIVE' : ' / 0:00');
        if (durEl.textContent !== durText) durEl.textContent = durText;

        if (!boosting) {
            const rateText = `${v.playbackRate}x`;
            if (speedLabel.textContent !== rateText) speedLabel.textContent = rateText;
        }

        const paused = v.paused || v.ended;
        overlay.classList.toggle('paused', paused);
        overlay.classList.toggle('loading', !paused && v.readyState < 3);
        overlay.classList.toggle('fs', !!document.fullscreenElement);
    }

    function loop() {
        render();
        rafId = requestAnimationFrame(loop);
    }

    /* =============================
       CONTROLS VISIBILITY
    ============================== */
    function scheduleHide() {
        clearTimeout(hideTimer);
        if (!current || current.paused || sheetOpen || scrubbing) return;
        hideTimer = setTimeout(hideUI, HIDE_DELAY);
    }

    function showUI() {
        ui.classList.add('visible');
        scheduleHide();
    }

    function hideUI() {
        clearTimeout(hideTimer);
        ui.classList.remove('visible');
    }

    function toggleUI() {
        if (ui.classList.contains('visible')) hideUI();
        else showUI();
    }

    /* =============================
       TOAST / RIPPLE FEEDBACK
    ============================== */
    let toastTimer = 0;
    function showToast(main, sub = '', autoHideMs = 0) {
        toastMain.textContent = main;
        toastSub.textContent = sub;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        if (autoHideMs) toastTimer = setTimeout(hideToast, autoHideMs);
    }
    function hideToast() {
        clearTimeout(toastTimer);
        toast.classList.remove('show');
    }

    // Consecutive taps on the same side keep adding time, YouTube-style.
    const combo = { side: null, total: 0, timer: 0 };
    function comboSeek(side) {
        if (combo.side !== side) {
            if (combo.side) ripples[combo.side].classList.remove('show');
            combo.side = side;
            combo.total = 0;
        }
        combo.total += SEEK_STEP;
        seekBy(side === 'left' ? -SEEK_STEP : SEEK_STEP);
        hideUI();

        const r = ripples[side];
        r.querySelector('.rtext').textContent = `${combo.total} seconds`;
        r.classList.add('show');

        clearTimeout(combo.timer);
        combo.timer = setTimeout(() => {
            r.classList.remove('show');
            combo.side = null;
            combo.total = 0;
        }, 700);
    }

    /* =============================
       GESTURES (tap / double-tap / swipe / long-press)
    ============================== */
    function getZone(x) {
        const rect = gesture.getBoundingClientRect();
        const rel = (x - rect.left) / rect.width;
        if (rel < 0.35) return 'left';
        if (rel > 0.65) return 'right';
        return 'center';
    }

    function swipeScale() {
        const d = current && current.duration;
        return isFinite(d) ? clamp(d * 0.25, 60, 600) : 60;
    }

    let g = null;
    let lastTapTime = 0;
    let singleTapTimer = 0;

    function handleTap(x) {
        const zone = getZone(x);
        const now = Date.now();

        // Already in a seek combo: every tap on that side adds more.
        if (combo.side && zone === combo.side) {
            comboSeek(zone);
            return;
        }

        if (now - lastTapTime < DOUBLE_TAP_MS) {
            clearTimeout(singleTapTimer);
            lastTapTime = 0;
            if (zone === 'center') togglePlay();
            else comboSeek(zone);
            return;
        }

        // Wait briefly so a double-tap doesn't flash the controls.
        lastTapTime = now;
        clearTimeout(singleTapTimer);
        singleTapTimer = setTimeout(() => {
            lastTapTime = 0;
            toggleUI();
        }, DOUBLE_TAP_MS);
    }

    gesture.addEventListener('pointerdown', (e) => {
        if (!e.isPrimary || !current) return;
        gesture.setPointerCapture(e.pointerId);
        g = {
            x: e.clientX,
            y: e.clientY,
            mode: 'tap',
            start: current.currentTime,
            target: current.currentTime,
            lp: setTimeout(() => {
                if (g && g.mode === 'tap' && !current.paused) {
                    g.mode = 'boost';
                    clearTimeout(singleTapTimer);
                    lastTapTime = 0;
                    startBoost();
                }
            }, LONG_PRESS_MS),
        };
    });

    gesture.addEventListener('pointermove', (e) => {
        if (!g || !e.isPrimary) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;

        if (g.mode === 'tap' && Math.hypot(dx, dy) > 12) {
            clearTimeout(g.lp);
            g.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'none';
        }

        if (g.mode === 'swipe') {
            const d = current.duration;
            const offset = (dx / gesture.clientWidth) * swipeScale();
            g.target = isFinite(d) ? clamp(g.start + offset, 0, d) : Math.max(0, g.start + offset);
            showToast(formatTime(g.target), formatDelta(g.target - g.start));
        }
    });

    function endGesture(e, cancelled) {
        if (!g || !e.isPrimary) return;
        const gs = g;
        g = null;
        clearTimeout(gs.lp);

        if (gs.mode === 'boost') {
            stopBoost();
        } else if (gs.mode === 'swipe') {
            hideToast();
            if (!cancelled && Math.abs(gs.target - gs.start) > 0.5) seekTo(gs.target);
        } else if (gs.mode === 'tap' && !cancelled) {
            handleTap(e.clientX);
        }
    }
    gesture.addEventListener('pointerup', (e) => endGesture(e, false));
    gesture.addEventListener('pointercancel', (e) => endGesture(e, true));
    gesture.addEventListener('contextmenu', (e) => e.preventDefault());

    /* =============================
       SEEK BAR SCRUBBING
    ============================== */
    function updateScrub(e) {
        const r = track.getBoundingClientRect();
        scrubTime = clamp((e.clientX - r.left) / r.width, 0, 1) * current.duration;
        showToast(formatTime(scrubTime), formatDelta(scrubTime - current.currentTime));
        render();
    }

    bar.addEventListener('pointerdown', (e) => {
        if (!current || !isFinite(current.duration)) return;
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        scrubbing = true;
        bar.classList.add('drag');
        clearTimeout(hideTimer);
        updateScrub(e);
    });
    bar.addEventListener('pointermove', (e) => {
        if (scrubbing) updateScrub(e);
    });
    function endScrub() {
        if (!scrubbing) return;
        scrubbing = false;
        bar.classList.remove('drag');
        hideToast();
        seekTo(scrubTime);
        scheduleHide();
    }
    bar.addEventListener('pointerup', endScrub);
    bar.addEventListener('pointercancel', endScrub);

    /* =============================
       SPEED SHEET
    ============================== */
    function openSheet() {
        if (!current) return;
        sheetOpen = true;
        chips.forEach((c) => c.classList.toggle('sel', Number(c.dataset.speed) === current.playbackRate));
        sheet.classList.add('open');
        backdrop.classList.add('open');
        clearTimeout(hideTimer);
    }

    function closeSheet() {
        if (!sheetOpen) return;
        sheetOpen = false;
        sheet.classList.remove('open');
        backdrop.classList.remove('open');
        scheduleHide();
    }

    backdrop.addEventListener('click', closeSheet);
    sheet.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        setSpeed(Number(chip.dataset.speed));
        closeSheet();
    });

    /* =============================
       BUTTONS
    ============================== */
    ui.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        e.stopPropagation();

        switch (btn.dataset.act) {
            case 'close': close(); return;
            case 'play': togglePlay(); break;
            case 'back': seekBy(-SEEK_STEP); break;
            case 'fwd': seekBy(SEEK_STEP); break;
            case 'speed': openSheet(); return;
            case 'fs': toggleFullscreen(); break;
            case 'rotate': rotate(); break;
        }
        showUI();
    });

    /* =============================
       FULLSCREEN + ORIENTATION
    ============================== */
    function enterFullscreen() {
        if (document.fullscreenElement || !overlay.requestFullscreen) return;
        overlay.requestFullscreen({ navigationUI: 'hide' }).catch(() => { });
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
        else enterFullscreen();
    }

    // Orientation can only be locked while fullscreen (Android Chrome/Firefox).
    // Uses the user's choice from the rotate button, else landscape for wide videos.
    function applyOrientation() {
        const mode = orientationMode || (current.videoWidth > current.videoHeight ? 'landscape' : null);
        if (!mode) return Promise.resolve();
        if (!screen.orientation || !screen.orientation.lock) return Promise.reject(new Error('unsupported'));
        return screen.orientation.lock(mode);
    }

    function rotate() {
        const isLandscape = screen.orientation
            ? screen.orientation.type.startsWith('landscape')
            : innerWidth > innerHeight;
        orientationMode = isLandscape ? 'portrait' : 'landscape';
        showToast(orientationMode === 'landscape' ? 'Landscape' : 'Portrait', '', 900);

        if (document.fullscreenElement) {
            applyOrientation().catch(() => showToast('Rotation not supported', '', 1200));
        } else {
            enterFullscreen(); // fullscreenchange applies the lock
        }
    }

    document.addEventListener('fullscreenchange', () => {
        if (!current) return;
        if (document.fullscreenElement) {
            applyOrientation().catch(() => { });
        } else {
            try { screen.orientation.unlock(); } catch (e) { /* not supported */ }
        }
        render();
    });

    /* =============================
       OPEN / CLOSE
    ============================== */
    function open(video) {
        if (current || !video) return;
        current = video;
        saved = {
            parent: video.parentNode,
            next: video.nextSibling,
            style: video.getAttribute('style'),
            controls: video.controls,
        };

        video.controls = false;
        video.setAttribute('style',
            'width:100%;height:100%;max-width:none;max-height:none;object-fit:contain;' +
            'margin:0;padding:0;position:static;transform:none;display:block;background:#000;');
        stage.appendChild(video);

        listeners = new AbortController();
        const opt = { signal: listeners.signal };
        video.addEventListener('pause', () => { showUI(); render(); }, opt);
        video.addEventListener('ended', () => { showUI(); render(); }, opt);
        video.addEventListener('play', () => { scheduleHide(); render(); }, opt);

        overlay.classList.add('open');
        refreshFab();

        // Let the Android back button close the player instead of leaving the page.
        try {
            history.pushState({ vpcOpen: true }, '');
            pushedHistory = true;
        } catch (e) { pushedHistory = false; }

        enterFullscreen();
        cancelAnimationFrame(rafId);
        loop();
        showUI();
    }

    async function close(fromPopstate = false) {
        if (!current) return;
        const video = current;
        current = null;

        listeners.abort();
        cancelAnimationFrame(rafId);
        clearTimeout(hideTimer);
        clearTimeout(singleTapTimer);
        stopBoost();
        closeSheet();
        hideToast();
        g = null;

        // Firefox Android needs fullscreen fully exited before the overlay goes away.
        if (document.fullscreenElement) {
            try { await document.exitFullscreen(); } catch (e) { /* ignore */ }
        }
        try { screen.orientation.unlock(); } catch (e) { /* not supported */ }

        overlay.classList.remove('open');
        hideUI();

        if (saved.style === null) video.removeAttribute('style');
        else video.setAttribute('style', saved.style);
        video.controls = saved.controls;
        if (saved.parent) {
            if (saved.next && saved.next.parentNode === saved.parent) saved.parent.insertBefore(video, saved.next);
            else saved.parent.appendChild(video);
        }
        saved = null;

        if (pushedHistory && !fromPopstate) {
            pushedHistory = false;
            history.back();
        }
        refreshFab();
    }

    window.addEventListener('popstate', () => {
        if (pushedHistory) {
            pushedHistory = false;
            close(true);
        }
    });

    /* =============================
       KEYBOARD (desktop / BT keyboards)
    ============================== */
    document.addEventListener('keydown', (e) => {
        if (!current) return;
        const handled = {
            ' ': togglePlay,
            k: togglePlay,
            ArrowLeft: () => seekBy(-SEEK_STEP),
            j: () => seekBy(-SEEK_STEP),
            ArrowRight: () => seekBy(SEEK_STEP),
            l: () => seekBy(SEEK_STEP),
            f: toggleFullscreen,
            Escape: () => (sheetOpen ? closeSheet() : close()),
        }[e.key];
        if (!handled) return;
        e.preventDefault();
        e.stopPropagation();
        handled();
        showUI();
    }, true);

    /* =============================
       FLOATING BUTTON
    ============================== */
    const pageVideos = document.getElementsByTagName('video'); // live collection

    function pickVideo() {
        const vids = [...pageVideos];
        const playing = vids.find((v) => !v.paused && !v.ended && v.readyState > 2);
        if (playing) return playing;

        let best = null;
        let bestArea = -1;
        for (const v of vids) {
            const r = v.getBoundingClientRect();
            const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
            const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
            if (w * h > bestArea) {
                bestArea = w * h;
                best = v;
            }
        }
        return best;
    }

    function refreshFab() {
        if (!host.isConnected) document.documentElement.appendChild(host);
        fab.hidden = !!current || pageVideos.length === 0;
    }

    fab.addEventListener('click', () => open(pickVideo()));

    let scrollTimer = 0;
    window.addEventListener('scroll', () => {
        fab.classList.add('away');
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => fab.classList.remove('away'), 700);
    }, { passive: true });

    let refreshQueued = false;
    new MutationObserver(() => {
        if (refreshQueued) return;
        refreshQueued = true;
        setTimeout(() => {
            refreshQueued = false;
            refreshFab();
        }, 300);
    }).observe(document.documentElement, { childList: true, subtree: true });

    refreshFab();
})();
