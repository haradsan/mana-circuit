// ============================================================
// art.js — カード・盤面のビジュアル素材（インラインSVG生成・外部ファイル不要）
//
// カードの「絵」は【シルエット＋魔力光】のスタイルで統一する。
// クリーチャーは「アーキタイプ（基本形）× 属性パレット × オプション」の組み合わせで
// 全70種をカバーし、名前に合った造形（ドラゴン・狼・ゴーレム・人魚…）を出し分ける。
// 個別の描き込みを強化したいときは CREATURE_ART の指定を差し替えるだけでよい
// （進め方は CREATURE_ART_PLAN.md 参照）。
// ============================================================
"use strict";

// ---------- パレット（属性ごとの背景・光・シルエット色） ----------
const ART_PAL = {
  fire:    { bg1: "#5c2317", bg2: "#1d0d09", glow: "#ffb37c", sil: "#200c07", line: "#ff7a45" },
  wood:    { bg1: "#27511b", bg2: "#0e1c0a", glow: "#a8e97c", sil: "#0e1a08", line: "#6cc24a" },
  earth:   { bg1: "#523d1e", bg2: "#1a130a", glow: "#eec27c", sil: "#181005", line: "#c89a55" },
  water:   { bg1: "#1c3a62", bg2: "#0a1626", glow: "#8cc8ff", sil: "#081120", line: "#4da3ff" },
  neutral: { bg1: "#3d3654", bg2: "#161221", glow: "#d9d2f2", sil: "#120e1e", line: "#a49ac9" },
  item:    { bg1: "#4d3d20", bg2: "#191307", glow: "#ffd76a", sil: "#171004", line: "#d9a94e" },
  spell:   { bg1: "#402457", bg2: "#150c1f", glow: "#d9a6ff", sil: "#150a20", line: "#b06fd6" },
};

// ---------- 共通defs（グラデーション類）: 起動時に1回だけbodyへ注入 ----------
// インラインSVGは同一ドキュメント内なら url(#id) で共有defsを参照できる。
// カードごとにdefsを埋め込むとidが重複するため、ここに一元化する。
function artDefsSVG() {
  const bgGrads = Object.entries(ART_PAL).map(([k, p]) =>
    `<radialGradient id="agBG-${k}" cx="50%" cy="35%" r="80%">
       <stop offset="0%" stop-color="${p.bg1}"/><stop offset="100%" stop-color="${p.bg2}"/>
     </radialGradient>`).join("");
  // 盤面の土地タイル用（縦グラデーション・属性色を暗めに敷く）
  const tileGrads = ["fire", "wood", "earth", "water"].map(k => {
    const p = ART_PAL[k];
    return `<linearGradient id="tg-${k}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.bg1}" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="${p.bg2}" stop-opacity="0.95"/></linearGradient>`;
  }).join("");
  return `<svg id="global-art-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    ${bgGrads}${tileGrads}
    <linearGradient id="agGold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffe9a0"/><stop offset="55%" stop-color="#d9a94e"/><stop offset="100%" stop-color="#8a6620"/>
    </linearGradient>
    <radialGradient id="agBack" cx="50%" cy="42%" r="75%">
      <stop offset="0%" stop-color="#332a52"/><stop offset="70%" stop-color="#1c1630"/><stop offset="100%" stop-color="#120e1f"/>
    </radialGradient>
    <linearGradient id="tg-castle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5a4a1e"/><stop offset="100%" stop-color="#241c08"/>
    </linearGradient>
    <linearGradient id="tg-special" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#332b48"/><stop offset="100%" stop-color="#1e1930"/>
    </linearGradient>
    <radialGradient id="tokP0" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#b8dcff"/><stop offset="60%" stop-color="#4da3ff"/><stop offset="100%" stop-color="#1d4f9c"/>
    </radialGradient>
    <radialGradient id="tokP1" cx="35%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#ffc4b8"/><stop offset="60%" stop-color="#ff5b5b"/><stop offset="100%" stop-color="#9c221d"/>
    </radialGradient>
  </defs></svg>`;
}
document.addEventListener("DOMContentLoaded", () => {
  document.body.insertAdjacentHTML("beforeend", artDefsSVG());
});

// ---------- カードバック／パック／タイトル紋章 ----------
// クリーチャーアートと同じ「シルエット＋魔力光」様式で統一するため、
// ARCH（造形）定義の後＝ファイル末尾でまとめて定義する（実行時参照なので順序は自由）。

// ============================================================
// クリーチャーのアーキタイプ（基本形）
// 各関数は 120×70 のシーンに置くシルエット図形群を返す。
// 呼び出し側で <g fill=シルエット色 stroke=輪郭光> に包むため、
// 光らせたいパーツ（目・角・炎など）だけ fill/stroke を明示上書きする。
// ============================================================
const _eye = (p, x, y, r = 1.7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.glow}" stroke="none"/>`;
const _spark = (p, x, y, r = 1.2, op = 0.8) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.glow}" stroke="none" opacity="${op}"/>`;
// 全体を拡大するラッパ（bigな個体用）
const _scale = (inner, s, cx = 60, cy = 46) => `<g transform="translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})">${inner}</g>`;

