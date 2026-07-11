// ============================================================
// sfx.js — 効果音（WebAudioで合成、外部ファイル不要）
// ============================================================
"use strict";

const SFX = (() => {
  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { enabled = false; return null; }
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // 単音。slide指定で周波数スライド
  function tone(freq, dur = 0.1, type = "square", vol = 0.04, delay = 0, slide = 0) {
    try {
      const c = ac();
      if (!c || !enabled) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* 音は失敗しても無視 */ }
  }

  return {
    toggle() { enabled = !enabled; return enabled; },
    get enabled() { return enabled; },
    dice()   { tone(700 + Math.random() * 300, 0.04, "square", 0.03); },
    coin()   { tone(880, 0.07, "sine", 0.05); tone(1320, 0.12, "sine", 0.05, 0.07); },
    summon() { tone(440, 0.1, "triangle", 0.05); tone(660, 0.14, "triangle", 0.05, 0.09); },
    hit()    { tone(160, 0.12, "sawtooth", 0.06, 0, -60); },
    destroy(){ tone(220, 0.25, "sawtooth", 0.06, 0, -160); },
    spell()  { tone(520, 0.08, "sine", 0.05, 0, 300); tone(820, 0.15, "sine", 0.04, 0.1, 200); },
    win()    { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "triangle", 0.06, i * 0.14)); },
    lose()   { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, "triangle", 0.05, i * 0.16)); },
  };
})();
