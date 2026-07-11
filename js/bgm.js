// ============================================================
// bgm.js — BGM（WebAudioでループ生成、外部ファイル不要・オフライン動作）
// Am→F→C→G の4小節ループ。ベース＋パッド＋アルペジオ＋ときどきリード。
// ヘッダーの🎵ボタンでON/OFF（localStorageに保存）。
// ブラウザの自動再生制限があるため、ONで保存されていても実際の再生開始は
// 「最初のクリック等のユーザー操作」を待つ（init が pointerdown を1回だけ拾う）。
// ============================================================
"use strict";

const BGM = (() => {
  const KEY = "mana-circuit-bgm"; // ON/OFF はプレイヤー共通
  let ctx = null, master = null, timer = null;
  let nextTime = 0, step = 0;
  let enabled = false; // ユーザーの希望（ONでも再生開始はユーザー操作後）
  let playing = false;

  const TEMPO = 92;
  const STEP_SEC = 60 / TEMPO / 2; // 8分音符1つの長さ
  // コード進行（MIDIノート番号）: Am → F → C → G
  const CHORDS = [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [48, 52, 55], // C
    [55, 59, 62], // G
  ];
  const ARP_ORDER = [0, 1, 2, 1, 0, 1, 2, 1]; // アルペジオの巡回（8分×8＝1小節）
  const LEAD_SCALE = [69, 72, 74, 76, 79, 81]; // Aマイナーペンタトニック（高域）

  const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);

  function voice(freq, t, dur, type, vol) {
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch (e) { /* 音は失敗しても無視 */ }
  }

  // 1ステップ（8分音符）分の音を予約する
  function scheduleStep(s, t) {
    const bar = Math.floor(s / 8) % CHORDS.length;
    const pos = s % 8;
    const ch = CHORDS[bar];
    // パッド: 小節頭で和音を長く柔らかく
    if (pos === 0) ch.forEach(n => voice(midiHz(n), t, STEP_SEC * 7.6, "triangle", 0.016));
    // ベース: 4分音符でルートを刻む
    if (pos % 2 === 0) voice(midiHz(ch[0] - 24), t, STEP_SEC * 1.7, "sine", 0.055);
    // アルペジオ: 8分音符でコードトーンを1オクターブ上で巡回
    voice(midiHz(ch[ARP_ORDER[pos]] + 12), t, STEP_SEC * 0.9, "sine", 0.02);
    // リード: 決定論的な擬似乱数（ステップ番号のハッシュ）でときどき歌う
    const h = (s * 2654435761) >>> 0;
    if (h % 7 < 2) voice(midiHz(LEAD_SCALE[h % LEAD_SCALE.length]), t, STEP_SEC * 1.8, "triangle", 0.017);
  }

  function start() {
    if (playing) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    playing = true;
    step = 0;
    nextTime = ctx.currentTime + 0.1;
    // 先読みスケジューラ: 0.4秒先まで音を予約し続ける（タブが重くても途切れにくい）
    timer = setInterval(() => {
      if (!playing) return;
      while (nextTime < ctx.currentTime + 0.4) {
        scheduleStep(step, nextTime);
        step++;
        nextTime += STEP_SEC;
      }
    }, 150);
  }

  function stop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(KEY, enabled ? "1" : "0"); } catch (e) { /* 無視 */ }
      if (enabled) start(); else stop(); // ボタンクリック＝ユーザー操作なのでそのまま再生できる
      return enabled;
    },
    // 起動時に呼ぶ。保存がONなら最初のユーザー操作（クリック等）で再生を開始する
    init() {
      try { enabled = localStorage.getItem(KEY) === "1"; } catch (e) { enabled = false; }
      if (enabled) {
        const arm = () => { if (enabled) start(); document.removeEventListener("pointerdown", arm); };
        document.addEventListener("pointerdown", arm);
      }
      return enabled;
    },
  };
})();