const ARCH = {
  // ドラゴン（右向き・翼を広げた竜）
  dragon(p, o = {}) {
    let s = `
      <path d="M36 54 C20 58 10 48 6 52 C12 60 26 62 40 58 Z"/>
      <path d="M44 42 C30 12 14 18 20 32 C28 27 36 34 46 45 Z" opacity="0.75"/>
      <path d="M52 42 C42 6 24 8 30 26 C38 20 46 30 56 44 Z"/>
      <ellipse cx="58" cy="48" rx="20" ry="10.5"/>
      <path d="M68 44 C74 38 76 32 78 26 L86 24 C84 33 79 43 73 50 Z"/>
      <ellipse cx="84" cy="24" rx="8" ry="5.5"/>
      <path d="M90 21 L101 25 L90 28 Z"/>
      <path d="M80 19 L83 11 L86 19 Z"/>
      <rect x="50" y="55" width="5" height="8" rx="2"/><rect x="64" y="55" width="5" height="8" rx="2"/>
      ${_eye(p, 85, 23)}`;
    if (o.flame) s += `<path d="M101 25 C106 23 109 25 112 22" fill="none" stroke="${p.glow}" stroke-width="1.6" opacity="0.9"/>`;
    return o.big ? _scale(s, 1.12) : s;
  },
  // 大蛇・海竜（S字にうねる長体）
  serpent(p, o = {}) {
    let s = `
      <path d="M12 60 C28 44 40 62 54 48 C66 38 74 40 82 28" fill="none" stroke="${p.sil}" stroke-width="10" stroke-linecap="round"/>
      <path d="M30 50 L33 42 L38 49 Z"/><path d="M52 50 L56 42 L60 50 Z"/>
      <ellipse cx="85" cy="24" rx="7.5" ry="5.5"/>
      <path d="M91 22 L100 24 L91 27 Z"/>
      ${o.hood ? `<path d="M78 16 C74 22 74 30 79 34 L91 32 C94 26 92 18 88 15 Z" opacity="0.9"/>` : ""}
      ${o.fins ? `<path d="M20 52 L18 42 L27 48 Z"/><path d="M64 42 L66 32 L72 40 Z"/>` : ""}
      ${_eye(p, 87, 23)}
      <path d="M96 24 L104 21 M96 24 L103 27" fill="none" stroke="${p.glow}" stroke-width="1.1" opacity="0.9"/>`;
    return o.big ? _scale(s, 1.1) : s;
  },
  // 獣（四足・右向き）。heads=3でケルベロス、tusks/spikes/cat対応
  beast(p, o = {}) {
    const heads = o.heads === 3
      ? `<circle cx="76" cy="28" r="6"/><path d="M81 26 L89 29 L81 32 Z"/>${_eye(p, 78, 27, 1.4)}
         <circle cx="84" cy="36" r="7"/><path d="M90 34 L99 38 L90 41 Z"/>${_eye(p, 86, 35, 1.4)}
         <circle cx="77" cy="45" r="6"/><path d="M82 44 L90 47 L82 50 Z"/>${_eye(p, 79, 44, 1.4)}`
      : `<circle cx="80" cy="34" r="8"/>
         <path d="M73 29 L75 19 L80 27 Z"/><path d="M81 27 L86 19 L88 28 Z"/>
         <path d="M87 33 L97 37 L87 40 Z"/>
         ${o.tusks ? `<path d="M88 39 L95 44 L88 42 Z" fill="${p.glow}" stroke="none" opacity="0.9"/>` : ""}
         ${_eye(p, 82, 33)}`;
    let s = `
      ${o.cat
        ? `<path d="M40 44 C30 38 28 26 34 20" fill="none" stroke="${p.sil}" stroke-width="4" stroke-linecap="round"/>`
        : `<path d="M40 42 C28 36 24 26 28 20 C32 30 38 36 46 40 Z"/>`}
      <ellipse cx="58" cy="46" rx="20" ry="${o.cat ? 8.5 : 10}"/>
      ${heads}
      ${o.spikes ? `<path d="M44 37 L48 29 L52 37 Z"/><path d="M54 36 L58 27 L62 36 Z"/><path d="M64 37 L68 29 L71 38 Z"/>` : ""}
      <rect x="44" y="52" width="4.5" height="11" rx="2"/><rect x="52" y="53" width="4.5" height="10" rx="2"/>
      <rect x="63" y="53" width="4.5" height="10" rx="2"/><rect x="71" y="52" width="4.5" height="11" rx="2"/>`;
    return o.big ? _scale(s, 1.12) : s;
  },
  // トカゲ（低い姿勢・長い尾）
  lizard(p, o = {}) {
    return `
      <path d="M46 54 C30 60 14 58 8 50 C18 54 32 52 46 48 Z"/>
      <ellipse cx="60" cy="51" rx="19" ry="8"/>
      <ellipse cx="84" cy="46" rx="8.5" ry="5.5"/>
      ${o.crest ? `<path d="M78 42 L80 33 L84 41 Z"/><path d="M85 41 L89 34 L91 42 Z"/>` : ""}
      <path d="M91 44 L99 47 L91 49 Z"/>
      <rect x="48" y="55" width="4" height="8" rx="2"/><rect x="58" y="56" width="4" height="7" rx="2"/><rect x="68" y="55" width="4" height="8" rx="2"/>
      ${_eye(p, 86, 45)}
      ${o.flame ? `<path d="M99 47 C104 45 106 47 109 44" fill="none" stroke="${p.glow}" stroke-width="1.4" opacity="0.9"/>` : ""}`;
  },
  // 人型（角・武器・盾・帽子などのオプションで幅広くカバー）
  humanoid(p, o = {}) {
    const parts = [];
    // 頭
    parts.push(`<circle cx="60" cy="21" r="8"/>`);
    if (o.horns) parts.push(`<path d="M53 16 L48 7 L56 12 Z"/><path d="M67 16 L72 7 L64 12 Z"/>`);
    if (o.hat) parts.push(`<path d="M50 16 L60 -2 L70 16 Z"/>`);
    if (o.antlers) parts.push(`<path d="M53 14 C49 8 44 8 42 3 M55 13 C53 8 50 7 49 3 M67 14 C71 8 76 8 78 3 M65 13 C67 8 70 7 71 3" fill="none" stroke="${p.sil}" stroke-width="2.2"/>`);
    if (o.leafhair) parts.push(`<path d="M52 14 C48 8 52 3 58 5 Z"/><path d="M68 14 C72 8 68 3 62 5 Z"/><path d="M60 12 L60 4 L64 9 Z"/>`);
    if (o.kappa) parts.push(`<ellipse cx="60" cy="13" rx="7" ry="2.5" fill="${p.glow}" stroke="none" opacity="0.85"/>`);
    if (o.beard) parts.push(`<path d="M53 24 C54 32 66 32 67 24 L64 27 L60 25 L56 27 Z"/>`);
    // 胴と腕
    parts.push(`<path d="M49 31 L71 31 L67 58 L53 58 Z"/>`);
    parts.push(`<path d="M50 32 L41 46 L46 49 L53 38 Z"/><path d="M70 32 L79 46 L74 49 L67 38 Z"/>`);
    if (o.wings) parts.push(`<path d="M48 32 C38 24 34 16 38 12 C42 20 48 26 54 30 Z" opacity="0.85"/><path d="M72 32 C82 24 86 16 82 12 C78 20 72 26 66 30 Z" opacity="0.85"/>`);
    // 目
    parts.push(_eye(p, 57, 20, 1.4) + _eye(p, 63, 20, 1.4));
    // 武器・持ち物（右手 = 画面右側 x≈78）
    if (o.axe) parts.push(`<rect x="76" y="20" width="3" height="30" rx="1.5"/><path d="M79 23 C90 25 90 37 79 39 Z"/>`);
    if (o.club) parts.push(`<path d="M76 46 L84 18 C89 16 92 20 90 24 L82 48 Z"/>`);
    if (o.trident) parts.push(`<rect x="76" y="16" width="2.6" height="34" rx="1.3"/><path d="M72 16 L72 8 M77.3 14 L77.3 6 M83 16 L83 8" fill="none" stroke="${p.sil}" stroke-width="2.4"/>`);
    if (o.staff) parts.push(`<rect x="76" y="18" width="2.6" height="32" rx="1.3"/><circle cx="77.3" cy="14" r="4" fill="${p.glow}" stroke="none" opacity="0.9"/>`);
    if (o.sword) parts.push(`<path d="M77 44 L74 16 L80 16 L81 44 Z"/><rect x="72" y="42" width="12" height="3" rx="1.5"/>`);
    if (o.shield) parts.push(`<path d="M40 36 C48 38 48 52 40 58 C32 52 32 38 40 36 Z"/><circle cx="40" cy="46" r="2.5" fill="${p.glow}" stroke="none" opacity="0.8"/>`);
    if (o.ribbon) parts.push(`<path d="M46 36 C34 30 30 40 24 36 M74 40 C86 46 92 38 98 44" fill="none" stroke="${p.glow}" stroke-width="2" opacity="0.75"/>`);
    if (o.genie) parts.push(`<path d="M53 56 C44 62 56 66 48 70 C64 68 70 62 67 54 Z"/><path d="M58 12 C58 6 62 6 62 1 C66 6 64 10 62 13 Z" fill="${p.glow}" stroke="none" opacity="0.85"/>`);
    let s = parts.join("");
    if (o.small) s = _scale(s, 0.82, 60, 40);
    if (o.big) s = _scale(s, 1.14, 60, 40);
    return s;
  },
  // ゴーレム（岩・鉄・泥の巨体）
  golem(p, o = {}) {
    const body = o.blob
      ? `<path d="M42 56 C38 36 50 26 60 26 C70 26 82 36 78 56 C70 60 50 60 42 56 Z"/>
         <path d="M50 30 C50 20 70 20 70 30 Z"/>`
      : `<rect x="44" y="29" width="32" height="25" rx="5"/>
         <rect x="52" y="15" width="16" height="13" rx="3"/>
         <rect x="29" y="31" width="13" height="20" rx="4"/><rect x="78" y="31" width="13" height="20" rx="4"/>
         <rect x="47" y="54" width="10" height="10" rx="2"/><rect x="63" y="54" width="10" height="10" rx="2"/>`;
    const eyes = o.blob
      ? _eye(p, 55, 36, 1.8) + _eye(p, 65, 36, 1.8)
      : `<rect x="55.5" y="19.5" width="3.2" height="3.2" fill="${p.glow}" stroke="none"/><rect x="61.5" y="19.5" width="3.2" height="3.2" fill="${p.glow}" stroke="none"/>`;
    let extra = "";
    if (o.veins) extra = `<path d="M48 38 L56 44 L52 50 M66 34 L62 42 L70 48" fill="none" stroke="${p.glow}" stroke-width="1.4" opacity="0.9"/>`;
    if (o.moss) extra = `<circle cx="48" cy="28" r="3" fill="${p.glow}" stroke="none" opacity="0.55"/><circle cx="72" cy="30" r="2.5" fill="${p.glow}" stroke="none" opacity="0.55"/><circle cx="58" cy="13" r="2.5" fill="${p.glow}" stroke="none" opacity="0.55"/>`;
    if (o.shine) extra = `<path d="M48 34 L54 34 M66 40 L73 40 M50 47 L58 47" fill="none" stroke="${p.glow}" stroke-width="1.3" opacity="0.85"/>`;
    if (o.crown) extra += `<path d="M52 15 L54 9 L58 13 L60 7 L62 13 L66 9 L68 15 Z" fill="${p.glow}" stroke="none" opacity="0.9"/>`;
    let s = body + eyes + extra;
    return o.big ? _scale(s, 1.1, 60, 42) : s;
  },
  // 樹木（トレント・世界樹）
  tree(p, o = {}) {
    const face = o.face ? _eye(p, 55, 40, 1.8) + _eye(p, 64, 40, 1.8) +
      `<path d="M56 47 C58 49 62 49 64 47" fill="none" stroke="${p.glow}" stroke-width="1.2" opacity="0.8"/>` : "";
    const fruits = o.grand ? [_spark(p, 46, 18, 1.6), _spark(p, 66, 12, 1.6), _spark(p, 76, 24, 1.6), _spark(p, 54, 26, 1.4)].join("") : "";
    let s = `
      <path d="M52 62 L54 34 C49 30 46 24 48 19 L56 28 L58 16 L62 28 L70 20 C73 25 69 31 65 34 L67 62 Z"/>
      <path d="M46 62 C42 58 38 60 34 57 L48 58 Z"/><path d="M74 62 C78 58 82 60 86 57 L72 58 Z"/>
      <circle cx="45" cy="21" r="12"/><circle cx="61" cy="13" r="12"/><circle cx="76" cy="23" r="10"/><circle cx="58" cy="26" r="9"/>
      ${face}${fruits}`;
    return (o.big || o.grand) ? _scale(s, 1.12, 60, 40) : s;
  },
  // 芽・小さな植物
  sprout(p) {
    return `
      <path d="M60 60 L60 38" fill="none" stroke="${p.sil}" stroke-width="4" stroke-linecap="round"/>
      <path d="M60 46 C50 44 44 36 46 28 C56 30 60 38 60 46 Z"/>
      <path d="M60 42 C70 40 76 32 74 24 C64 26 60 34 60 42 Z"/>
      <circle cx="60" cy="34" r="6" fill="${p.glow}" stroke="none" opacity="0.85"/>
      ${_spark(p, 52, 24, 1.2)}${_spark(p, 70, 18, 1.2)}`;
  },
  // 食虫植物（マンイーター）
  jawplant(p) {
    return `
      <path d="M52 62 C50 52 52 46 58 40" fill="none" stroke="${p.sil}" stroke-width="5" stroke-linecap="round"/>
      <path d="M58 38 C52 28 60 18 74 20 C86 22 90 30 84 36 L62 42 Z"/>
      <path d="M60 44 C56 54 68 60 80 56 C90 52 90 44 84 40 L64 42 Z"/>
      <path d="M62 40 L66 36 L70 40 L74 36 L78 40 L82 37" fill="none" stroke="${p.glow}" stroke-width="1.6" opacity="0.9"/>
      <path d="M44 58 C36 54 32 56 28 52 L46 54 Z"/><path d="M52 60 C46 62 42 66 36 66 L52 62 Z"/>
      ${_eye(p, 76, 27, 1.5)}`;
  },
  // 茨のツル
  vines(p) {
    return `
      <path d="M20 62 C32 48 24 38 38 30 C50 24 46 14 58 10" fill="none" stroke="${p.sil}" stroke-width="5" stroke-linecap="round"/>
      <path d="M52 62 C60 50 76 54 84 42 C90 32 100 34 104 26" fill="none" stroke="${p.sil}" stroke-width="5" stroke-linecap="round"/>
      <path d="M32 42 L26 38 L33 37 Z"/><path d="M44 26 L40 20 L48 22 Z"/><path d="M72 52 L66 48 L73 46 Z"/><path d="M92 34 L88 28 L96 30 Z"/>
      ${_spark(p, 58, 8, 1.6)}${_spark(p, 104, 24, 1.6)}`;
  },
  // 根の人形（マンドレイク）
  rootman(p) {
    return `
      <path d="M60 12 C50 12 46 22 50 30 L52 44 C54 56 66 56 68 44 L70 30 C74 22 70 12 60 12 Z"/>
      <path d="M54 12 C50 6 54 2 58 4 Z"/><path d="M66 12 C70 6 66 2 62 4 Z"/><path d="M60 10 L60 2 L64 6 Z"/>
      <path d="M54 52 C50 58 46 60 42 64 M66 52 C70 58 74 60 78 64 M60 56 L60 66" fill="none" stroke="${p.sil}" stroke-width="3.5" stroke-linecap="round"/>
      ${_eye(p, 56, 26, 1.5)}${_eye(p, 64, 26, 1.5)}`;
  },
  // 大輪の花（アルラウネ）
  flower(p) {
    const petal = a => `<ellipse cx="60" cy="30" rx="7" ry="16" transform="rotate(${a} 60 42)"/>`;
    return `
      ${[0, 60, 120, 180, 240, 300].map(petal).join("")}
      <circle cx="60" cy="42" r="9" fill="${p.glow}" stroke="none" opacity="0.9"/>
      <path d="M57 40 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0" fill="${p.sil}" stroke="none"/>
      <path d="M60 52 L60 64" fill="none" stroke="${p.sil}" stroke-width="4" stroke-linecap="round"/>
      <path d="M60 58 C50 56 46 60 40 58 L58 62 Z"/>`;
  },
  // 妖精・精霊（wings:falseでコダマ等の精霊）
  fairy(p, o = {}) {
    const wings = o.wings === false ? "" :
      `<ellipse cx="49" cy="32" rx="9" ry="15" transform="rotate(-24 49 32)" fill="${p.glow}" stroke="none" opacity="0.32"/>
       <ellipse cx="71" cy="32" rx="9" ry="15" transform="rotate(24 71 32)" fill="${p.glow}" stroke="none" opacity="0.32"/>
       <ellipse cx="51" cy="42" rx="6" ry="10" transform="rotate(-32 51 42)" fill="${p.glow}" stroke="none" opacity="0.22"/>
       <ellipse cx="69" cy="42" rx="6" ry="10" transform="rotate(32 69 42)" fill="${p.glow}" stroke="none" opacity="0.22"/>`;
    const head = o.bighead ? `<circle cx="60" cy="27" r="9"/>` : `<circle cx="60" cy="26" r="5.5"/>`;
    return `
      ${wings}${head}
      <path d="M55 ${o.bighead ? 36 : 32} L65 ${o.bighead ? 36 : 32} L62 54 L58 54 Z"/>
      ${_eye(p, 57.5, o.bighead ? 26 : 25, 1.3)}${_eye(p, 62.5, o.bighead ? 26 : 25, 1.3)}
      ${_spark(p, 44, 18, 1.5)}${_spark(p, 78, 22, 1.3)}${_spark(p, 70, 52, 1.2)}${_spark(p, 48, 50, 1.1)}`;
  },
  // 亀（甲羅の壁）
  turtle(p, o = {}) {
    return `
      <path d="M34 52 A26 20 0 0 1 86 52 Z"/>
      <path d="M44 52 A16 13 0 0 1 76 52 M52 52 A8 12 0 0 1 68 52 M60 33 L60 52" fill="none" stroke="${p.glow}" stroke-width="1" opacity="${o.plated ? 0.7 : 0.35}"/>
      <ellipse cx="91" cy="49" rx="7" ry="5"/>
      <rect x="40" y="52" width="7" height="8" rx="3"/><rect x="72" y="52" width="7" height="8" rx="3"/>
      ${_eye(p, 93, 48, 1.4)}`;
  },
  // カニ（シェルクラブ）
  crab(p) {
    return `
      <ellipse cx="60" cy="46" rx="18" ry="11"/>
      <path d="M44 40 C34 34 28 36 26 28 C34 28 40 32 46 36 Z"/>
      <path d="M28 28 a7 7 0 1 1 6 10 L30 34 Z"/>
      <path d="M76 40 C86 34 92 36 94 28 C86 28 80 32 74 36 Z"/>
      <path d="M92 28 a7 7 0 1 0 -6 10 L90 34 Z"/>
      <path d="M48 55 L42 62 M56 57 L52 64 M64 57 L68 64 M72 55 L78 62" fill="none" stroke="${p.sil}" stroke-width="2.5"/>
      ${_eye(p, 54, 40, 1.5)}${_eye(p, 66, 40, 1.5)}`;
  },
  // 城壁（ストーンウォール・グレートウォール）
  wall(p, o = {}) {
    const x0 = o.wide ? 26 : 36, w = o.wide ? 68 : 48;
    const teeth = [];
    for (let x = x0; x < x0 + w; x += 12) teeth.push(`<rect x="${x}" y="20" width="7" height="8"/>`);
    return `
      ${teeth.join("")}
      <rect x="${x0}" y="27" width="${w}" height="34" rx="2"/>
      <path d="M${x0} 38 H${x0 + w} M${x0} 49 H${x0 + w} M${x0 + 14} 27 V38 M${x0 + 30} 38 V49 M${x0 + 20} 49 V61 M${x0 + w - 12} 27 V38"
        fill="none" stroke="#000" stroke-opacity="0.4" stroke-width="1.2"/>
      <rect x="${x0 + w / 2 - 4}" y="40" width="8" height="12" rx="4" fill="#000" opacity="0.5" stroke="none"/>
      ${_eye(p, x0 + w / 2 - 1.8, 45, 1.3)}${_eye(p, x0 + w / 2 + 1.8, 45, 1.3)}`;
  },
  // 翼を広げた飛翔体（フェニックス・ガーゴイル）
  bird(p, o = {}) {
    if (o.gargoyle) return `
      <path d="M50 40 L28 16 L44 30 L40 14 L52 30 Z"/>
      <path d="M70 40 L92 16 L76 30 L80 14 L68 30 Z"/>
      <ellipse cx="60" cy="44" rx="11" ry="10"/>
      <circle cx="60" cy="30" r="7"/>
      <path d="M54 26 L50 18 L57 22 Z"/><path d="M66 26 L70 18 L63 22 Z"/>
      <path d="M50 52 L46 62 L54 56 Z"/><path d="M70 52 L74 62 L66 56 Z"/>
      ${_eye(p, 57, 29, 1.4)}${_eye(p, 63, 29, 1.4)}`;
    return `
      <path d="M56 38 C42 16 24 12 12 20 C26 24 36 32 48 44 Z"/>
      <path d="M64 38 C78 16 96 12 108 20 C94 24 84 32 72 44 Z"/>
      <ellipse cx="60" cy="42" rx="8" ry="12"/>
      <circle cx="60" cy="26" r="5.5"/>
      <path d="M58 22 L60 14 L63 22 Z"/>
      <path d="M56 53 C54 60 50 64 46 66 M60 54 C60 62 58 66 56 68 M64 53 C66 60 70 64 74 66" fill="none" stroke="${p.sil}" stroke-width="2.5" stroke-linecap="round"/>
      ${o.flame ? `<path d="M46 66 C44 62 46 60 44 57 M74 66 C76 62 74 60 76 57" fill="none" stroke="${p.glow}" stroke-width="1.5" opacity="0.85"/>${_spark(p, 14, 18, 1.6)}${_spark(p, 106, 18, 1.6)}` : ""}
      ${_eye(p, 62, 25, 1.3)}`;
  },
  // クラゲ・クラーケン
  jelly(p, o = {}) {
    const dome = o.big
      ? `<path d="M36 40 A24 22 0 0 1 84 40 L84 46 C76 42 70 48 60 46 C50 48 44 42 36 46 Z"/>`
      : `<path d="M42 40 A18 16 0 0 1 78 40 L78 44 C72 41 66 46 60 44 C54 46 48 41 42 44 Z"/>`;
    const tent = o.big
      ? `<path d="M42 46 C38 54 44 58 40 66 M52 47 C50 56 56 60 52 68 M68 47 C70 56 64 60 68 68 M78 46 C82 54 76 58 80 66 M60 46 C60 56 62 60 60 68" fill="none" stroke="${p.sil}" stroke-width="4" stroke-linecap="round"/>`
      : `<path d="M46 45 C44 52 48 56 46 62 M55 46 C54 54 58 58 55 64 M65 46 C66 54 62 58 65 64 M74 45 C76 52 72 56 74 62" fill="none" stroke="${p.sil}" stroke-width="3" stroke-linecap="round"/>`;
    return `${dome}${tent}
      <circle cx="60" cy="32" r="6" fill="${p.glow}" stroke="none" opacity="0.5"/>
      ${o.big ? _eye(p, 52, 34, 2) + _eye(p, 68, 34, 2) : _spark(p, 60, 32, 2, 0.9)}`;
  },
  // 人魚（マーメイド・セイレーン・ウンディーネ）
  mermaid(p, o = {}) {
    return `
      <circle cx="54" cy="20" r="6.5"/>
      <path d="M48 18 C42 24 44 32 48 36 C46 28 50 22 54 20 Z"/>
      <path d="M50 27 C48 36 50 42 56 46 C64 52 72 52 80 47 C86 52 92 54 96 52 C92 50 90 46 90 42 C82 48 70 48 62 42 C56 38 54 32 56 27 Z"/>
      <path d="M52 30 L44 40 L48 42 L54 34 Z"/>
      ${o.knight ? `<path d="M42 34 C48 36 48 46 42 50 C36 46 36 36 42 34 Z"/><circle cx="42" cy="42" r="2" fill="${p.glow}" stroke="none" opacity="0.85"/>` : ""}
      ${o.song ? `<path d="M70 20 L70 12 M70 12 L75 13 M78 26 L78 18 M78 18 L83 19" fill="none" stroke="${p.glow}" stroke-width="1.6" opacity="0.85"/>${_spark(p, 70, 20, 1.4)}${_spark(p, 78, 26, 1.4)}` : ""}
      ${_eye(p, 56, 19, 1.3)}`;
  },
  // 一角獣・馬
  horse(p, o = {}) {
    return `
      <ellipse cx="56" cy="46" rx="19" ry="10"/>
      <path d="M68 42 C72 32 74 26 78 21 L86 24 C82 30 80 38 74 46 Z"/>
      <path d="M78 18 C84 16 90 18 92 22 C88 24 84 24 80 24 Z"/>
      ${o.horn ? `<path d="M86 18 L98 8 L89 21 Z" fill="${p.glow}" stroke="none" opacity="0.95"/>` : `<path d="M80 16 L82 10 L85 17 Z"/>`}
      <path d="M74 22 C70 28 68 34 66 40" fill="none" stroke="${p.glow}" stroke-width="2" opacity="0.55"/>
      <path d="M38 44 C32 48 30 54 32 60" fill="none" stroke="${p.sil}" stroke-width="3.5" stroke-linecap="round"/>
      <rect x="44" y="52" width="4" height="11" rx="2"/><rect x="52" y="54" width="4" height="9" rx="2"/>
      <rect x="62" y="54" width="4" height="9" rx="2"/><rect x="69" y="52" width="4" height="11" rx="2"/>
      ${_eye(p, 84, 21, 1.3)}`;
  },
  // 甲虫（ボムビートル）
  insect(p, o = {}) {
    return `
      <ellipse cx="56" cy="46" rx="18" ry="12"/>
      <path d="M56 34 L56 58" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="1.4"/>
      <circle cx="78" cy="44" r="6.5"/>
      <path d="M82 40 C88 34 92 36 94 30" fill="none" stroke="${p.sil}" stroke-width="2.4"/>
      <path d="M44 54 L38 62 M52 57 L48 65 M62 57 L66 65 M70 54 L76 62 M46 40 L38 34 M50 36 L44 28" fill="none" stroke="${p.sil}" stroke-width="2.2"/>
      ${o.spark ? `<path d="M42 38 C38 32 40 28 36 24" fill="none" stroke="${p.glow}" stroke-width="1.6" opacity="0.9"/>${_spark(p, 36, 22, 2)}` : ""}
      ${_eye(p, 80, 43, 1.4)}`;
  },
  // キメラ（獅子＋山羊＋蛇尾＋翼）
  chimera(p) {
    return `
      <path d="M36 46 C24 44 18 34 24 26 C28 34 32 38 40 42" fill="none" stroke="${p.sil}" stroke-width="4.5" stroke-linecap="round"/>
      <circle cx="22" cy="26" r="4"/>${_eye(p, 21, 25, 1.1)}
      <ellipse cx="58" cy="46" rx="19" ry="10"/>
      <path d="M56 38 C48 22 34 24 38 12 C46 18 54 24 62 32 Z" opacity="0.9"/>
      <circle cx="80" cy="32" r="8.5"/>
      <path d="M74 26 L70 16 L78 22 Z"/><path d="M84 25 L90 15 L88 25 Z"/>
      <path d="M87 31 L96 35 L87 38 Z"/>
      <circle cx="70" cy="22" r="5.5"/>
      <path d="M66 18 C62 14 62 10 64 8 M74 18 C78 14 78 10 76 8" fill="none" stroke="${p.sil}" stroke-width="2.2"/>
      <rect x="46" y="52" width="4.5" height="11" rx="2"/><rect x="56" y="53" width="4.5" height="10" rx="2"/><rect x="68" y="52" width="4.5" height="11" rx="2"/>
      ${_eye(p, 82, 31)}${_eye(p, 69, 21, 1.2)}`;
  },
};

