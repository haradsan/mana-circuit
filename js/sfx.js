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
    // カードをめくる（フリップ）: 短い上昇スウィッシュ
    flip()   { tone(420, 0.07, "triangle", 0.04, 0, 320); },
    // ドロー: フリップより柔らかい上昇音
    draw()   { tone(620, 0.09, "sine", 0.04, 0, 240); },
    // 🧭方向の決定（v31・盤面で行き先のマスを選んだとき）: 短く硬い「カツン」
    step()   { tone(520, 0.05, "square", 0.035); tone(780, 0.07, "square", 0.03, 0.04); },
    // v35: 駒が1マス跳ねるたびの小さな足音（乱数を使わない＝テストの乱数スタブを乱さない）
    hop()    { tone(330, 0.045, "triangle", 0.03, 0, 90); },
    // v35: バトル演出用 — 斬撃（高→低のノイズ風）・魔法弾（上昇のきらめき）・会心（重い一撃＋高音）・防がれた（鈍い金属音）
    slash()  { tone(900, 0.07, "sawtooth", 0.045, 0, -600); tone(180, 0.1, "square", 0.04, 0.03, -80); },
    magic()  { tone(600, 0.12, "sine", 0.05, 0, 700); tone(1200, 0.14, "triangle", 0.03, 0.06, 400); },
    crit()   { tone(120, 0.22, "sawtooth", 0.07, 0, -60); tone(1568, 0.18, "square", 0.035, 0.05); tone(2093, 0.22, "sine", 0.03, 0.12); },
    block()  { tone(260, 0.09, "square", 0.04); tone(240, 0.12, "triangle", 0.035, 0.05); },
    // v35: 手番の開始（ターンの帯が出るとき）: 2音の短いチャイム
    turn()   { tone(660, 0.1, "triangle", 0.04); tone(990, 0.16, "triangle", 0.035, 0.09); },
    // v35: 大きな決着（撃破・制圧）
    ko()     { tone(300, 0.1, "sawtooth", 0.06, 0, -200); tone(150, 0.3, "triangle", 0.05, 0.08, -60); },
    // パック開封: 破く音＋きらめき
    pack()   { tone(180, 0.16, "sawtooth", 0.05, 0, 140); tone(760, 0.1, "sine", 0.05, 0.14); tone(1140, 0.16, "sine", 0.05, 0.24); },
    // レア度に応じためくり音（rare以上は華やかに）
    reveal(rarity) {
      if (rarity === "legendary") { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.16, "triangle", 0.055, i * 0.09)); }
      else if (rarity === "rare") { tone(880, 0.1, "sine", 0.05); tone(1320, 0.16, "sine", 0.05, 0.09); }
      else this.flip();
    },
    // 勝利の祝福: ハープ風の上昇アルペジオ＋高音のきらめき
    bless()  {
      [659, 784, 988, 1319, 1568].forEach((f, i) => tone(f, 0.5, "sine", 0.045, i * 0.1));
      tone(2093, 0.9, "sine", 0.022, 0.55);
      tone(2637, 0.7, "sine", 0.016, 0.75);
    },
  };
})();