// ---------- クリーチャー → アーキタイプの割り当て（全70種） ----------
// 個別のビジュアルを強化するときは、この表の1行を専用描画に差し替える（CREATURE_ART_PLAN.md）
const CREATURE_ART = {
  // 火
  imp:          { arch: "humanoid", o: { small: 1, horns: 1, wings: 1 } },
  firelizard:   { arch: "lizard",   o: { flame: 1 } },
  bombeetle:    { arch: "insect",   o: { spark: 1 } },
  flamewolf:    { arch: "beast" },
  hellhound:    { arch: "beast",    o: { spikes: 1 } },
  salamander:   { arch: "lizard",   o: { crest: 1, flame: 1 } },
  flamedancer:  { arch: "humanoid", o: { ribbon: 1 } },
  lavagolem:    { arch: "golem",    o: { veins: 1 } },
  minotaur:     { arch: "humanoid", o: { horns: 1, axe: 1, big: 1 } },
  phoenix:      { arch: "bird",     o: { flame: 1 } },
  efreet:       { arch: "humanoid", o: { genie: 1, horns: 1 } },
  reddragon:    { arch: "dragon",   o: { flame: 1 } },
  hellcat:      { arch: "beast",    o: { cat: 1 } },
  cerberus:     { arch: "beast",    o: { heads: 3, big: 1 } },
  magmagolem:   { arch: "golem",    o: { veins: 1 } },
  vulcandrake:  { arch: "dragon",   o: { big: 1, flame: 1 } },
  // 水
  aquasprite:   { arch: "fairy" },
  merman:       { arch: "humanoid", o: { trident: 1 } },
  frostnaga:    { arch: "serpent",  o: { hood: 1 } },
  shellcrab:    { arch: "crab" },
  undine:       { arch: "mermaid" },
  mermaid:      { arch: "mermaid",  o: { knight: 1 } },
  seaserpent:   { arch: "serpent",  o: { fins: 1 } },
  sirene:       { arch: "mermaid",  o: { song: 1 } },
  frostgiant:   { arch: "humanoid", o: { big: 1, club: 1, beard: 1 } },
  kraken:       { arch: "jelly",    o: { big: 1 } },
  tidallord:    { arch: "humanoid", o: { big: 1, trident: 1, horns: 1 } },
  leviathan:    { arch: "serpent",  o: { big: 1, fins: 1 } },
  abyssturtle:  { arch: "turtle" },
  netjelly:     { arch: "jelly" },
  icesprite:    { arch: "fairy" },
  kappa:        { arch: "humanoid", o: { small: 1, kappa: 1 } },
  seawitch:     { arch: "humanoid", o: { hat: 1, staff: 1 } },
  waterdragon:  { arch: "dragon" },
  // 地
  mudman:       { arch: "golem",    o: { blob: 1 } },
  dwarfguard:   { arch: "humanoid", o: { small: 1, shield: 1, beard: 1 } },
  stonewall:    { arch: "wall" },
  needlemole:   { arch: "beast",    o: { spikes: 1 } },
  rockgolem:    { arch: "golem" },
  basilisk:     { arch: "lizard",   o: { crest: 1 } },
  ogre:         { arch: "humanoid", o: { big: 1, club: 1, horns: 1 } },
  ironturtle:   { arch: "turtle",   o: { plated: 1 } },
  earthdragon:  { arch: "dragon" },
  behemoth:     { arch: "beast",    o: { big: 1, tusks: 1 } },
  gaiatitan:    { arch: "golem",    o: { big: 1, crown: 1, moss: 1 } },
  greatwall:    { arch: "wall",     o: { wide: 1 } },
  maneater:     { arch: "jawplant" },
  gnome:        { arch: "humanoid", o: { small: 1, hat: 1 } },
  goblinaxe:    { arch: "humanoid", o: { small: 1, axe: 1 } },
  clayhulk:     { arch: "golem",    o: { blob: 1, big: 1 } },
  // 木
  treant:       { arch: "tree",     o: { face: 1 } },
  titanoak:     { arch: "tree",     o: { big: 1, face: 1 } },
  kodama:       { arch: "fairy",    o: { wings: false, bighead: 1 } },
  sprout:       { arch: "sprout" },
  thornvine:    { arch: "vines" },
  pixie:        { arch: "fairy" },
  bramblehound: { arch: "beast",    o: { spikes: 1 } },
  mandrake:     { arch: "rootman" },
  dryad:        { arch: "humanoid", o: { leafhair: 1 } },
  woodwolf:     { arch: "beast" },
  mossgiant:    { arch: "golem",    o: { moss: 1, big: 1 } },
  worldtree:    { arch: "tree",     o: { grand: 1 } },
  forestlord:   { arch: "humanoid", o: { big: 1, antlers: 1, staff: 1 } },
  greendragon:  { arch: "dragon" },
  elderent:     { arch: "tree",     o: { face: 1, big: 1 } },
  alraune:      { arch: "flower" },
  // 無
  gargoyle:     { arch: "bird",     o: { gargoyle: 1 } },
  unicorn:      { arch: "horse",    o: { horn: 1 } },
  mithrilgolem: { arch: "golem",    o: { shine: 1 } },
  chimera:      { arch: "chimera" },
  phantom:      { arch: "humanoid", o: { genie: 1 } },
  mirage:       { arch: "fairy" },
  doppelganger: { arch: "humanoid", o: { genie: 1, small: 1 } }, // v17: 影のような写し身
  sphinx:       { arch: "beast",    o: { cat: 1, big: 1 } },     // v17: 獅子身の番人
  // v15: 各属性の術士（魔法攻撃持ち）
  flamemage:    { arch: "humanoid", o: { hat: 1, staff: 1 } },
  druid:        { arch: "humanoid", o: { leafhair: 1, staff: 1 } },
  runedwarf:    { arch: "humanoid", o: { small: 1, beard: 1, staff: 1 } },
  frostwizard:  { arch: "humanoid", o: { hat: 1, staff: 1, beard: 1 } },
};

// ---------- アイテムの造形 ----------
const ITEM_ARCH = {
  sword(p, o = {}) {
    const s = `
      <path d="M60 6 L65 14 L63.5 42 L56.5 42 L55 14 Z"/>
      <path d="M60 12 L60 40" fill="none" stroke="${p.glow}" stroke-width="1" opacity="0.7"/>
      <rect x="49" y="42" width="22" height="4.5" rx="2"/>
      <rect x="57.5" y="46.5" width="5" height="13" rx="2"/>
      <circle cx="60" cy="62" r="3.2"/>
      ${o.ornate ? `<circle cx="60" cy="44" r="2.2" fill="${p.glow}" stroke="none"/>` : ""}`;
    return o.big ? _scale(s, 1.15, 60, 36) : s;
  },
  axe(p, o = {}) {
    return `
      <rect x="58" y="10" width="4" height="52" rx="2"/>
      <path d="M62 14 C78 16 80 32 62 34 Z"/>
      ${o.double ? `<path d="M58 14 C42 16 40 32 58 34 Z"/>` : ""}
      <path d="M66 18 C72 20 72 28 66 30" fill="none" stroke="${p.glow}" stroke-width="1" opacity="0.7"/>`;
  },
  dagger(p, o = {}) {
    const one = (dx, r) => `<g transform="rotate(${r} 60 38) translate(${dx} 0)">
      <path d="M60 14 L63 20 L62 42 L58 42 L57 20 Z"/><rect x="53" y="42" width="14" height="3.5" rx="1.5"/><rect x="58" y="45.5" width="4" height="10" rx="2"/></g>`;
    return o.dual ? one(-8, -18) + one(8, 18) : one(0, 8);
  },
  shield(p, o = {}) {
    if (o.tower) return `
      <rect x="44" y="10" width="32" height="46" rx="8"/>
      <path d="M60 14 L60 52 M48 32 L72 32" fill="none" stroke="${p.glow}" stroke-width="1.2" opacity="0.7"/>
      <circle cx="60" cy="32" r="3.5" fill="${p.glow}" stroke="none" opacity="0.9"/>`;
    return `
      <path d="M60 8 C74 12 82 16 82 26 C82 42 72 54 60 62 C48 54 38 42 38 26 C38 16 46 12 60 8 Z"/>
      <path d="M60 14 C70 17 76 20 76 27 C76 39 68 49 60 55 C52 49 44 39 44 27 C44 20 50 17 60 14 Z" fill="none" stroke="${p.glow}" stroke-width="1.1" opacity="${o.shine ? 0.9 : 0.5}"/>
      <circle cx="60" cy="30" r="4" fill="${p.glow}" stroke="none" opacity="0.9"/>`;
  },
  armor(p, o = {}) {
    return `
      <path d="M44 16 L60 12 L76 16 L80 28 L72 26 L72 50 C66 54 54 54 48 50 L48 26 L40 28 Z"/>
      <path d="M54 22 C58 26 62 26 66 22 M60 26 L60 46" fill="none" stroke="${p.glow}" stroke-width="1.1" opacity="0.65"/>
      ${o.halo ? `<ellipse cx="60" cy="10" rx="12" ry="3.5" fill="none" stroke="${p.glow}" stroke-width="1.6" opacity="0.9"/>` : ""}`;
  },
  orb(p) {
    return `
      <path d="M48 58 L72 58 L66 50 L54 50 Z"/>
      <circle cx="60" cy="34" r="16"/>
      <circle cx="60" cy="34" r="16" fill="none" stroke="${p.glow}" stroke-width="1.4" opacity="0.8"/>
      <circle cx="55" cy="29" r="4.5" fill="${p.glow}" stroke="none" opacity="0.55"/>
      ${_spark(p, 60, 34, 2.4, 0.9)}${_spark(p, 78, 20, 1.4)}${_spark(p, 42, 44, 1.2)}`;
  },
  charm(p) {
    const leaf = a => `<ellipse cx="60" cy="26" rx="6.5" ry="9" transform="rotate(${a} 60 34)"/>`;
    return `${[0, 90, 180, 270].map(leaf).join("")}
      <circle cx="60" cy="34" r="3.5" fill="${p.glow}" stroke="none" opacity="0.9"/>
      <path d="M60 42 C58 50 62 54 60 60" fill="none" stroke="${p.sil}" stroke-width="3" stroke-linecap="round"/>
      ${_spark(p, 46, 18, 1.4)}${_spark(p, 74, 20, 1.4)}`;
  },
  lance(p) {
    return `
      <path d="M84 8 L92 16 L38 62 L34 58 Z"/>
      <path d="M84 8 L74 12 L88 26 L92 16 Z"/>
      <circle cx="46" cy="52" r="6" fill="none" stroke="${p.sil}" stroke-width="4"/>
      <path d="M80 22 C82 26 80 28 82 32" fill="none" stroke="${p.glow}" stroke-width="1.4" opacity="0.8"/>`;
  },
  banner(p) {
    return `
      <rect x="42" y="8" width="3.5" height="56" rx="1.5"/>
      <path d="M46 12 C64 8 78 16 94 12 L94 36 C78 40 64 32 46 36 Z"/>
      <circle cx="70" cy="24" r="6" fill="none" stroke="${p.glow}" stroke-width="1.6" opacity="0.9"/>
      <path d="M70 20 L70 28 M66 24 L74 24" fill="none" stroke="${p.glow}" stroke-width="1.4" opacity="0.9"/>`;
  },
  scroll(p) {
    return `
      <rect x="38" y="20" width="44" height="32" rx="3"/>
      <ellipse cx="38" cy="36" rx="5" ry="17"/><ellipse cx="82" cy="36" rx="5" ry="17"/>
      <path d="M46 28 L74 28 M46 36 L70 36 M46 44 L74 44" fill="none" stroke="${p.glow}" stroke-width="1.4" opacity="0.8"/>
      ${_spark(p, 60, 12, 1.6)}`;
  },
  mirror(p) {
    return `
      <circle cx="60" cy="32" r="17"/>
      <circle cx="60" cy="32" r="12" fill="${p.glow}" stroke="none" opacity="0.35"/>
      <path d="M52 26 C56 22 62 22 66 25" fill="none" stroke="#fff" stroke-width="2" opacity="0.6"/>
      <path d="M56 49 L64 49 L62 62 L58 62 Z"/>
      <circle cx="60" cy="32" r="17" fill="none" stroke="${p.glow}" stroke-width="1.3" opacity="0.8"/>`;
  },
  // 魔法の杖（マジックワンド／アルカナロッド。big=宝珠が大きく魔力の弧をまとう）
  wand(p, o = {}) {
    const r = o.big ? 8 : 6;
    return `
      <rect x="57.5" y="${14 + r}" width="5" height="${48 - r}" rx="2.5"/>
      <circle cx="60" cy="14" r="${r}"/>
      <circle cx="60" cy="14" r="${r}" fill="${p.glow}" stroke="none" opacity="0.4"/>
      <circle cx="60" cy="14" r="${r}" fill="none" stroke="${p.glow}" stroke-width="1.5" opacity="0.9"/>
      ${o.big ? `<path d="M48 26 C42 21 42 9 48 3 M72 26 C78 21 78 9 72 3" fill="none" stroke="${p.glow}" stroke-width="1.3" opacity="0.7"/>` : ""}
      ${_spark(p, 44, 10, 1.6)}${_spark(p, 78, 18, 1.4)}${_spark(p, 60, 38, 1.2)}`;
  },
};
const ITEM_ART = {
  longsword: { arch: "sword" }, greatsword: { arch: "sword", o: { big: 1 } }, claymore: { arch: "sword", o: { big: 1, ornate: 1 } },
  battleaxe: { arch: "axe", o: { double: 1 } },
  assassindagger: { arch: "dagger" }, dualblade: { arch: "dagger", o: { dual: 1 } },
  leathershield: { arch: "shield" }, towershield: { arch: "shield", o: { tower: 1 } }, mithrilshield: { arch: "shield", o: { shine: 1 } },
  platemail: { arch: "armor" }, saintarmor: { arch: "armor", o: { halo: 1 } },
  elementalorb: { arch: "orb" }, luckycharm: { arch: "charm" }, vampirelance: { arch: "lance" },
  warbanner: { arch: "banner" }, dispelward: { arch: "scroll" }, mirrorshield: { arch: "mirror" },
  magicwand: { arch: "wand" }, arcanarod: { arch: "wand", o: { big: 1 } },
  greedfang: { arch: "dagger", o: { dual: 1 } }, // v17: 吸奪の双牙
};

// ---------- 背景シーン（属性の魔力が満ちる空間＋魔法陣＋地面の影） ----------
function _sceneBG(palKey, p) {
  return `
    <rect x="0" y="0" width="120" height="70" fill="url(#agBG-${palKey})"/>
    <circle cx="60" cy="42" r="27" fill="none" stroke="${p.glow}" stroke-opacity="0.15" stroke-width="1.5" stroke-dasharray="3 4"/>
    <circle cx="60" cy="42" r="32" fill="none" stroke="${p.glow}" stroke-opacity="0.07" stroke-width="1"/>
    ${_spark(p, 16, 14, 1, 0.5)}${_spark(p, 102, 20, 1.2, 0.45)}${_spark(p, 90, 58, 0.9, 0.4)}${_spark(p, 24, 52, 0.9, 0.4)}
    <ellipse cx="60" cy="63" rx="44" ry="6.5" fill="#000" opacity="0.35"/>`;
}

// ---------- カードのアート（種類で出し分け） ----------
function cardArtSVG(c) {
  let palKey, inner;
  if (c.type === "creature") {
    palKey = ART_PAL[c.element] ? c.element : "neutral";
    const p = ART_PAL[palKey];
    const spec = CREATURE_ART[c.id] || { arch: "beast" };
    const draw = ARCH[spec.arch] || ARCH.beast;
    inner = `<g fill="${p.sil}" stroke="${p.line}" stroke-opacity="0.5" stroke-width="1" stroke-linejoin="round">${draw(p, spec.o || {})}</g>`;
  } else if (c.type === "item") {
    palKey = "item";
    const p = ART_PAL.item;
    const spec = ITEM_ART[c.id] || { arch: "sword" };
    const draw = ITEM_ARCH[spec.arch] || ITEM_ARCH.sword;
    inner = `<circle cx="60" cy="36" r="22" fill="${p.glow}" opacity="0.14"/>
      <g fill="#241a08" stroke="${p.glow}" stroke-opacity="0.6" stroke-width="1" stroke-linejoin="round">${draw(p, spec.o || {})}</g>`;
  } else {
    // スペル: 魔法陣の中央に象徴アイコン
    palKey = "spell";
    const p = ART_PAL.spell;
    inner = `
      <circle cx="60" cy="36" r="24" fill="none" stroke="${p.glow}" stroke-width="1.4" opacity="0.75"/>
      <circle cx="60" cy="36" r="19" fill="none" stroke="${p.glow}" stroke-width="0.8" stroke-dasharray="4 3" opacity="0.6"/>
      <path d="M60 14 L79 47 L41 47 Z" fill="none" stroke="${p.glow}" stroke-width="0.8" opacity="0.4"/>
      <path d="M60 58 L41 25 L79 25 Z" fill="none" stroke="${p.glow}" stroke-width="0.8" opacity="0.4"/>
      <circle cx="60" cy="36" r="10" fill="${p.glow}" opacity="0.18"/>
      <text x="60" y="43" text-anchor="middle" font-size="19">${c.icon || "✨"}</text>
      ${_spark(p, 36, 14, 1.4)}${_spark(p, 86, 18, 1.2)}${_spark(p, 84, 56, 1.2)}`;
  }
  return `<svg viewBox="0 0 120 70" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${_sceneBG(palKey, ART_PAL[palKey])}${inner}</svg>`;
}

// ============================================================
// マナ回路の紋章（4属性の珠が回路で中央の核に結ばれる意匠）
// カードバック・パック・タイトル画面で共有する共通パーツ。
// s = スケール係数（線幅・珠サイズをまとめて拡縮）
// ============================================================
function _crest(cx, cy, r, s = 1) {
  const col = [["#e05537", cx, cy - r], ["#4e9a2f", cx + r, cy], ["#3d7de0", cx, cy + r], ["#8a6b3a", cx - r, cy]]; // 上=火 右=木 下=水 左=地
  const lines = col.map(([, x, y]) => `
    <line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#8a7a4a" stroke-width="${1.1 * s}" opacity="0.75"/>
    <line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#d9d2f2" stroke-width="${0.7 * s}" stroke-dasharray="${2 * s} ${5 * s}" opacity="0.5"/>`).join("");
  const orbs = col.map(([c, x, y]) => `
    <circle cx="${x}" cy="${y}" r="${9 * s}" fill="${c}" opacity="0.22"/>
    <circle cx="${x}" cy="${y}" r="${5 * s}" fill="${c}" stroke="url(#agGold)" stroke-width="${1.3 * s}"/>
    <circle cx="${x - 1.6 * s}" cy="${y - 1.8 * s}" r="${1.3 * s}" fill="#ffffff" opacity="0.55"/>`).join("");
  const d = 10 * s;
  return `
    <circle cx="${cx}" cy="${cy}" r="${r + 8 * s}" fill="none" stroke="#8a7a4a" stroke-width="${s}" opacity="0.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#agGold)" stroke-width="${1.3 * s}" stroke-dasharray="${5 * s} ${4 * s}"/>
    ${lines}
    <circle cx="${cx}" cy="${cy}" r="${18 * s}" fill="#d9d2f2" opacity="0.10"/>
    ${orbs}
    <path d="M${cx} ${cy - d} L${cx + d} ${cy} L${cx} ${cy + d} L${cx - d} ${cy} Z" fill="url(#agGold)"/>
    <circle cx="${cx}" cy="${cy}" r="${4.5 * s}" fill="#fff8e0"/>
    <circle cx="${cx}" cy="${cy}" r="${9 * s}" fill="none" stroke="#ffe9a0" stroke-width="${s}" opacity="0.7"/>`;
}

// ---------- カードバック（象徴的な表紙・全カード共通） ----------
// クリーチャーアートと同じ様式＝暗い魔力空間＋シルエットの守護竜（光る目）＋紋章。
// 額縁の金や四隅の菱形はカード表面（コスト宝珠・額縁線）と揃えて統一感を出す。
const CARD_BACK_SVG = (() => {
  const p = ART_PAL.neutral;
  const spark = (x, y, r, op) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.glow}" opacity="${op}"/>`;
  const corner = (x, y) => `<path d="M${x} ${y - 5} L${x + 5} ${y} L${x} ${y + 5} L${x - 5} ${y} Z" fill="url(#agGold)" opacity="0.9"/>`;
  // 紋章の上空を舞う守護竜（クリーチャーと同じシルエット＋光る目の造形）
  const dragon = `<g transform="translate(15 4) scale(0.75)">
    <g fill="#0f0b1c" stroke="${p.line}" stroke-opacity="0.5" stroke-width="1" stroke-linejoin="round">${ARCH.dragon(p, { flame: 1 })}</g></g>`;
  return `<svg viewBox="0 0 120 168" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="120" height="168" fill="url(#agBack)"/>
    ${spark(18, 44, 1, 0.5)}${spark(103, 56, 1.2, 0.45)}${spark(94, 142, 0.9, 0.4)}${spark(22, 126, 0.9, 0.4)}${spark(58, 20, 1, 0.4)}
    <ellipse cx="60" cy="148" rx="38" ry="5.5" fill="#000" opacity="0.32"/>
    ${dragon}
    ${_crest(60, 98, 31, 1)}
    <rect x="4" y="4" width="112" height="160" rx="9" fill="none" stroke="url(#agGold)" stroke-width="2"/>
    <rect x="8.5" y="8.5" width="103" height="151" rx="7" fill="none" stroke="#8a7a4a" stroke-width="0.8" opacity="0.7"/>
    ${corner(16, 17)}${corner(104, 17)}${corner(16, 151)}${corner(104, 151)}
    <text x="60" y="161.5" text-anchor="middle" font-size="6.5" fill="#c9b874" letter-spacing="2.5" opacity="0.85">✦ MANA CIRCUIT ✦</text>
  </svg>`;
})();
const CARD_BACK_HTML = `<div class="card-back">${CARD_BACK_SVG}</div>`;

// ---------- カードパック（開封演出用） ----------
// .pack-svg 内の #pack-top（上端の封）はCSSアニメで切り離せるようグループを分けてある。
// 意匠はカードバックと同じ「守護竜＋マナ回路の紋章」で統一。
const PACK_SVG = (() => {
  const p = ART_PAL.neutral;
  const dragon = `<g transform="translate(25 72) scale(0.82)">
    <g fill="#0f0b1c" stroke="${p.line}" stroke-opacity="0.5" stroke-width="1" stroke-linejoin="round">${ARCH.dragon(p, { flame: 1 })}</g></g>`;
  return `<svg class="pack-svg" viewBox="0 0 150 200" aria-hidden="true">
  <g id="pack-body">
    <path d="M18 22 L132 22 L128 192 L22 192 Z" fill="url(#agBack)" stroke="url(#agGold)" stroke-width="2.5"/>
    <path d="M22 60 L128 60 L127 72 L23 72 Z" fill="url(#agGold)" opacity="0.9"/>
    <circle cx="30" cy="86" r="1.2" fill="${p.glow}" opacity="0.5"/><circle cx="120" cy="96" r="1" fill="${p.glow}" opacity="0.45"/>
    <circle cx="34" cy="176" r="1" fill="${p.glow}" opacity="0.4"/><circle cx="116" cy="168" r="1.2" fill="${p.glow}" opacity="0.4"/>
    ${dragon}
    ${_crest(75, 154, 24, 0.9)}
    <text x="75" y="46" text-anchor="middle" font-size="13" fill="#ffe9a0" letter-spacing="2" font-weight="bold">MANA PACK</text>
  </g>
  <g id="pack-top">
    <path d="M14 8 L136 8 L132 26 L18 26 Z" fill="#241c3a" stroke="url(#agGold)" stroke-width="2"/>
    <path d="M18 26 L24 20 L30 26 L36 20 L42 26 L48 20 L54 26 L60 20 L66 26 L72 20 L78 26 L84 20 L90 26 L96 20 L102 26 L108 20 L114 26 L120 20 L126 26 L132 26"
      fill="none" stroke="#8a7a4a" stroke-width="1"/>
  </g>
</svg>`;
})();

// ---------- タイトル画面の大紋章（ゆっくり回る魔法陣＋脈動する核） ----------
const TITLE_EMBLEM_SVG = (() => {
  const ring = (r, dur, rev) => `
    <g><animateTransform attributeName="transform" type="rotate" from="${rev ? 360 : 0} 110 110" to="${rev ? 0 : 360} 110 110" dur="${dur}s" repeatCount="indefinite"/>
      <circle cx="110" cy="110" r="${r}" fill="none" stroke="url(#agGold)" stroke-width="1.1" stroke-dasharray="6 5" opacity="0.5"/>
    </g>`;
  return `<svg viewBox="0 0 220 220" aria-hidden="true">
    <circle cx="110" cy="110" r="97" fill="none" stroke="#8a7a4a" stroke-width="1" opacity="0.35"/>
    ${ring(88, 46)}${ring(70, 30, true)}
    <circle cx="110" cy="110" r="30" fill="#d9d2f2" opacity="0.08">
      <animate attributeName="opacity" values="0.05;0.16;0.05" dur="3.2s" repeatCount="indefinite"/>
    </circle>
    ${_crest(110, 110, 54, 1.5)}
  </svg>`;
})();

// ---------- タイトル画面のシルエット・フリーズ（地平に並ぶクリーチャーたち） ----------
// カードのアーキタイプをそのまま使い、世界の住人として夜景に並べる
const TITLE_FRIEZE_SVG = (() => {
  const spot = (arch, elem, x, o = {}, s = 1) => {
    const p = ART_PAL[elem];
    return `<g transform="translate(${x} ${77 - 63 * s}) scale(${s})">
      <g fill="#0d0a16" stroke="${p.line}" stroke-opacity="0.4" stroke-width="1" stroke-linejoin="round">${ARCH[arch](p, o)}</g></g>`;
  };
  return `<svg viewBox="0 0 840 84" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    ${spot("tree", "wood", 10, { face: 1 }, 1.0)}
    ${spot("golem", "earth", 130, { veins: 1 }, 0.95)}
    ${spot("fairy", "neutral", 255, {}, 0.85)}
    ${spot("dragon", "fire", 345, { flame: 1, big: 1 }, 1.15)}
    ${spot("humanoid", "spell", 495, { hat: 1, staff: 1 }, 0.9)}
    ${spot("serpent", "water", 585, { fins: 1 }, 1.0)}
    ${spot("beast", "earth", 700, { spikes: 1 }, 0.9)}
    <rect x="0" y="76" width="840" height="8" fill="#0d0a16"/>
    <line x1="0" y1="76" x2="840" y2="76" stroke="#ffd76a" stroke-opacity="0.25" stroke-width="1"/>
  </svg>`;
})();
