// ============================================================
// ui.js — 描画とユーザー入力（盤面SVG / パネル / 手札 / ログ / ダイアログ）
// ============================================================
"use strict";

const UI = {};
UI.selectableTiles = null; // 盤面で選択候補として光らせるマスidの Set（領地・クリーチャー選択中）
// 🧭方向選択中の状態（v31）: { fromId, ids:Set }。null でなければ盤面で行き先のマスを選んでいる最中。
// この間は🔍マス情報を開かない（main.jsの盤面クリックがチェックする）
UI.dirChoice = null;
// 決定待ちのダイアログ数。「👁 盤面を確認」でオーバーレイを一時的に閉じている間も 1 のまま。
// これが 0 でないときにヘルプ/捨札/マス情報など別のダイアログを開くと、保留中のダイアログが
// 上書きされて Promise が永遠に解決されず進行が止まる（実際に起きたフリーズバグ）ため、開く側は必ず確認する。
UI.dialogBusy = 0;
// 受け身ダイアログ（🔍マス情報など・ゲーム進行と無関係なもの）を閉じる関数。
// 進行フロー側の新しいダイアログが開くとき、開きっぱなしの受け身ダイアログを自動で閉じて
// 上書き（＝Promise未解決・busyカウンタずれ）を防ぐ。
UI._passiveClose = null;
function closePassiveDialog() {
  if (UI._passiveClose) { const f = UI._passiveClose; UI._passiveClose = null; f(); }
}
function setSelectableTiles(ids) { UI.selectableTiles = ids instanceof Set ? ids : new Set(ids); }
function clearSelectableTiles() { UI.selectableTiles = null; }
const PLAYER_COLORS = ["#4da3ff", "#ff5b5b", "#7ed957"]; // 🔵自分 / 🔴相手1 / 🟢相手2（三つ巴）
const P_ICONS = ["🔵", "🔴", "🟢"];   // パネル・ログ・ダイアログで使うプレイヤー印
const P_MINI  = ["🔹", "🔸", "💚"];   // 一覧・説明文で土地の所有者を示す小印
// ============================================================
// 盤面の寸法とマス目の形（v31・原さん要望「四角でなくて良い／レイアウトを柔軟に／ステージの違いを明確に」）
// ------------------------------------------------------------
// v30までは「1マス=100px間隔・90px角の丸い四角」で全ステージ共通だった。
// v31では ①マス目の形 ②マス間の余白 ③道の太さ・流れ ④背景の紋章 をステージごとに変えられる。
//   CELL   … マスの中心どうしの間隔（座標系の基準。全ステージ共通で不変）
//   TILE   … マス目の描画サイズ（ステージの look.gap で決まる。余白が広いほど道が主役になる）
//   BOARD_PAD … viewBox の余白。盤面の外へはみ出す駒・オーラが切れないようにするための帯（v31）
// これらは applyStageLook(stage) が対戦開始時に書き換える。盤面の寸法を使う処理は必ずここを見ること。
// ============================================================
const CELL = 100;
const BOARD_PAD = 38;
let TILE = 90;                      // マス目の描画サイズ
let TILE_SHAPE = "square";          // 土地マスの形（ステージ指定）
let ROAD_W = 16;                    // マナの回路（道）の太さ
let ROAD_DASH = "2 9";              // 道を流れる魔力の点線パターン
const STAGE_LOOK_DEFAULT = { shape: "square", gap: 0.10, road: 16, dash: "2 9" };
function stageLook(stage) { return { ...STAGE_LOOK_DEFAULT, ...((stage && stage.look) || {}) }; }
function applyStageLook(stage) {
  const lk = stageLook(stage);
  TILE = Math.round(CELL * (1 - Math.max(0.02, Math.min(0.3, lk.gap))));
  if (!TILE_SHAPES[lk.shape]) console.error(`[ui] 未知のマス目形 "${lk.shape}"（stages.js の look.shape）— square で代用`);
  TILE_SHAPE = TILE_SHAPES[lk.shape] ? lk.shape : "square";
  ROAD_W = lk.road;
  ROAD_DASH = lk.dash;
}
// 盤面SVGの表示領域。マスの外周にBOARD_PADの余白を取る＝端のマスに立つ駒が切れない（v31）
function applyBoardViewBox(g) {
  const svg = document.getElementById("board");
  if (!svg || !g || !g.tiles.length) return;
  const w = (Math.max(...g.tiles.map(t => t.x)) + 1) * CELL;
  const h = (Math.max(...g.tiles.map(t => t.y)) + 1) * CELL;
  svg.setAttribute("viewBox", `${-BOARD_PAD} ${-BOARD_PAD} ${w + BOARD_PAD * 2} ${h + BOARD_PAD * 2}`);
  svg.style.aspectRatio = `${w + BOARD_PAD * 2} / ${h + BOARD_PAD * 2}`;
}

// ---------- マス目の形（パス生成） ----------
// 各形は「中心(cx,cy)と一辺S」から SVG の d 文字列を返す。
// content … 中身（属性チップ・レベル・クリーチャー・通行料）を枠内に収めるための縮小率。
//            円や菱形は内接する四角が小さいので中身を少し縮める（＝どの形でも同じ情報が同じ並びで読める）
const _n = v => Math.round(v * 10) / 10;
function _rrD(cx, cy, w, h, r) {
  const x = cx - w / 2, y = cy - h / 2;
  return `M${_n(x + r)},${_n(y)} h${_n(w - 2 * r)} a${_n(r)},${_n(r)} 0 0 1 ${_n(r)},${_n(r)}` +
    ` v${_n(h - 2 * r)} a${_n(r)},${_n(r)} 0 0 1 ${_n(-r)},${_n(r)} h${_n(-(w - 2 * r))}` +
    ` a${_n(r)},${_n(r)} 0 0 1 ${_n(-r)},${_n(-r)} v${_n(-(h - 2 * r))} a${_n(r)},${_n(r)} 0 0 1 ${_n(r)},${_n(-r)} z`;
}
function _circD(cx, cy, r) { return `M${_n(cx - r)},${_n(cy)} a${_n(r)},${_n(r)} 0 1 0 ${_n(2 * r)},0 a${_n(r)},${_n(r)} 0 1 0 ${_n(-2 * r)},0 z`; }
function _polyD(pts) { return "M" + pts.map(p => `${_n(p[0])},${_n(p[1])}`).join(" L") + " Z"; }
function _regPts(cx, cy, r, n, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = rot + i * 2 * Math.PI / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
// 形は「見た目の個性」と「中身の入る面積」の両立が要る。とがった形（正菱形・尖頭六角・木の葉の
// ような紡錘形）は面積は同じでも“情報の入る内接長方形”が極端に小さく、文字が枠から飛び出す。
// そこで土地マス用は内接面積の大きい形だけを採用し、個性は decor（内側の飾り線）で出している。
// decor … 形の内側に薄く描く飾り（面取りの稜線・歯車の軸・葉脈など）。中身の読みやすさは損なわない
const TILE_SHAPES = {
  // --- 土地マス用（ステージが選ぶ） ---
  square:  { content: 1.00, d: (cx, cy, S) => _rrD(cx, cy, S, S, S * 0.13) },                     // 丸い四角（従来）
  brick:   { content: 1.00, d: (cx, cy, S) => _rrD(cx, cy, S * 1.02, S * 0.92, S * 0.05),         // 切り出した石畳（横長）＋目地
    decor: (cx, cy, S) => `<path d="M${_n(cx - S * 0.5)},${_n(cy - S * 0.28)} h${_n(S)}" stroke="#fff" stroke-opacity="0.08" stroke-width="1.5"/>` },
  round:   { content: 0.96, d: (cx, cy, S) => _circD(cx, cy, S / 2),                              // 円（水面・闘技場）＋内輪
    decor: (cx, cy, S) => `<circle cx="${_n(cx)}" cy="${_n(cy)}" r="${_n(S * 0.42)}" fill="none" stroke="#fff" stroke-opacity="0.07" stroke-width="1.5"/>` },
  hex:     { content: 0.90, d: (cx, cy, S) => _polyD(_regPts(cx, cy, S / 2, 6, 0)) },             // 平頭六角（柱状節理）
  oct:     { content: 0.93, d: (cx, cy, S) => _polyD(_regPts(cx, cy, S / 2 * 1.04, 8, Math.PI / 8)) }, // 正八角（円卓・幻影）
  gem:     { content: 1.00, d: (cx, cy, S) => {                                                    // 面取りした宝石（市場・星辰）
    const h = S / 2, c = S * 0.22;
    return _polyD([[cx - h + c, cy - h], [cx + h - c, cy - h], [cx + h, cy - h + c], [cx + h, cy + h - c],
      [cx + h - c, cy + h], [cx - h + c, cy + h], [cx - h, cy + h - c], [cx - h, cy - h + c]]);
  }, decor: (cx, cy, S) => {                                                                       // 四隅の面から中心へ走る稜線＝宝石のファセット
    const h = S / 2, c = S * 0.22, t = S * 0.3;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
      `<path d="M${_n(cx + sx * (h - c))},${_n(cy + sy * h)} L${_n(cx + sx * t)},${_n(cy + sy * t)} L${_n(cx + sx * h)},${_n(cy + sy * (h - c))}" ` +
      `fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="1.2"/>`).join("");
  } },
  leaf:    { content: 0.96, d: (cx, cy, S) => {                                                    // 木の葉（左上と右下だけ大きく丸める）
    const h = S / 2, R = S * 0.45, r = S * 0.10;
    return `M${_n(cx - h + R)},${_n(cy - h)} L${_n(cx + h - r)},${_n(cy - h)} A${_n(r)},${_n(r)} 0 0 1 ${_n(cx + h)},${_n(cy - h + r)}` +
      ` L${_n(cx + h)},${_n(cy + h - R)} A${_n(R)},${_n(R)} 0 0 1 ${_n(cx + h - R)},${_n(cy + h)}` +
      ` L${_n(cx - h + r)},${_n(cy + h)} A${_n(r)},${_n(r)} 0 0 1 ${_n(cx - h)},${_n(cy + h - r)}` +
      ` L${_n(cx - h)},${_n(cy - h + R)} A${_n(R)},${_n(R)} 0 0 1 ${_n(cx - h + R)},${_n(cy - h)} Z`;
  }, decor: (cx, cy, S) => {                                                                        // 葉脈（尖った角どうしを結ぶ）
    const h = S / 2;
    return `<path d="M${_n(cx + h * 0.72)},${_n(cy - h * 0.72)} L${_n(cx - h * 0.72)},${_n(cy + h * 0.72)}" stroke="#fff" stroke-opacity="0.08" stroke-width="1.5"/>`;
  } },
  gear:    { content: 0.85, d: (cx, cy, S) => {                                                    // 歯車（機構都市）
    const ro = S * 0.54, ri = S * 0.44, teeth = 8, step = 2 * Math.PI / teeth, pts = [];
    for (let i = 0; i < teeth; i++) {
      const a = i * step;
      pts.push([cx + ri * Math.cos(a), cy + ri * Math.sin(a)]);
      pts.push([cx + ro * Math.cos(a + step * 0.16), cy + ro * Math.sin(a + step * 0.16)]);
      pts.push([cx + ro * Math.cos(a + step * 0.34), cy + ro * Math.sin(a + step * 0.34)]);
      pts.push([cx + ri * Math.cos(a + step * 0.5), cy + ri * Math.sin(a + step * 0.5)]);
    }
    return _polyD(pts);
  }, decor: (cx, cy, S) => `<circle cx="${_n(cx)}" cy="${_n(cy)}" r="${_n(S * 0.4)}" fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="1.5"/>` },
  diamond: { content: 0.66, d: (cx, cy, S) => _polyD([[cx, cy - S / 2], [cx + S / 2, cy], [cx, cy + S / 2], [cx - S / 2, cy]]) }, // 菱形（💎魔力マス専用＝中身はアイコンと名前だけ）
  // --- 特別マス用（全ステージ共通の形＝「形を見ればマスの種類が分かる」ようにするため固定） ---
  castle:  { content: 0.94, d: (cx, cy, S) => {                                                    // 🏰城＝胸壁つきの砦
    const h = S / 2, m = S * 0.15, top = cy - h;
    const pts = [[cx - h, top + m], [cx - h, top], [cx - h + m, top], [cx - h + m, top + m * 0.6],
      [cx - m * 0.5, top + m * 0.6], [cx - m * 0.5, top], [cx + m * 0.5, top], [cx + m * 0.5, top + m * 0.6],
      [cx + h - m, top + m * 0.6], [cx + h - m, top], [cx + h, top], [cx + h, top + m],
      [cx + h * 0.86, cy + h], [cx - h * 0.86, cy + h]];
    return _polyD(pts);
  } },
  arch:    { content: 0.92, d: (cx, cy, S) => {                                                    // ⛩️関門＝門型
    const h = S / 2;
    return `M${_n(cx - h)},${_n(cy + h)} L${_n(cx - h)},${_n(cy - h * 0.2)}` +
      ` A${_n(h)},${_n(h * 0.86)} 0 0 1 ${_n(cx + h)},${_n(cy - h * 0.2)} L${_n(cx + h)},${_n(cy + h)} Z`;
  } },
  blob:    { content: 0.90, d: (cx, cy, S) => {                                                    // 🌋マグマ＝ごつごつした溶岩溜まり
    const r = S / 2, k = [1, 0.82, 0.98, 0.8, 1, 0.84, 0.96, 0.8, 1, 0.86];
    return _polyD(k.map((m, i) => {
      const a = i * 2 * Math.PI / k.length - Math.PI / 2;
      return [cx + r * m * Math.cos(a), cy + r * m * Math.sin(a)];
    }));
  } },
};
// マスの種類ごとの形。LAND だけステージ指定（TILE_SHAPE）を使い、他は全ステージ共通＝
// 形そのものが「このマスは何か」の手がかりになる（原さん要望「マス目の違いを明確に」）
const TYPE_SHAPE = {
  CASTLE: "castle", GATE: "arch", MAGIC: "diamond", WARP: "round",
  SPRING: "round", FORTUNE: "oct", BOOST: "gem", MAGMA: "blob", CARD: "brick",
};
function shapeOfTile(tile) { return tile.type === "LAND" ? TILE_SHAPE : (TYPE_SHAPE[tile.type] || "square"); }
// 形の内側に描く飾り（面取りの稜線・歯車の軸・葉脈など）。無い形は空文字
function tileDecorSVG(tile, cx, cy, size) {
  const sh = TILE_SHAPES[shapeOfTile(tile)];
  return (sh && sh.decor) ? sh.decor(cx, cy, size === undefined ? TILE : size) : "";
}
// マス1つぶんの外形パス（size 省略時は TILE）
function tileShapeD(tile, cx, cy, size) {
  const sh = TILE_SHAPES[shapeOfTile(tile)] || TILE_SHAPES.square;
  return sh.d(cx, cy, size === undefined ? TILE : size);
}
// 文字列のおおよその描画幅（全角=1em / 半角=0.56em）。マス目に収まるかの判定に使う
function approxTextW(s, fontSize) {
  let w = 0;
  for (const ch of String(s)) w += /[\x20-\xff]/.test(ch) ? 0.56 : 1.0;
  return w * fontSize;
}
// maxW を超えるときだけ textLength で詰める属性を返す（岩帝テラガイアのような
// 「長い名前・4桁HP」の極端なカードでもマス目から文字がはみ出さないようにするため）
function fitTextAttr(s, fontSize, maxW) {
  return approxTextW(s, fontSize) > maxW ? ` textLength="${_n(maxW)}" lengthAdjust="spacingAndGlyphs"` : "";
}
function tileContentScale(tile) {
  const sh = TILE_SHAPES[shapeOfTile(tile)] || TILE_SHAPES.square;
  return sh.content;
}

// 盤面上の駒の位置（同じマスに複数人が重なっても全員見えるよう、マスの上辺にずらして並べる）。
// v31: 駒を大きく描き直したので重なり方も見直した（マス目の情報は駒の下に隠れてよい＝
// 隠れた情報は🔍マス情報で確認できる、という原さんの整理に従う）
function tokenOffsets(n) {
  const S = TILE;
  if (n <= 1) return [{ dx: S * 0.5, dy: S * 0.10 }];
  if (n === 2) return [{ dx: S * 0.27, dy: S * 0.14 }, { dx: S * 0.73, dy: S * 0.14 }];
  return [{ dx: S * 0.20, dy: S * 0.20 }, { dx: S * 0.80, dy: S * 0.20 }, { dx: S * 0.5, dy: S * -0.04 }];
}

// 演出速度の倍率。トレーニングでは小さくして時短にする（startGameで設定）
let GAME_SPEED = 1;
function sleep(ms) { return new Promise(r => setTimeout(r, ms * GAME_SPEED)); }

const TILE_ICONS = { CASTLE: "🏰", GATE: "⛩️", CARD: "🎴", MAGIC: "💎", WARP: "🌀", MAGMA: "🌋", BOOST: "💨", FORTUNE: "🎰", SPRING: "⛲" };
const TILE_LABELS = { CASTLE: "城", GATE: "関門", CARD: "カード", MAGIC: "魔力", WARP: "ワープ", MAGMA: "マグマ", BOOST: "疾風", FORTUNE: "運命", SPRING: "泉" };

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// クリーチャーと土地の属性関係の注記（ダイアログ用）。無属性は一致も不一致もしない（土地の加護なし）
function elemNote(card, tile) {
  if (card.element === "neutral") return "・<b>無属性</b>（土地の加護なし）";
  return card.element !== tile.element ? "・<b>属性不一致</b>" : "・属性一致";
}

// ---------- 盤面 ----------
// タイルの左上座標（マス目はセルの中央に置く＝TILEの大小に関わらず道の中心と揃う）
function tilePx(tile) { const m = (CELL - TILE) / 2; return { x: tile.x * CELL + m, y: tile.y * CELL + m }; }
// タイルの中心座標（v31: 中身は全て中心からの相対配置で描く＝どんな形でも同じ並びで読める）
function tileCenter(tile) { return { cx: tile.x * CELL + CELL / 2, cy: tile.y * CELL + CELL / 2 }; }

// ステージの背景紋章（v31）: 盤面の下に薄く敷く「その土地らしさ」。
// ステージのアイコンを大きく透かし、テーマ色の光を落とし、外周に額縁を描く。
// 盤面を見た瞬間に「前と違うステージだ」と分かるようにするためのレイヤー（マスの視認性は落とさない濃度）
function boardBackdropSVG(g) {
  const w = (Math.max(...g.tiles.map(t => t.x)) + 1) * CELL;
  const h = (Math.max(...g.tiles.map(t => t.y)) + 1) * CELL;
  const th = g.stage.theme || {};
  const glow = th.glow || "#2a2440", dot = th.dot || "#5c5480";
  const P = BOARD_PAD - 6;
  let s = `<g class="board-bg" pointer-events="none">`;
  s += `<rect x="${-P}" y="${-P}" width="${w + P * 2}" height="${h + P * 2}" rx="26" fill="${glow}" opacity="0.18"/>`;
  s += `<rect x="${-P}" y="${-P}" width="${w + P * 2}" height="${h + P * 2}" rx="26" fill="none" stroke="${dot}" stroke-width="2" opacity="0.42"/>`;
  s += `<rect x="${-P + 7}" y="${-P + 7}" width="${w + P * 2 - 14}" height="${h + P * 2 - 14}" rx="20" fill="none" stroke="${dot}" stroke-width="1" opacity="0.2" stroke-dasharray="10 8"/>`;
  // 中央に巨大な紋章（ステージアイコン）。マスの背後なので濃度は最小限
  s += `<text x="${w / 2}" y="${h / 2 + Math.min(w, h) * 0.14}" font-size="${Math.min(w, h) * 0.42}" text-anchor="middle" opacity="0.05">${g.stage.icon}</text>`;
  // 上の余白にステージ名の銘板（どのステージを遊んでいるか盤面だけで分かる）
  s += `<text x="${-P + 10}" y="${-P + 22}" font-size="20" fill="${dot}" opacity="0.75" font-weight="bold">${esc(g.stage.icon + " STAGE " + (g.stageIdx + 1) + "　" + g.stage.name)}</text>`;
  s += `</g>`;
  return s;
}

function renderBoard(g) {
  const svg = document.getElementById("board");
  let html = boardBackdropSVG(g);
  // マナの回路（マスをつなぐ道）: タイルの下層に描く。太い道＋中央を流れる魔力の点線。
  // 色・太さ・流れの粒はステージ（theme / look）で変わり、盤面ごとの雰囲気を出す
  const th = g.stage.theme || {};
  const pathCol = th.path || "#241e33", dotCol = th.dot || "#5c5480";
  g.tiles.forEach(tile => {
    const a = tileCenter(tile);
    tile.next.forEach(nid => {
      const b = tileCenter(g.tiles[nid]);
      html += `<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" stroke="${pathCol}" stroke-width="${ROAD_W}" stroke-linecap="round"/>`;
      html += `<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" stroke="${dotCol}" stroke-width="2.5" stroke-dasharray="${ROAD_DASH}" stroke-linecap="round" opacity="0.9"/>`;
    });
  });
  g.tiles.forEach(tile => { html += tileSVG(g, tile); });
  // プレイヤー駒はいちばん最後＝常に最前面（マス目の情報が駒の下に隠れるのは許容。
  // 隠れた情報は🔍マス情報で確認できる、という原さんの整理に従う）
  html += tokensSVG(g);
  svg.innerHTML = html;
}

// マス1つぶんの描画（v31: 外形は形状パス・中身は中心からの相対配置）
function tileSVG(g, tile) {
  const { cx, cy } = tileCenter(tile);
  const S = TILE, u = S / 90;              // u＝基準サイズ(90)からの倍率。中身の座標・文字サイズに掛ける
  const isLand = tile.type === "LAND";
  const shapeD = (size) => tileShapeD(tile, cx, cy, size);
  const fill = isLand ? `url(#tg-${tile.element})`
    : tile.type === "CASTLE" ? "url(#tg-castle)"
    : tile.type === "MAGMA" ? "#5a2418"
    : "url(#tg-special)";
  const stroke = tile.owner !== null ? PLAYER_COLORS[tile.owner]
    : tile.type === "CASTLE" ? "#c9a755" : "#5a5470";
  const sw = tile.owner !== null ? 4 : tile.type === "CASTLE" ? 2.5 : 1.5;
  let html = `<g class="tile" data-tile="${tile.id}">`;
  // 所有地はプレイヤー色のオーラで一目で分かるように（マス目と同じ形で一回り大きく）
  if (tile.owner !== null) {
    html += `<path d="${shapeD(S + 7)}" fill="none" stroke="${PLAYER_COLORS[tile.owner]}" stroke-width="7" opacity="0.22"/>`;
  }
  html += `<path class="tshape" d="${shapeD(S)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  // 内側のハイライト線（マス目の立体感。外形と同じ形で少し内側に）＋形ごとの飾り（稜線・葉脈・歯車の軸）
  html += `<path d="${shapeD(S - 6)}" fill="none" stroke="#fff" stroke-opacity="${tile.type === "CASTLE" ? 0.12 : 0.06}" stroke-width="1" stroke-linejoin="round"/>`;
  html += tileDecorSVG(tile, cx, cy, S);

  // ---- 中身 ----
  // v31: マス目が四角とは限らなくなったので、中身は「中央に積む横帯」に組み替えた。
  //   1段目 [属性チップ] #番号 Lv3   … 上ほど幅を使わない＝六角・円・結晶でも角が飛び出さない
  //   2段目 ●●●○○（レベルのピップ）
  //   3段目 (属性バッジ) クリーチャー名
  //   4段目 ST・HP
  //   5段目 通行料
  // 角に置いていた要素（属性チップ・Lv・#番号）を1段目へ集約したのがv30からの変更点。
  // さらに形ごとの content 率で中心方向へ縮め、どの形でも枠内に収める。
  const k = tileContentScale(tile);
  let inner = "";
  if (isLand) {
    inner += `<rect x="${_n(cx - 28 * u)}" y="${_n(cy - 37 * u)}" width="${_n(22 * u)}" height="${_n(18 * u)}" rx="${_n(5.5 * u)}" fill="${ELEMENTS[tile.element].color}cc"/>`;
    inner += `<text x="${_n(cx - 17 * u)}" y="${_n(cy - 24 * u)}" font-size="${_n(13 * u)}" text-anchor="middle">${ELEMENTS[tile.element].icon}</text>`;
    inner += `<text x="${_n(cx)}" y="${_n(cy - 25 * u)}" font-size="${_n(9.5 * u)}" fill="#9a92b5" text-anchor="middle">#${tile.id}</text>`;
    inner += `<text x="${_n(cx + 29 * u)}" y="${_n(cy - 24 * u)}" font-size="${_n(13 * u)}" fill="#cfc9e0" text-anchor="end" font-weight="bold">Lv${tile.level}</text>`;
    const PIP_N = LAND_VALUE.length, pipGap = 8.6 * u, pipR = 3.2 * u;
    const pipStartX = cx - (PIP_N - 1) * pipGap / 2, pipY = cy - 11 * u;
    for (let lv = 1; lv <= PIP_N; lv++) {
      const on = lv <= tile.level;
      inner += `<circle cx="${_n(pipStartX + (lv - 1) * pipGap)}" cy="${_n(pipY)}" r="${_n(pipR)}" fill="${on ? "#ffd76a" : "#453f5c"}"${on ? ' stroke="#8a6a12" stroke-width="0.6"' : ""}/>`;
    }
    if (tile.creature) {
      const c = CARD_BY_ID[tile.creature.cardId];
      const ce = ELEMENTS[c.element];
      const cur = tile.creature.hp ?? c.hp;
      const wounded = cur < c.hp;
      const hpStr = wounded ? `${cur}/${c.hp}` : `${c.hp}`;
      const hpFill = wounded ? "#ff8a6a" : "#ffe08a"; // 傷ついていれば赤み
      // クリーチャーの属性は「丸いバッジ」（＝土地チップの角丸と形で区別）
      inner += `<circle cx="${_n(cx - 24 * u)}" cy="${_n(cy + 3 * u)}" r="${_n(9.5 * u)}" fill="${ce.color}" stroke="#fff" stroke-width="${_n(1.4 * u)}"/>`;
      inner += `<text x="${_n(cx - 24 * u)}" y="${_n(cy + 7 * u)}" font-size="${_n(11 * u)}" text-anchor="middle">${ce.icon}</text>`;
      // 名前・ST/HPは長さが読めない（岩帝テラガイア＝長い名前／HP148/155＝7桁）ので、
      // 幅が上限を超えるときだけ textLength で詰める＝どんなカードでもマス目からはみ出さない
      const nm = c.name.slice(0, 5);
      inner += `<text x="${_n(cx + 7 * u)}" y="${_n(cy + 7 * u)}" font-size="${_n(11.5 * u)}" fill="#fff" text-anchor="middle" font-weight="bold"${fitTextAttr(nm, 11.5 * u, 48 * u)}>${esc(nm)}</text>`;
      const stHp = `ST${c.st} HP${hpStr}`;
      inner += `<text x="${_n(cx)}" y="${_n(cy + 24 * u)}" text-anchor="middle"${fitTextAttr(stHp, 15 * u, 58 * u)}>` +
        `<tspan font-size="${_n(11.5 * u)}" fill="#c9c2da">ST${c.st}</tspan>` +
        `<tspan font-size="${_n(16 * u)}" font-weight="bold" fill="${hpFill}"> HP${hpStr}</tspan></text>`;
    }
    if (tile.owner !== null) {
      inner += `<text x="${_n(cx)}" y="${_n(cy + 37 * u)}" font-size="${_n(12.5 * u)}" fill="${PLAYER_COLORS[tile.owner]}" text-anchor="middle" font-weight="bold">${tollOf(g, tile)}G</text>`;
    }
  } else {
    // 特別マスは大きな紋章＋名前。形そのものも種類ごとに違う（TYPE_SHAPE）
    const iconSize = (tile.type === "CASTLE" ? 32 : 28) * u;
    inner += `<text x="${_n(cx)}" y="${_n(cy - 25 * u)}" font-size="${_n(9.5 * u)}" fill="#9a92b5" text-anchor="middle">#${tile.id}</text>`;
    inner += `<text x="${_n(cx)}" y="${_n(cy + 6 * u)}" font-size="${_n(iconSize)}" text-anchor="middle">${TILE_ICONS[tile.type]}</text>`;
    if (tile.type === "MAGIC") {
      inner += `<text x="${_n(cx + 20 * u)}" y="${_n(cy - 20 * u)}" font-size="${_n(10 * u)}" text-anchor="middle">✨<animate attributeName="opacity" values="1;0.2;1" dur="1.8s" repeatCount="indefinite"/></text>`;
    }
    inner += `<text x="${_n(cx)}" y="${_n(cy + 28 * u)}" font-size="${_n(11.5 * u)}" fill="#b8b2cc" text-anchor="middle">${TILE_LABELS[tile.type]}</text>`;
  }
  html += k === 1 ? inner
    : `<g transform="translate(${_n(cx * (1 - k))} ${_n(cy * (1 - k))}) scale(${k})">${inner}</g>`;

  // ---- 枠に重ねる標識（形に沿わせるので縮小しない） ----
  // 盤面エフェクト（🛡️結界/🕸️罠/🚧バリケード）
  const ov = overlayOf(g, tile);
  if (ov) {
    const ovIcon = ov.kind === "sanctuary" ? "🛡️" : ov.kind === "snare" ? "🕸️" : ov.kind === "block" ? "🚧" : "✨";
    const ovColor = ov.kind === "sanctuary" ? "#8ecbff" : ov.kind === "snare" ? "#c9a0ff" : ov.kind === "block" ? "#ffb84d" : "#ddd";
    html += `<path d="${shapeD(S)}" fill="none" stroke="${ovColor}" stroke-width="3" stroke-dasharray="7 5" opacity="0.9" stroke-linejoin="round"/>`;
    html += `<text x="${cx}" y="${cy - 28 * u}" font-size="${15 * u}" text-anchor="middle">${ovIcon}</text>`;
  }
  // 🃏 伏せ札（v29）: 「何かが伏せてある」ことは全員に見える（中身は所有者のみ＝マス情報で確認）
  if (tile.trap && tile.owner === tile.trap.owner) {
    const tx = cx + 28 * u, ty = cy - 37 * u;
    html += `<g opacity="0.95"><animate attributeName="opacity" values="0.95;0.55;0.95" dur="2.4s" repeatCount="indefinite"/>` +
      `<rect x="${tx}" y="${ty}" width="${11 * u}" height="${15 * u}" rx="2" fill="#2a2140" stroke="${PLAYER_COLORS[tile.trap.owner]}" stroke-width="1.6"/>` +
      `<text x="${tx + 5.5 * u}" y="${ty + 11.5 * u}" font-size="${9 * u}" text-anchor="middle" fill="#d9a6ff">?</text></g>`;
  }
  // 矢印表示（v23）: ➡一方通行マスの唯一の出口／三叉路以上の合流マスの行き先
  const arrow = (nt, fill2, big) => {
    const dx = Math.sign(nt.x - tile.x), dy = Math.sign(nt.y - tile.y);
    const ax = cx + dx * (S / 2 - 2), ay = cy + dy * (S / 2 - 2);
    const L = (big ? 1.45 : 1) * u;
    return `<polygon points="${_n(ax + dx * 7 * L)},${_n(ay + dy * 7 * L)} ` +
      `${_n(ax - dx * 4 * L - dy * 6 * L)},${_n(ay - dy * 4 * L - dx * 6 * L)} ` +
      `${_n(ax - dx * 4 * L + dy * 6 * L)},${_n(ay - dy * 4 * L + dx * 6 * L)}" fill="${fill2}" opacity="0.95"` +
      (big ? `><animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite"/></polygon>` : "/>");
  };
  if (tile.onewayTo != null) {
    html += arrow(g.tiles[tile.onewayTo], "#ff9a3d", true);
  } else {
    const neigh = neighborsOf(g, tile).filter(t => !(t.onewayTo != null && t.onewayTo === tile.id));
    if (neigh.length > 2) neigh.forEach(nt => { html += arrow(nt, "#ffd76a", false); });
  }
  // 選択対象マスの強調（スペル対象／領地売却／侵攻先など）。盤面から直接クリックして選べる
  if (UI.selectableTiles && UI.selectableTiles.has(tile.id)) {
    html += `<path d="${shapeD(S + 5)}" fill="none" stroke="#ffe066" stroke-width="5" stroke-linejoin="round">` +
      `<animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></path>`;
    html += `<rect x="${cx - 19}" y="${cy - 15}" width="38" height="28" rx="8" fill="#ffe066" opacity="0.96"/>`;
    html += `<text x="${cx}" y="${cy + 6}" font-size="18" fill="#1a1526" text-anchor="middle" font-weight="bold">#${tile.id}</text>`;
  }
  // 🧭 進む方向の候補（v31）: 移動中に選べる行き先を大きな矢印＋光る枠で示す（ダイアログは出さない）
  if (UI.dirChoice && UI.dirChoice.ids.has(tile.id)) {
    html += dirCandidateSVG(g, tile);
  }
  html += `</g>`;
  return html;
}

// ============================================================
// プレイヤー駒（v31・原さん要望「駒のディテールを上げる・見切れたり見えなくなったりしない」）
// ------------------------------------------------------------
// v30までは半径13の宝珠（円＋文字）で、①端のマスでは viewBox の外にはみ出して切れる
// ②同じマスに複数人が乗ると重なって数が分からない、という問題があった。
// v31では「マントを羽織った術者の立像」として描き直し、
//   ・BOARD_PAD の余白を viewBox に確保（端のマスでも切れない）
//   ・駒は必ず最後に描く＝どのマスの情報より前面
//   ・同じマスの人数に応じて自動で並べ直す（tokenOffsets）＋足元に接地シャドウ
//   ・手番の駒は足元の魔法陣が回り、頭上に▼マーカー——「今どれが自分か」が一目で分かる
// 駒の下にマス目の情報が隠れるのは許容（🔍マス情報でいつでも確認できるため）。
// ============================================================
function tokensSVG(g) {
  // 同じマスに立つプレイヤーごとにまとめ、人数に応じて配置をずらす
  const byTile = new Map();
  g.players.forEach(p => {
    if (!p.alive) return;
    if (!byTile.has(p.pos)) byTile.set(p.pos, []);
    byTile.get(p.pos).push(p);
  });
  let html = "";
  byTile.forEach((list, pos) => {
    const { x, y } = tilePx(g.tiles[pos]);
    const offs = tokenOffsets(list.length);
    list.forEach((p, i) => {
      const o = offs[i] || offs[offs.length - 1];
      html += playerTokenSVG(g, p, x + o.dx, y + o.dy);
    });
  });
  return html;
}

// 駒1体ぶん。(cx, cy) は駒の「足元」の座標＝立像の底面
function playerTokenSVG(g, p, cx, cy) {
  const col = PLAYER_COLORS[p.id];
  const active = g.current === p.id && !g.over;
  const R = TILE * 0.30;                     // 駒の基準サイズ（マス目に対する比率で決める＝どの盤面でも同じ見え方）
  const label = (g.hotseat || g.players.length > 2) ? String(p.id + 1) : (p.id === 0 ? "P" : "C");
  const headY = cy - R * 1.72;               // 頭の中心
  const bodyTop = cy - R * 1.30;
  let s = `<g class="token" data-token="${p.id}">`;
  // 足元: 接地シャドウ＋手番なら回る魔法陣（「自分の番」を盤面だけで伝える）
  s += `<ellipse cx="${_n(cx)}" cy="${_n(cy + R * 0.10)}" rx="${_n(R * 0.86)}" ry="${_n(R * 0.32)}" fill="#000" opacity="0.42"/>`;
  if (active) {
    s += `<g opacity="0.9"><animateTransform attributeName="transform" type="rotate" from="0 ${_n(cx)} ${_n(cy)}" to="360 ${_n(cx)} ${_n(cy)}" dur="6s" repeatCount="indefinite"/>` +
      `<ellipse cx="${_n(cx)}" cy="${_n(cy)}" rx="${_n(R * 1.12)}" ry="${_n(R * 0.42)}" fill="none" stroke="${col}" stroke-width="${_n(R * 0.14)}" stroke-dasharray="${_n(R * 0.5)} ${_n(R * 0.34)}"/></g>`;
    s += `<ellipse cx="${_n(cx)}" cy="${_n(cy)}" rx="${_n(R * 0.9)}" ry="${_n(R * 0.34)}" fill="none" stroke="${col}" stroke-width="1.5" opacity="0.55">` +
      `<animate attributeName="rx" values="${_n(R * 0.8)};${_n(R * 1.3)};${_n(R * 0.8)}" dur="1.6s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0.65;0.1;0.65" dur="1.6s" repeatCount="indefinite"/></ellipse>`;
  }
  // マント（裾広がりの三角＋肩のライン）＝立ち姿のシルエット
  s += `<path d="M${_n(cx)},${_n(bodyTop)} C${_n(cx + R * 0.62)},${_n(bodyTop + R * 0.5)} ${_n(cx + R * 0.9)},${_n(cy - R * 0.32)} ${_n(cx + R * 0.86)},${_n(cy)}` +
    ` L${_n(cx - R * 0.86)},${_n(cy)} C${_n(cx - R * 0.9)},${_n(cy - R * 0.32)} ${_n(cx - R * 0.62)},${_n(bodyTop + R * 0.5)} ${_n(cx)},${_n(bodyTop)} Z"` +
    ` fill="url(#tokP${p.id})" stroke="#0d0a16" stroke-width="${_n(R * 0.13)}" stroke-linejoin="round"/>`;
  // マントの合わせ目（縦の陰）と裾の縁取り
  s += `<path d="M${_n(cx)},${_n(bodyTop + R * 0.18)} L${_n(cx)},${_n(cy - R * 0.06)}" stroke="#0d0a16" stroke-width="${_n(R * 0.1)}" opacity="0.45"/>`;
  s += `<path d="M${_n(cx - R * 0.84)},${_n(cy - R * 0.02)} L${_n(cx + R * 0.84)},${_n(cy - R * 0.02)}" stroke="#fff" stroke-width="${_n(R * 0.09)}" opacity="0.35"/>`;
  // 頭（フード）＋顔の影＝「人が立っている」と分かる最小限のディテール
  s += `<circle cx="${_n(cx)}" cy="${_n(headY)}" r="${_n(R * 0.52)}" fill="url(#tokP${p.id})" stroke="#0d0a16" stroke-width="${_n(R * 0.12)}"/>`;
  s += `<path d="M${_n(cx - R * 0.4)},${_n(headY + R * 0.1)} A${_n(R * 0.42)},${_n(R * 0.42)} 0 0 0 ${_n(cx + R * 0.4)},${_n(headY + R * 0.1)} Z" fill="#0d0a16" opacity="0.55"/>`;
  s += `<ellipse cx="${_n(cx - R * 0.18)}" cy="${_n(headY - R * 0.2)}" rx="${_n(R * 0.16)}" ry="${_n(R * 0.11)}" fill="#fff" opacity="0.5"/>`;
  // 胸元の紋章＝プレイヤー識別（P / C / 1 2 3）。駒が小さくても誰の駒か読める
  s += `<circle cx="${_n(cx)}" cy="${_n(cy - R * 0.62)}" r="${_n(R * 0.36)}" fill="#120e1f" stroke="${col}" stroke-width="${_n(R * 0.12)}"/>`;
  s += `<text x="${_n(cx)}" y="${_n(cy - R * 0.62 + R * 0.24)}" font-size="${_n(R * 0.62)}" fill="#fff" text-anchor="middle" font-weight="bold">${label}</text>`;
  // 手番の駒は頭上に▼（真上から見ても迷わない目印）
  if (active) {
    s += `<polygon points="${_n(cx - R * 0.34)},${_n(headY - R * 1.12)} ${_n(cx + R * 0.34)},${_n(headY - R * 1.12)} ${_n(cx)},${_n(headY - R * 0.66)}" fill="${col}" stroke="#0d0a16" stroke-width="${_n(R * 0.08)}">` +
      `<animateTransform attributeName="transform" type="translate" values="0 0; 0 ${_n(-R * 0.22)}; 0 0" dur="1.2s" repeatCount="indefinite"/></polygon>`;
  }
  s += `</g>`;
  return s;
}

// ---------- 現状順位（standings） ----------
// 勝利条件は「総資産 → 城へ凱旋」なので、順位は総資産（魔力＋所有地の価値）の多い順で決める。
// 同額は同順位（1位・1位・3位）。ラウンド上限による資産勝負の判定と同じ基準。
function standingsOf(g) {
  const rows = g.players.map(p => ({ id: p.id, assets: assetsOf(g, p) }))
    .sort((a, b) => b.assets - a.assets);
  let rank = 0, prev = null;
  rows.forEach((r, i) => {
    if (r.assets !== prev) { rank = i + 1; prev = r.assets; }
    r.rank = rank;
  });
  return rows;
}
const RANK_MEDALS = ["🥇", "🥈", "🥉"];
function rankMedal(rank) { return RANK_MEDALS[rank - 1] || "🏳"; }
// 首位との差（首位なら2位との差）を短い文で。ぱっと見て「今どれだけ勝っているか」が分かるように
function rankGapText(rows, me) {
  if (rows.length < 2) return "";
  if (me.rank === 1) {
    const others = rows.filter(r => r.id !== me.id);
    if (others.some(r => r.rank === 1)) return "同率首位"; // 首位が並んでいる＝「2位に+○G」ではない
    const next = others[0]; // rows は総資産の降順なので、自分を除いた先頭が次点
    return `${next.rank}位に +${me.assets - next.assets}G`;
  }
  return `首位まで -${rows[0].assets - me.assets}G`;
}

// ---------- プレイヤー情報窓（v27: 画面上部に3名分を圧縮して固定） ----------
// v26までは4隅のフローティング窓だったため盤面が隠れていた。v27では上部のフロー配置に変え、
// 1人あたり3行（①順位・名前・魔力 ②総資産バー ③連鎖/関門/周回/山札＋首位との差）に圧縮。
// クリックで詳細ポップアップ（showPlayerDetail）＝畳んだ情報はそこで読める。
function renderPanels(g) {
  const rows = standingsOf(g); // 現状順位（総資産順）
  // 2人なら2列にして1枚あたりを広く使う（3人目の枠は .unused で消す）
  const strips = document.getElementById("pstrips");
  if (strips) strips.classList.toggle("n2", g.players.length < 3);
  const p2el = document.getElementById("panel-2");
  if (p2el) p2el.classList.toggle("unused", g.players.length < 3);
  const needed = gatesNeededOf(g);
  g.players.forEach(p => {
    const el = document.getElementById(`panel-${p.id}`);
    if (!el) return;
    const me = rows.find(r => r.id === p.id);
    const assets = me.assets;
    const chains = Object.keys(ELEMENTS)
      .map(e => ({ e, n: chainCount(g, p.id, e) }))
      .filter(c => c.n > 0)
      .map(c => `${ELEMENTS[c.e].icon}${c.n}`).join("") || "－";
    const gates = "●".repeat(Math.min(p.gates.size, needed)) + "○".repeat(Math.max(0, needed - p.gates.size));
    const reached = assets >= RULES.target; // 目標達成＝城へ凱旋すれば勝ち（⚑リーチ表示）
    const under = isUnderdog(g, p);         // v31: 🔥劣勢＝逆転スペル・反骨・スペル割引が効く状態
    el.style.setProperty("--pc", PLAYER_COLORS[p.id]); // 左端の色帯＝プレイヤー色
    el.classList.toggle("active", g.current === p.id && !g.over);
    el.classList.toggle("dead", !p.alive);
    el.classList.toggle("reached", reached && !g.over);
    el.dataset.pid = p.id;
    el.title = `${p.name}の詳細（所有地・関門・山札など）を開く`;
    // CPUはキャラの顔絵（chars.js）を名前の横に出して「相手の存在」を感じさせる
    const ch = (typeof charOf === "function") ? charOf(p) : null;
    const face = ch ? `<span class="p-face">${charPortraitSVG(ch, 20)}</span>` : P_ICONS[p.id];
    el.innerHTML = `
      <div class="ps-top">
        <span class="p-rank r${me.rank}" title="総資産で決まる現在の順位（ラウンド上限の資産勝負もこの順位）">${rankMedal(me.rank)}${me.rank}</span>
        ${face}<span class="ps-name" style="color:${PLAYER_COLORS[p.id]}">${esc(p.name)}</span>
        ${reached ? `<span class="p-reach" title="目標資産に到達！ 城へ凱旋すれば勝利">⚑凱旋</span>` : ""}
        ${under ? `<span class="p-under" title="劣勢（総資産が首位の${Math.round(COMEBACK_RATIO * 100)}%未満）＝⚒逆転スペルが使える／🔥反骨がST+20/HP+20／周回ボーナス1.5倍${g.climax ? "／スペル25%OFF" : ""}">🔥劣勢</span>` : ""}
      </div>
      <div class="ps-mid">
        <span class="ps-magic" title="手持ちの魔力">💎${p.magic}G</span>
        <span class="ps-assets" title="総資産（魔力＋所有地の価値） / 目標"><b>${assets}</b> / ${RULES.target}G</span>
        <div class="ps-bar"><div style="width:${Math.min(100, assets / RULES.target * 100)}%; background:${PLAYER_COLORS[p.id]}"></div></div>
      </div>
      <div class="ps-meta">
        <span title="属性の連鎖（同属性の自領数）">🔗${chains}</span>
        <span title="通過した関門">⛩️${gates}</span>
        <span title="周回数">🔄${p.laps}</span>
        <span title="山札の残り">🎴${p.deck.length}</span>
        <span class="ps-gap">${rankGapText(rows, me)}</span>
      </div>`;
  });
  const diff = DIFFICULTIES[loadDifficulty()];
  const mode = g.hotseat ? "🎮 2人対戦" : g.royale ? `⚔ 三つ巴｜${diff.icon}${diff.label}` : `難易度 ${diff.icon}${diff.label}`;
  const ml = (typeof MATCH_LENGTHS !== "undefined") ? MATCH_LENGTHS[loadMatchLength()] : null;
  // ヘッダーにも首位だけ出す（パネルを全部閉じていても「今だれが勝っているか」は分かるように）
  const tied = rows.length > 1 && rows[1].rank === 1;
  const leader = tied ? "同率首位" : g.players[rows[0].id].name;
  document.getElementById("round-info").textContent =
    `${g.stage.icon} STAGE ${g.stageIdx + 1}｜ラウンド ${Math.min(g.round, RULES.maxRounds)} / ${RULES.maxRounds}｜${mode}` +
    (ml && !g.training && loadMatchLength() !== "normal" ? `｜${ml.icon}${ml.label}` : "") +
    (g.weekly ? `｜🎪 ${g.weekly.name}` : "") +
    (g.climax ? `｜⚔決戦の刻` : "") + // v31: 決戦スペルが解禁されていることを常に見える場所に出す
    `｜🥇 ${leader}`;
  document.getElementById("round-info").classList.toggle("climax", !!g.climax);
}

// ---------- プレイヤー詳細ポップアップ（v27） ----------
// 上部の情報窓は圧縮表示なので、細かい情報（所有地の一覧・関門・捨札・手札枚数など）は
// 情報窓をクリックしたときのポップアップで見せる。カード詳細（showCardDetail）と同じく
// #overlay や UI.dialogBusy に触らない独立レイヤー＝どの場面で開いても進行を壊さない。
function showPlayerDetail(pid) {
  if (typeof G === "undefined" || !G || !G.players) return;
  const p = G.players[pid];
  if (!p) return;
  const rows = standingsOf(G);
  const me = rows.find(r => r.id === pid);
  const lands = ownedLands(G, pid);
  const landTotal = lands.reduce((s, t) => s + landValue(t), 0);
  const needed = gatesNeededOf(G);
  const gates = "●".repeat(Math.min(p.gates.size, needed)) + "○".repeat(Math.max(0, needed - p.gates.size));
  const chains = Object.keys(ELEMENTS)
    .map(e => ({ e, n: chainCount(G, pid, e) })).filter(c => c.n > 0)
    .map(c => `${ELEMENTS[c.e].icon}${ELEMENTS[c.e].name}×${c.n}（通行料×${chainMult(c.n).toFixed(1)}）`).join("　") || "なし";
  const ch = (typeof charOf === "function") ? charOf(p) : null;
  const face = ch ? charPortraitSVG(ch, 30) : P_ICONS[pid];
  const row = (k, v) => `<div class="cd-row"><span class="cd-k">${k}</span><span class="cd-v">${v}</span></div>`;
  const landHtml = lands.length
    ? lands.map(t => {
        const cr = t.creature ? CARD_BY_ID[t.creature.cardId] : null;
        const crTxt = cr
          ? `${ELEMENTS[cr.element].icon}${esc(cr.name)}（HP ${currentHp(t.creature)}/${maxHpOf(t.creature)}）`
          : `<span class="ip-empty">空き（クリーチャー無し）</span>`;
        return `<div class="ip-land"><span class="ipl-no">#${t.id}</span>` +
          `<span>${ELEMENTS[t.element].icon}Lv${t.level}・価値${landValue(t)}G</span>` +
          `<span>${crTxt}</span><span class="ipl-toll">通行料 ${tollOf(G, t)}G</span></div>`;
      }).join("")
    : `<div class="ip-empty">まだ領地はありません</div>`;
  let pop = document.getElementById("info-pop");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "info-pop";
    document.body.appendChild(pop);
  }
  pop.innerHTML = `<div class="ip-box">
      <div class="ip-name" style="color:${PLAYER_COLORS[pid]}">${face} ${esc(p.name)}
        <span class="p-rank r${me.rank}">${rankMedal(me.rank)} ${me.rank}位</span></div>
      ${row("魔力", `<b>${p.magic}G</b>`)}
      ${row("総資産", `<b>${me.assets}G</b> / ${RULES.target}G　（魔力 ${p.magic}G ＋ 領地 ${landTotal}G）`)}
      ${row("順位", `${rankGapText(rows, me) || "—"}`)}
      ${row("連鎖", chains)}
      ${row("関門", `${gates}（${p.gates.size} / ${needed}）`)}
      ${row("周回", `${p.laps} 周`)}
      ${row("手札 / 山札 / 捨札", `${p.hand.length}枚 / ${p.deck.length}枚 / ${p.discard.length}枚`)}
      <div class="ip-lands"><div class="cd-abs-t">🏞 所有地 ${lands.length}か所（合計 ${landTotal}G）</div>${landHtml}</div>
      <div class="cd-hint">クリックで閉じる</div>
    </div>`;
  pop.classList.add("show");
  pop.onclick = () => pop.classList.remove("show");
}

// ---------- 条件つきカードの「いま使えるか」（v31） ----------
// ⚒逆転スペル（card.underdog）＝自分が劣勢のときだけ／⚔決戦スペル（card.climax）＝決戦の刻だけ、という
// 使用条件は v30 までカードの説明文の中にしか無く、「そもそも条件が来ないカード」に見えていた（原さん指摘）。
// v31 では条件を緩めたうえで、手札・カード詳細に「⚒逆転 いま使える／まだ」の帯を出して状態を見せる。
// 戻り値: null（条件なし）／ { icon, label, ok, why }
function conditionGate(g, p, card) {
  if (!card || !g || !p) return null;
  if (card.underdog) {
    const ok = isUnderdog(g, p);
    return { icon: "⚒", label: "逆転", ok,
      why: ok ? "劣勢のいま使える" : `総資産が首位の${Math.round(COMEBACK_RATIO * 100)}%未満のときだけ使える` };
  }
  if (card.climax) {
    const ok = !!g.climax;
    return { icon: "⚔", label: "決戦", ok,
      why: ok ? "決戦の刻——いま使える" : "決戦の刻（目標資産の8割到達 or ラウンド上限の6割）になると使える" };
  }
  return null;
}

// 🤝絆が「いま成立しているか」（対戦中の自分の盤面で相方が駐留しているか）。
// アルバム・デッキ構築など対戦外では常に false（点灯なし）
function bondLit(card) {
  if (!card || !card.bond) return false;
  if (typeof G === "undefined" || !G || G.over || !G.players) return false;
  const me = G.hotseat ? G.current : 0;
  return !!bondPartnerTile(G, me, card, null);
}

// ---------- 手札 ----------
function cardHTML(c, opts = {}) {
  const typeCls = c.type === "creature" ? `el-${c.element}` : c.type;
  const rar = cardRarity(c);
  const cls = ["card", typeCls, `rar-${rar}`];
  if (opts.disabled) cls.push("disabled");
  if (opts.selectable) cls.push("selectable");
  if (opts.fixed) cls.push("fixed"); // フリップ演出用の固定サイズ（表裏のサイズを一致させる）
  const abil = (c.ab || []).map(a => `<span class="ab">${ABILITY_INFO[a].name}</span>`).join("")
    // 🤝絆（v31）: 相方が盤上にいるときだけ働く効果。対戦中は成立していれば光らせる
    + (c.bond ? `<span class="ab bond${bondLit(c) ? " lit" : ""}" title="🤝${esc(c.bond.name)}（相方: ${esc(bondPartnerNames(c))}）&#10;${esc(c.bond.desc)}">🤝${esc(c.bond.name)}</span>` : "");
  const body = c.type === "creature"
    ? `<div class="c-stats"><span class="c-st">ST ${c.st}</span><span class="c-hp">HP ${c.hp}</span></div><div class="c-ab">${abil}</div>`
    : `<div class="c-desc">${esc(c.desc)}</div>`;
  const elemIcon = c.type === "creature" ? ELEMENTS[c.element].icon
    : c.type === "item" ? (c.st > 0 ? "⚔️" : "🛡️") : "✨";
  const rm = RARITY_META[rar];
  // v31: 使用条件つきのカードは「⚒逆転／⚔決戦」の帯を出し、いま使えるなら光らせる
  const gate = opts.gate;
  if (gate) cls.push(gate.ok ? "gate-on" : "gate-off");
  const gateHtml = gate
    ? `<span class="c-gate ${gate.ok ? "on" : "off"}" title="${esc(gate.why)}">${gate.icon}${gate.label}${gate.ok ? "" : "…"}</span>`
    : "";
  // 額縁＋アート窓＋コスト宝珠＋魔力の光沢（.c-shine）で「魔力の込められたカード」を表現
  return `<div class="${cls.join(" ")}" data-card="${c.id}" title="${esc(c.type === 'spell' ? c.desc : (c.ab || []).map(a => ABILITY_INFO[a].name + ': ' + ABILITY_INFO[a].desc).join(' / '))}">
    <div class="c-art">${typeof cardArtSVG === "function" ? cardArtSVG(c) : ""}</div>${gateHtml}
    <span class="c-cost" title="コスト ${c.cost}G">${c.cost}</span>
    <span class="c-rarity" style="color:${rm.color}" title="${rm.label}">${rm.stars}</span>
    <span class="c-elem" title="${c.type === "creature" ? ELEMENTS[c.element].name + "属性" : c.type === "item" ? "アイテム" : "スペル"}">${elemIcon}</span>
    <div class="c-name">${esc(c.name)}</div><div class="c-body">${body}</div>
    ${opts.ribbon ? `<span class="c-ribbon ${opts.ribbonCls || ""}">${opts.ribbon}</span>` : ""}
    <div class="c-shine"></div></div>`;
}

// 属性相性（4すくみ）の関係を返す: "adv"=meが有利 / "dis"=meが不利 / "even"=互角 / "none"=無属性が絡む（輪の外）
function elemRelation(myElem, foeElem) {
  if (myElem === "neutral" || foeElem === "neutral") return "none";
  if (hasElemAdvantage(myElem, foeElem)) return "adv";
  if (hasElemAdvantage(foeElem, myElem)) return "dis";
  return "even";
}
// 相性の輪（🔥→🌳→⛰️→💧→🔥）のミニ表示。hl に指定した属性を光らせる
function elemWheelHTML(hl = []) {
  const ring = ["fire", "wood", "earth", "water"];
  const chip = e => `<span class="ew-chip ${hl.includes(e) ? "ew-hl" : ""}" style="--ec:${ELEMENTS[e].color}">${ELEMENTS[e].icon}${ELEMENTS[e].name}</span>`;
  return `<span class="elem-wheel" title="属性相性の輪: 左が右に強い（4すくみ）">` +
    ring.map(chip).join(`<span class="ew-arrow">→</span>`) +
    `<span class="ew-arrow">→</span>${chip("fire")}</span>`;
}

// ---------- カード詳細ポップアップ（v22） ----------
// 📚アルバム・🛠デッキ構築・🎁シールド戦・🗑捨札から、カード1枚のフルサイズ表示＋
// ステータス＋特性（能力）の説明を確認できる。既存のダイアログ（#overlay）の上に重なる独立レイヤー。
// クリック（背景・✖）で閉じる。ゲーム進行には一切影響しない（表示のみ）。
function showCardDetail(cardId) {
  const c = CARD_BY_ID[cardId];
  if (!c) return;
  let pop = document.getElementById("card-pop");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "card-pop";
    document.body.appendChild(pop);
  }
  const rm = RARITY_META[cardRarity(c)];
  const setInfo = CARD_SETS.find(s => s.set === cardSet(c));
  const typeName = c.type === "creature" ? `クリーチャー（${ELEMENTS[c.element].icon}${ELEMENTS[c.element].name}属性）`
    : c.type === "item" ? "アイテム" : "スペル";
  const row = (k, v) => `<div class="cd-row"><span class="cd-k">${k}</span><span class="cd-v">${v}</span></div>`;
  let info = row("タイプ", typeName) + row("コスト", `${c.cost}G`) +
    row("レア度", `<span style="color:${rm.color}">${rm.stars} ${rm.label}</span>`) +
    row("収録", `${setInfo.icon} ${esc(setInfo.name)}`);
  if (c.type === "creature") {
    info += row("ST / HP", `⚔ ${c.st} ／ ❤️ ${c.hp}`);
    if (c.element === "neutral") {
      info += row("属性相性", `⚪ 相性の輪の<b>外</b>＝有利・不利なし（土地の加護も受けない）`);
    } else {
      const beats = ELEM_ADVANTAGE[c.element]; // この属性が有利を取る相手
      const beatenBy = LAND_ELEMENTS.find(e => ELEM_ADVANTAGE[e] === c.element); // この属性に有利を取る相手
      info += row("属性相性", `${ELEMENTS[beats].icon}${ELEMENTS[beats].name}に<b>有利</b>（ST+${ELEM_ADV_ST}）／` +
        `${ELEMENTS[beatenBy].icon}${ELEMENTS[beatenBy].name}が<b>苦手</b>（相手にST+${ELEM_ADV_ST}）` +
        `<div class="cd-wheel">${elemWheelHTML([c.element])}</div>`);
    }
  }
  if (c.type === "item") info += row("補正", `${c.st ? `ST+${c.st} ` : ""}${c.hp ? `HP+${c.hp}` : ""}` || "—");
  // v31: 使用条件つきのカードは条件と「対戦中ならいま満たしているか」を明記する
  if (c.underdog || c.climax) {
    const g2 = (typeof G !== "undefined" && G && !G.over) ? G : null;
    const gate = g2 ? conditionGate(g2, g2.players[0], c) : null;
    const base = c.underdog
      ? `⚒ <b>逆転</b>: 自分の総資産が<b>首位の${Math.round(COMEBACK_RATIO * 100)}%未満</b>のときだけ使える`
      : `⚔ <b>決戦</b>: <b>決戦の刻</b>（誰かが目標資産の8割に到達 or ラウンドが上限の6割）だけ使える`;
    info += row("使用条件", base + (gate ? `<br><span class="cd-gate ${gate.ok ? "on" : "off"}">${gate.ok ? "✅ いま使える" : "⏳ いまは条件を満たしていない"}</span>` : ""));
  }
  // v25: 二形（hybrid）＝武具として装備したときの補正も併記する
  if (c.asItem) info += row("武具として", `${c.asItem.st ? `⚔ ST+${c.asItem.st} ` : ""}${c.asItem.hp ? `🛡 HP+${c.asItem.hp}` : ""}（装備すると使い切り）`);
  // 特性（能力）は名前だけでなく説明文まで表示（今回の要望の中心）
  const abHtml = (c.ab || []).length
    ? `<div class="cd-abs"><div class="cd-abs-t">🔖 特性</div>` +
      c.ab.map(a => `<div class="cd-ab"><b class="ab">${ABILITY_INFO[a].name}</b><span>${esc(ABILITY_INFO[a].desc)}</span></div>`).join("") + `</div>`
    : "";
  // 🤝絆（v31）: 相方と効果、対戦中なら「いま成立しているか」まで見せる
  const bondHtml = c.bond ? (() => {
    const lit = bondLit(c);
    return `<div class="cd-abs"><div class="cd-abs-t">🤝 絆「${esc(c.bond.name)}」<span class="cd-bond-kind">${BOND_KIND_LABEL[c.bond.kind] || ""}</span></div>` +
      `<div class="cd-ab"><b class="ab">相方</b><span>${esc(bondPartnerNames(c))}<b>が自分の領地に駐留している間</b>だけ働く</span></div>` +
      `<div class="cd-ab"><b class="ab">効果</b><span>${esc(c.bond.desc)}</span></div>` +
      (typeof G !== "undefined" && G && !G.over
        ? `<div class="cd-gate ${lit ? "on" : "off"}">${lit ? "✅ いま成立している" : "⏳ 相方がまだ盤上にいない"}</div>` : "") +
      `</div>`;
  })() : "";
  const descHtml = c.desc ? `<div class="cd-abs"><div class="cd-abs-t">✨ 効果</div><div class="cd-desc">${esc(c.desc)}</div></div>` : "";
  pop.innerHTML = `<div class="cd-box">
      <button class="cd-close" title="閉じる">✖</button>
      <div class="cd-flex">
        <div class="cd-card">${cardHTML(c)}</div>
        <div class="cd-info">
          <div class="cd-name">${esc(c.name)}</div>
          ${info}${abHtml}${bondHtml}${descHtml}
        </div>
      </div>
      <div class="cd-hint">クリックで閉じる</div>
    </div>`;
  pop.classList.add("show");
  const close = () => pop.classList.remove("show");
  pop.onclick = close; // 背景・✖・どこをクリックしても閉じる（表示専用）
}

// 3Dフリップできるカード（裏面=共通のカードバック／表面=カード本体）。
// .revealed を付けると裏→表にめくれる。手札のオープン・ドロー・パック開封で使う。
// 表裏が「同じ1枚のカード」に見えるよう、表面は固定サイズ（.card.fixed）で描画し、
// 裏面はグリッドセル（＝表面と同寸）いっぱいに広がる。
function flipCardHTML(c, opts = {}) {
  return `<div class="flip3d${opts.revealed ? " revealed" : ""}"${c ? ` data-flip="${c.id}"` : ""}>
    <div class="flip3d-inner">
      <div class="flip3d-face flip3d-back">${CARD_BACK_HTML}</div>
      <div class="flip3d-face flip3d-front">${c ? cardHTML(c, { ...opts, fixed: true }) : ""}</div>
    </div>${opts.badge || ""}</div>`;
}

function renderHand(g) {
  // 通常はプレイヤー0（人間）の手札。2人対戦（ホットシート）では手番プレイヤーの手札を表示する
  const p = g.players[g.hotseat ? g.current : 0];
  const el = document.getElementById("hand");
  if (g.hotseat && UI.handHidden) {
    // 手番交代画面の間は伏せて、次のプレイヤーの手札が前のプレイヤーに見えないようにする
    el.innerHTML = p.hand.map(() => `<div class="card facedown" title="交代中は伏せられています">${CARD_BACK_HTML}</div>`).join("");
  } else {
    // v31: 条件つきカード（⚒逆転＝劣勢のみ／⚔決戦＝決戦の刻のみ）は、
    //      いま使えるかどうかを手札の上で見せる（原さん要望「分かりやすく設定し直す」）
    el.innerHTML = p.hand.map(id => cardHTML(CARD_BY_ID[id], { gate: conditionGate(g, p, CARD_BY_ID[id]) })).join("");
  }
  document.getElementById("hand-count").textContent =
    (g.hotseat ? `${p.name}の` : "") + `手札 ${p.hand.length}/${HAND_LIMIT}`;
  updateHandArrows();
}

// ---------- 手札の矢印送り ----------
// スマホでは手札の横スワイプがAndroidの「戻る」ジェスチャーと衝突してゲームが終了してしまうため、
// はみ出した手札は ◀▶ ボタンで1枚ずつ送れるようにする（オーバーフロー時のみ表示）。
function updateHandArrows() {
  const hand = document.getElementById("hand");
  const prev = document.getElementById("hand-prev");
  const next = document.getElementById("hand-next");
  if (!hand || !prev || !next) return;
  const overflow = hand.scrollWidth > hand.clientWidth + 4;
  prev.classList.toggle("hidden", !overflow);
  next.classList.toggle("hidden", !overflow);
  if (!overflow) return;
  prev.disabled = hand.scrollLeft <= 2;
  next.disabled = hand.scrollLeft >= hand.scrollWidth - hand.clientWidth - 2;
}
function initHandArrows() {
  const hand = document.getElementById("hand");
  const step = () => {
    const card = hand.querySelector(".card, .flip3d");
    return card ? card.getBoundingClientRect().width + 8 : 110; // カード1枚ぶんずつ送る
  };
  // スクロール直後に矢印の有効/無効を更新する（scrollイベントが飛ばない環境があるためクリック側でも直接呼ぶ）
  const go = dir => { hand.scrollBy({ left: dir * step() }); updateHandArrows(); };
  document.getElementById("hand-prev").addEventListener("click", () => go(-1));
  document.getElementById("hand-next").addEventListener("click", () => go(1));
  hand.addEventListener("scroll", updateHandArrows, { passive: true });
  window.addEventListener("resize", updateHandArrows);
}

// ---------- ゲーム開始の手札オープン演出 ----------
// 全カードが表紙（カードバック）側で配られ、1枚ずつめくれて対戦が始まる
async function handIntro(g) {
  const p = g.players[0];
  const el = document.getElementById("hand");
  el.innerHTML = p.hand.map(id => flipCardHTML(CARD_BY_ID[id])).join("");
  await sleep(420);
  for (const f of el.querySelectorAll(".flip3d")) {
    f.classList.add("revealed");
    SFX.flip();
    await sleep(150);
  }
  await sleep(500);
  renderHand(g);
}

// ---------- ドロー演出 ----------
// 山札からカードが現れ、めくれて手札へ吸い込まれる（人間のドロー時のみ）
async function animateDraw(card) {
  const host = document.createElement("div");
  host.id = "draw-fx";
  host.innerHTML = flipCardHTML(card);
  document.body.appendChild(host);
  SFX.draw();
  await sleep(120);
  host.querySelector(".flip3d").classList.add("revealed");
  SFX.flip();
  await sleep(620);
  host.classList.add("to-hand"); // 手札ウィンドウへ吸い込まれる
  await sleep(300);
  host.remove();
}

function renderAll(g) {
  renderBoard(g);
  renderPanels(g);
  renderHand(g);
  // 手札の枚数や⚑凱旋リーチ表示で上部・下段の高さが変わるので、そのたびに位置基準を測り直す
  // （盤面の等倍サイズ --board-base もここで更新＝盤面が下段に食い込まない）
  syncHudMetrics();
}

// ---------- タイトル画面（起動時の世界観演出） ----------
// マナの粒子が瞬く夜空＋ゆっくり回る大紋章＋地平のクリーチャーシルエット。
// 画面のどこかをクリック／タップでフェードアウトしてメニューへ。
function showTitleScreen() {
  return new Promise(resolve => {
    const el = document.createElement("div");
    el.id = "title-screen";
    // マナの粒子（ランダム配置・明滅）
    const stars = Array.from({ length: 46 }, () => {
      const sz = (Math.random() * 2 + 1).toFixed(1);
      return `<span class="ts-star" style="left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 88).toFixed(1)}%;` +
        `width:${sz}px;height:${sz}px;animation-duration:${(2.2 + Math.random() * 3.4).toFixed(1)}s;animation-delay:-${(Math.random() * 4).toFixed(1)}s"></span>`;
    }).join("");
    el.innerHTML = `
      ${stars}
      <div class="ts-center">
        <div class="ts-emblem">${TITLE_EMBLEM_SVG}</div>
        <h1 class="ts-title">マナサーキット</h1>
        <div class="ts-sub">— MANA CIRCUIT —</div>
        <p class="ts-flavor">大地に張り巡らされた魔力の回路が、いま目を覚ます。<br>
          クリーチャーを従え、土地を繋ぎ、四大のマナを我が手に。<br>
          環を制する者こそ、次代の大魔導師。</p>
        <div class="ts-start">✦ クリック / タップ で始める ✦</div>
      </div>
      <div class="ts-frieze">${TITLE_FRIEZE_SVG}</div>`;
    document.body.appendChild(el);
    el.addEventListener("click", () => {
      if (typeof SFX !== "undefined" && SFX.bless) SFX.bless(); // 荘厳なアルペジオで開幕
      el.classList.add("ts-out");
      setTimeout(() => { el.remove(); resolve(); }, 650);
    }, { once: true });
  });
}

// ---------- 盤面ズーム（拡大縮小して読みやすく） ----------
let BOARD_ZOOM = 1;
// 直近の自動フィット倍率。BOARD_ZOOM がこれと同じ＝「自分では拡大していない」状態なので、
// 表示領域が変わったとき（情報窓の開閉・画面回転・マップ確認モード）に自動で合わせ直してよい
let AUTO_FIT_ZOOM = null;
// ZOOM_MIN は「⛶ 全体」フィットで大きな盤面を1画面に収められるよう低め（0.3）にしてある
const ZOOM_MIN = 0.3, ZOOM_MAX = 2.6, ZOOM_STEP = 0.2;
function applyZoom() {
  const svg = document.getElementById("board");
  if (svg) svg.style.setProperty("--zoom", BOARD_ZOOM.toFixed(2));
  const lbl = document.getElementById("zoom-label");
  if (lbl) lbl.textContent = `${Math.round(BOARD_ZOOM * 100)}%`;
}
function zoomBoard(delta) {
  BOARD_ZOOM = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(BOARD_ZOOM + delta).toFixed(2)));
  applyZoom();
}
function resetZoom() { BOARD_ZOOM = 1; applyZoom(); }
// 「⛶ 全体」: 盤面全体が #board-wrap に収まる倍率へ調整する（見えないマスを無くす）。
// opts.max を指定すると倍率の上限（対戦開始時は 1＝拡大はしない）
function fitBoard(opts = {}) {
  const wrap = document.getElementById("board-wrap");
  const svg = document.getElementById("board");
  if (!wrap || !svg) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const baseW = rect.width / BOARD_ZOOM, baseH = rect.height / BOARD_ZOOM; // 等倍時のサイズを逆算
  let z = Math.min((wrap.clientWidth - 10) / baseW, (wrap.clientHeight - 10) / baseH);
  if (opts.max !== undefined) z = Math.min(z, opts.max);
  BOARD_ZOOM = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +z.toFixed(2)));
  AUTO_FIT_ZOOM = BOARD_ZOOM; // 「自動で合わせた倍率」として覚える（maybeRefitBoard の判定用）
  applyZoom();
  wrap.scrollTo({ left: 0, top: 0 });
}

// ============================================================
// 表示トグル（v27）— 👥情報窓 / 📜ログ / 🃏手札 / 🗺マップ確認
// ------------------------------------------------------------
// 情報窓・手札・ダイスは盤面に重ならないフロー配置になったので、隠す目的は
// 「盤面をもっと広く見たい」ことに絞られた。切り替えは上部バーの4つのボタンに集約し、
// 各ウィンドウの「✕」も同じ関数を呼ぶ（＝状態が1か所に集まって食い違わない）。
// 選んだ状態は localStorage に残す（毎回同じ好みで遊べるように）。
// ============================================================
const HUD_PREF_KEY = "mana-circuit-hud";
// 既定: 情報窓＝出す／ログ＝広い画面だけ出す（狭い画面ではログが盤面に重なるため既定オフ。
// 通知トースト（v26）があるので閉じていても重要な出来事は分かる）／手札＝開いた状態
function defaultHudPrefs() {
  return { panels: true, log: window.innerWidth > 980, hand: true };
}
let HUD_PREFS = defaultHudPrefs();
// 自分で選んだ設定が保存されているか（無い間は画面幅に応じた既定を使い続ける＝
// 小さい窓で開いてから最大化した場合などに「なぜかログが出ない」状態が固定されない）
function hasSavedHudPrefs() {
  try { return localStorage.getItem(HUD_PREF_KEY) != null; } catch (e) { return false; }
}
function loadHudPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem(HUD_PREF_KEY));
    if (s && typeof s === "object") return { ...defaultHudPrefs(), ...s };
  } catch (e) { /* プライベートモード等 */ }
  return defaultHudPrefs();
}
function saveHudPrefs() {
  try { localStorage.setItem(HUD_PREF_KEY, JSON.stringify(HUD_PREFS)); } catch (e) { /* 無視 */ }
}
// v27でレイアウトが変わったので、最初の1回だけ切り替え方を案内する（保存できない環境では出さない）
const HUD_HINT_KEY = "mana-circuit-hint-v27";
function showLayoutHintOnce() {
  try {
    if (localStorage.getItem(HUD_HINT_KEY)) return;
    localStorage.setItem(HUD_HINT_KEY, "1");
  } catch (e) { return; }
  toast("🗺 で盤面を大きく確認／👥📜🃏 で情報窓・ログ・手札を切替できます", "sys");
}
// 隠したときに出す短い案内（戻し方が分からなくならないように）
const VIEW_HINTS = {
  panels: "👥 情報窓を隠しました（上部の👥で戻せます）",
  log: "📜 ログを隠しました（上部の📜で戻せます）",
  hand: "🃏 手札を畳みました（上部の🃏で戻せます）",
};
function applyHudPrefs() {
  const strips = document.getElementById("pstrips");
  if (strips) strips.classList.toggle("hidden", !HUD_PREFS.panels);
  const logWin = document.getElementById("win-log");
  if (logWin) logWin.classList.toggle("hidden", !HUD_PREFS.log);
  // 手札は「畳む」（完全に消さない＝枚数の帯は残す）
  document.body.classList.toggle("hand-min", !HUD_PREFS.hand);
  renderViewToggles();
  syncHudMetrics();
  maybeRefitBoard();
  updateHandArrows();
}
function toggleView(key) {
  if (!(key in HUD_PREFS)) return;
  HUD_PREFS[key] = !HUD_PREFS[key];
  saveHudPrefs();
  applyHudPrefs();
  if (!HUD_PREFS[key] && VIEW_HINTS[key]) toast(VIEW_HINTS[key], "sys");
}
function renderViewToggles() {
  const set = (id, off, on) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.toggle("off", !!off);
    b.classList.toggle("on", !!on);
  };
  set("view-panels", !HUD_PREFS.panels);
  set("view-log", !HUD_PREFS.log);
  set("view-hand", !HUD_PREFS.hand);
  set("view-map", false, !!UI.mapFocus);
}

// ---------- 上部エリア／下段の実測高さをCSS変数に流す ----------
// セリフ吹き出し・ポップアップ通知・「選択に戻る」ボタンの位置をこの値から決めている
// （v26まではpx直書きで、レイアウトを変えるたびに重なりの調整が必要だった）
// 盤面の等倍サイズ（--board-base）も同時に更新する: 盤面エリアの高さ＝100% になるので、
// 情報窓・手札を畳んだぶんがそのまま盤面の大きさになり、「100%」の意味も分かりやすい
function syncHudMetrics() {
  const h = (document.querySelector("header")?.offsetHeight || 0) +
            (document.getElementById("hud-top")?.offsetHeight || 0);
  const bar = document.getElementById("bottom-bar");
  const bh = (bar && getComputedStyle(bar).display !== "none") ? bar.offsetHeight : 0;
  const root = document.documentElement;
  root.style.setProperty("--hud-h", `${Math.round(h)}px`);
  root.style.setProperty("--bottom-h", `${Math.round(bh)}px`);
  const wrap = document.getElementById("board-wrap");
  // clientHeight はスクロールバーを除いた内側の高さ。8px引いて、拡大時に横スクロールバーが
  // 出ても「縮む→出ない→また伸びる」の往復にならないようにしている
  if (wrap && wrap.clientHeight > 80) {
    root.style.setProperty("--board-base", `${Math.round(wrap.clientHeight - 8)}px`);
  }
}

// ---------- 🗺 マップ確認モード ----------
// 情報窓・ログ・手札を一時的に片付けて「マス目の表示を最優先」にする。
// 解除すると元の倍率に戻る（マップを見るために拡大した状態が残らないように）。
UI.mapFocus = false;
UI._zoomBeforeMap = null;
function setMapFocus(on) {
  on = !!on;
  if (UI.mapFocus === on) return;
  UI.mapFocus = on;
  document.body.classList.toggle("map-focus", on);
  if (on) {
    UI._zoomBeforeMap = BOARD_ZOOM;
    syncHudMetrics();
    fitBoard(); // 空いた領域いっぱいに盤面を広げる（拡大の上限なし＝マスを大きく見せる）
    toast("🗺 マップ確認モード（もう一度🗺で戻ります）", "sys");
  } else {
    syncHudMetrics();
    if (UI._zoomBeforeMap != null) { BOARD_ZOOM = UI._zoomBeforeMap; applyZoom(); }
    UI._zoomBeforeMap = null;
  }
  renderViewToggles();
}
function toggleMapFocus() { setMapFocus(!UI.mapFocus); }
function exitMapFocus() { setMapFocus(false); }

// 盤面の自動フィット: 「自動で合わせた倍率のまま（＝自分で拡大縮小していない）」ときだけ
// 表示領域の変化に追随する。手で拡大した倍率を勝手に戻さないための判定。
function maybeRefitBoard() {
  if (typeof G === "undefined" || !G || !G.tiles) return;
  if (UI.mapFocus) { fitBoard(); return; }
  if (AUTO_FIT_ZOOM != null && Math.abs(BOARD_ZOOM - AUTO_FIT_ZOOM) < 0.005) fitBoard({ max: 1 });
}

function initHudWindows() {
  HUD_PREFS = loadHudPrefs();
  // 各ウィンドウの「✕」もトグルと同じ処理を呼ぶ（状態が食い違わないように）
  const closeMap = { "win-log": "log", "win-hand": "hand" };
  Object.entries(closeMap).forEach(([winId, key]) => {
    const btn = document.getElementById(winId)?.querySelector(".win-close");
    if (btn) btn.addEventListener("click", () => { if (HUD_PREFS[key]) toggleView(key); });
  });
  document.getElementById("view-panels")?.addEventListener("click", () => toggleView("panels"));
  document.getElementById("view-log")?.addEventListener("click", () => toggleView("log"));
  document.getElementById("view-hand")?.addEventListener("click", () => toggleView("hand"));
  document.getElementById("view-map")?.addEventListener("click", toggleMapFocus);
  // 情報窓のクリックで詳細ポップアップ（イベント委譲＝毎回の再描画で付け直さない）
  document.getElementById("pstrips")?.addEventListener("click", e => {
    const strip = e.target.closest && e.target.closest(".pstrip");
    if (strip && strip.dataset.pid !== undefined) showPlayerDetail(Number(strip.dataset.pid));
  });
  applyHudPrefs();
  initHandArrows();
}

// ---------- ログ ----------
// 📜ログウィンドウを閉じて遊ぶ人のために、「影響のある出来事」は同じ文言をポップアップ（toast）にも出す。
// どの行を出すかの既定ルール:
//   ・cls === "warn"      → 出す（このコードベースでは warn ＝ 妨害・機能停止・魔力不足など「効いた」出来事）
//   ・castSpell 実行中     → 出す（スペルの効果ログ。beginLogToast/endLogToast のスコープ内。
//                            新しいスペルを足しても toast の付け忘れが起きないようにするため）
//   ・cls === "battle"    → 出さない（バトル実況は1戦で何行も流れるのでポップアップには不向き）
//   ・それ以外            → 出さない
// 個別に上書きしたいときは第3引数で `{ toast: true }` / `{ toast: false }` を渡す
// （特性の発動・通行料・周回など「ログでしか分からない出来事」は明示的に true にしている）。
function log(msg, cls = "", opts = {}) {
  const el = document.getElementById("log");
  const div = document.createElement("div");
  div.className = `log-line ${cls}`;
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  const auto = cls === "warn" || (UI.logToastScope > 0 && cls !== "battle");
  if (opts.toast !== undefined ? opts.toast : auto) toast(msg, opts.kind !== undefined ? opts.kind : cls);
}

// ---------- ポップアップ通知（toast） ----------
// 画面上部にすっと現れてすぐ消える非ブロッキングの通知。pointer-events:none なので
// 盤面のクリック・ダイアログの操作を一切邪魔しない（＝進行フローに影響しない表示専用レイヤー）。
UI.logToastScope = 0; // >0 の間は log() が既定でポップアップも出す（castSpell のスコープ）
const TOAST_MAX = 3;         // 同時に見せる最大数。これを超えたら古いものから先に退場させる
const TOAST_LIFE = 2600;     // 表示時間(ms)＝「すぐ消える」
const TOAST_LIFE_BUSY = 1500; // 立て込んでいるとき（スペルの連鎖など）の短縮表示(ms)
function toast(msg, kind = "") {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast${kind ? ` t-${kind}` : ""}`;
  el.textContent = msg;
  stack.appendChild(el);
  const live = Array.from(stack.children).filter(c => !c.classList.contains("t-out"));
  // 溢れた分は先に退場（画面が通知で埋まって盤面が見えなくなるのを防ぐ）
  live.slice(0, Math.max(0, live.length - TOAST_MAX)).forEach(old => dismissToast(old, 180));
  requestAnimationFrame(() => el.classList.add("t-in"));
  el._toastTimer = setTimeout(() => dismissToast(el), live.length > TOAST_MAX ? TOAST_LIFE_BUSY : TOAST_LIFE);
}
function dismissToast(el, wait = 320) {
  if (!el || el.classList.contains("t-out")) return;
  clearTimeout(el._toastTimer);
  el.classList.remove("t-in");
  el.classList.add("t-out");
  setTimeout(() => el.remove(), wait);
}
// castSpell の間だけ「効果ログ＝ポップアップにも出す」スコープを張る（main.js の castSpell が使う）
function beginLogToast() { UI.logToastScope++; }
function endLogToast() { UI.logToastScope = Math.max(0, UI.logToastScope - 1); }
// 対戦をまたいで残らないように（リトライ・タイトルへ戻るとき）
function clearToasts() {
  const stack = document.getElementById("toast-stack");
  if (stack) stack.innerHTML = "";
  UI.logToastScope = 0;
}

// ---------- メッセージ（中央の大きな表示） ----------
function setMessage(msg) {
  document.getElementById("message").textContent = msg;
}

// ---------- 汎用ダイアログ（Promiseベース） ----------
// opts: { title, body?, cards?: [{card, disabled, note}], buttons: [{label, value, primary}], peek? }
// peek:true を渡すと「👁 盤面を確認」ボタンが付き、決定を保留したまま一旦閉じて盤面/手札を見られる
// 解決値: { action: value } または { action: "card", cardId }
function showDialog(opts) {
  return new Promise(resolve => {
    closePassiveDialog(); // 開きっぱなしの受け身ダイアログ（🔍マス情報など）は自動で閉じる
    UI.dialogBusy++;
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const restoreBtn = document.getElementById("peek-restore");
    let html = `<h2>${esc(opts.title)}</h2>`;
    if (opts.body) html += `<p class="dlg-body">${opts.body}</p>`;
    if (opts.cards && opts.cards.length) {
      html += `<div class="dlg-cards">` +
        opts.cards.map(ci => cardHTML(ci.card, { disabled: ci.disabled, selectable: !ci.disabled, ribbon: ci.ribbon, ribbonCls: ci.ribbonCls })).join("") +
        `</div>`;
    }
    html += `<div class="dlg-buttons">`;
    if (opts.peek) html += `<button class="btn dlg-peek" data-peek="1" title="このウインドウを一旦閉じて盤面・手札を確認します（選択はそのまま保留されます）">👁 盤面を確認</button>`;
    html += opts.buttons.map(b => `<button class="btn ${b.primary ? "primary" : ""}" data-value="${esc(b.value)}">${esc(b.label)}</button>`).join("") +
      `</div>`;
    box.innerHTML = html;
    overlay.classList.add("show");

    // 「👁 盤面を確認」: ダイアログを一旦隠し、フローティングの「選択に戻る」ボタンを出す（決定は保留）
    const clearPeek = () => { restoreBtn.classList.add("hidden"); restoreBtn.onclick = null; };
    const peek = () => {
      overlay.classList.remove("show");
      restoreBtn.classList.remove("hidden");
      restoreBtn.onclick = () => { overlay.classList.add("show"); clearPeek(); };
    };
    const close = result => {
      if (opts.passive && UI._passiveClose === closeSelf) UI._passiveClose = null;
      UI.dialogBusy = Math.max(0, UI.dialogBusy - 1);
      overlay.classList.remove("show");
      clearPeek();
      resolve(result);
    };
    const closeSelf = () => close({ action: "dismiss" });
    if (opts.passive) UI._passiveClose = closeSelf; // 受け身ダイアログとして登録（後続のダイアログが自動で閉じられる）
    const peekBtn = box.querySelector("[data-peek]");
    if (peekBtn) peekBtn.addEventListener("click", peek);
    box.querySelectorAll(".dlg-cards .card.selectable").forEach(cardEl => {
      cardEl.addEventListener("click", () => close({ action: "card", cardId: cardEl.dataset.card }));
    });
    box.querySelectorAll(".dlg-buttons .btn:not(.dlg-peek)").forEach(btn => {
      btn.addEventListener("click", () => close({ action: btn.dataset.value }));
    });
  });
}

// ---------- 盤面から選べるタイルピッカー（領地・クリーチャー選択） ----------
// 候補マスを盤面で光らせ、①ダイアログのボタン ②「👁 盤面から選ぶ」→光ったマスを直接クリック、
// のどちらでも選べる。どのマスを指しているかは #番号（盤面＆ボタン）で対応づく。
// candidates: tile配列 / opts: { title, body, labelFn(tile)->string, cancelable?, cancelLabel? }
// 解決値: 選んだ tile（キャンセルなら null）
function humanPickTileOnMap(candidates, opts) {
  return new Promise(resolve => {
    closePassiveDialog(); // 開きっぱなしの受け身ダイアログは自動で閉じる
    UI.dialogBusy++;
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const restoreBtn = document.getElementById("peek-restore");
    const svg = document.getElementById("board");
    const ids = new Set(candidates.map(t => t.id));
    setSelectableTiles(ids);
    renderBoard(G);

    const onBoardClick = e => {
      const gEl = e.target.closest && e.target.closest(".tile");
      if (!gEl) return;
      const id = Number(gEl.dataset.tile);
      if (ids.has(id)) finish(G.tiles[id]);
    };
    function finish(tile) {
      UI.dialogBusy = Math.max(0, UI.dialogBusy - 1);
      svg.removeEventListener("click", onBoardClick);
      restoreBtn.classList.add("hidden");
      restoreBtn.onclick = null;
      clearSelectableTiles();
      overlay.classList.remove("show");
      renderBoard(G);
      resolve(tile);
    }
    const peek = () => {
      overlay.classList.remove("show");
      restoreBtn.classList.remove("hidden");
      restoreBtn.textContent = "▲ 選択ウインドウに戻る";
      restoreBtn.onclick = () => { overlay.classList.add("show"); restoreBtn.classList.add("hidden"); };
    };

    // v25: 候補は「縦1列のリスト」で並べる。
    // 以前は .dlg-buttons（横並び・btnはwhite-space:nowrap）だったため、
    // 「🔥 火の土地 #12（Lv3・価値480G・💧アンダイン）」のような長いラベルがスマホ幅を突き抜けて
    // 右側が見切れていた（原さん報告）。リスト化＋折り返しで全文が読めるようにし、
    // 候補が多いときはリスト枠だけをスクロールさせて「👁 盤面から選ぶ／やめる」を常に画面内に残す。
    let html = `<h2>${esc(opts.title)}</h2>`;
    html += `<p class="dlg-body">${opts.body}<br>🖱 <b>盤面で光っているマス（#番号）を直接クリック</b>しても選べます（「👁 盤面から選ぶ」で盤面へ）。</p>`;
    html += `<div class="tile-pick-list">`;
    html += candidates.map(t => {
      const label = opts.labelFn(t);
      // ラベルに #番号 が含まれない種類のマス（城・関門など）には番号バッジを添えて盤面と対応づける
      const no = label.includes(`#${t.id}`) ? "" : `<span class="tp-no">#${t.id}</span>`;
      return `<button class="btn tile-pick" data-id="${t.id}">${no}<span class="tp-label">${label}</span></button>`;
    }).join("");
    html += `</div>`;
    html += `<div class="dlg-buttons tile-pick-actions">`;
    html += `<button class="btn dlg-peek" data-peek="1" title="盤面を表示して、光っているマスを直接クリックで選べます">👁 盤面から選ぶ</button>`;
    if (opts.cancelable) html += `<button class="btn" data-cancel="1">${esc(opts.cancelLabel || "やめる")}</button>`;
    html += `</div>`;
    box.innerHTML = html;
    overlay.classList.add("show");

    box.querySelector("[data-peek]").addEventListener("click", peek);
    box.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => finish(G.tiles[Number(b.dataset.id)])));
    const cancelBtn = box.querySelector("[data-cancel]");
    if (cancelBtn) cancelBtn.addEventListener("click", () => finish(null));
    svg.addEventListener("click", onBoardClick);
  });
}

// ---------- ステージ選択画面 ----------
// opts.training: トレーニング（練習対戦）モードのステージ選択
// opts.versus:   2人対戦のステージ選択 {names:[1P名, 2P名]}（全ステージ選択可）
// opts.royale:   三つ巴（人間1 + CPU2）のステージ選択（全ステージ選択可）
// opts.sealed:   シールド戦（その場開封の使い捨てプールで構築して1戦）のステージ選択（全ステージ選択可）
// 解決値: ステージ index（数値）／ "help" / "album" / "deck" / "training" / "versus" / "royale" / "sealed" / "workshop" / "weekly" / "matchlen" / "back"
function showStageSelect(opts = {}) {
  const training = !!opts.training;
  const versus = opts.versus || null;
  const royale = !!opts.royale;
  const sealed = !!opts.sealed;
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const prog = loadProgress();
    const rows = STAGES.map((s, i) => {
      const unlocked = versus || royale || sealed || isStageUnlocked(i); // 2人対戦・三つ巴・シールド戦は全ステージから選べる
      const cleared = !!prog.cleared[s.id];
      const desc = unlocked
        ? `${versus ? "" : royale ? `VS ${esc(s.cpuName)} ＋ 乱入者1名｜` : `VS ${esc(s.cpuName)}｜`}${buildBoard(s).length}マス｜目標 ${((s.rules && s.rules.target) || 4000)}G<br>${esc(s.desc)}`
        : "？？？（前のステージをクリアで解放）";
      return `<button class="stage-btn ${unlocked ? "" : "locked"}" data-idx="${i}" ${unlocked ? "" : "disabled"}>
        <span class="st-bg" aria-hidden="true">${unlocked ? s.icon : "🔒"}</span>
        <span class="st-icon">${unlocked ? s.icon : "🔒"}</span>
        <span class="st-main"><b><span class="st-no">STAGE ${i + 1}</span>${unlocked ? esc(s.name) : "？？？"}</b><small>${desc}</small></span>
        <span class="st-star">${cleared ? "⭐" : ""}</span>
      </button>`;
    }).join("");
    const diff = DIFFICULTIES[loadDifficulty()];
    const streak = (typeof trainingStreakCount === "function") ? trainingStreakCount() : 0;
    const wr = currentWeeklyRule();
    const wOn = weeklyEnabled();
    // 世界観ヘッダー（紋章＋題字＋口上＋状態チップ）
    const chips = arr => `<div class="ss-chips">${arr.filter(Boolean).map(t => `<span class="ss-chip">${t}</span>`).join("")}</div>`;
    const hero = (title, flavor, chipArr) => `
      <div class="ss-hero">
        <div class="ss-crest">${typeof TITLE_EMBLEM_SVG !== "undefined" ? TITLE_EMBLEM_SVG : ""}</div>
        <div class="ss-hero-main">
          <h2>${title}</h2>
          <p class="ss-flavor">${flavor}</p>
          ${chips(chipArr)}
        </div>
      </div>`;
    const ml = MATCH_LENGTHS[loadMatchLength()];
    const mlChip = loadMatchLength() !== "normal" ? `⏱ 決着: <b>${ml.icon}${ml.label}</b>` : "";
    const weeklyChip = wOn ? `🎪 今週のルール: <b>${esc(wr.name)}</b>` : "";
    const header = versus
      ? hero("🎮 決闘の間",
        `同じ卓を囲み、端末を手渡して覇を競う——友との真剣勝負。<b>全ステージから選択可</b>（報酬・進行度は変化しません）。`,
        [`🔵 <b>${esc(versus.names[0])}</b> vs 🔴 <b>${esc(versus.names[1])}</b>`, weeklyChip, mlChip])
      : sealed
      ? hero("🎁 シールド戦の間",
        `その場で開封した<b>第一弾4＋第二弾4＋第三弾4パック（計${SEALED_PACKS_PER_SET * SEALED_PACK_SIZE * 3}枚）</b>だけで
         ${DECK_SIZE}枚デッキを組み、ステージの主に挑む——<b>コレクションの厚さに関係なく誰でも対等</b>の腕くらべ。
         開封プールはコレクションに入りません（勝てば通常どおりカード${REWARD_WIN}枚獲得・進行度は変化しません）。<b>全ステージから選択可</b>。`,
        [`👤 <b>${esc(currentProfileName())}</b>`, `⚙ 難易度: <b>${diff.icon} ${diff.label}</b>`, weeklyChip, mlChip])
      : royale
      ? hero("⚔ 三つ巴の戦場",
        `🔵あなた・🔴ステージの主・🟢乱入者——<b>3人の魔導師</b>が同じ盤上で覇を競う。乱入者は毎回ランダム！
         勝てばカードを${REWARD_WIN}枚獲得（進行度は変化しません）。<b>全ステージから選択可</b>。`,
        [`👤 <b>${esc(currentProfileName())}</b>`, `⚙ 難易度: <b>${diff.icon} ${diff.label}</b>`, weeklyChip, mlChip])
      : training
      ? hero("🎯 修練の間",
        `腕とデッキを磨く練習対戦。<b>勝つとカードを${REWARD_TRAINING}枚獲得</b>（何度でも）。` +
        `🔥<b>${TRAINING_STREAK_FOR_RARE}連勝から</b>は毎回<b>レア以上1枚保証</b>（負け・投了でリセット）。`,
        [streak >= 1 ? `🔥 <b>${streak}連勝中</b>` : "", `⚙ 難易度: <b>${diff.icon} ${diff.label}</b>`])
      : hero("✦ 遠征の書 — 旅路を選べ ✦",
        `大地に張り巡らされた魔力の回路。クリーチャーを従えて土地を繋ぎ、連鎖で通行料を吊り上げ、
         目標資産を成して🏰城へ帰還せよ。初クリアの<b>カードパック</b>と勝利の<b>カード</b>で、自分だけのデッキを組み上げろ。`,
        [`👤 <b>${esc(currentProfileName())}</b>`, `⚙ 難易度: <b>${diff.icon} ${diff.label}</b>`, weeklyChip, mlChip]);
    const buttons = (versus || training || royale || sealed)
      ? (training || royale || sealed ? `<button class="btn" data-value="difficulty">⚙ 難易度: ${diff.icon}${diff.label}</button>` : "") +
        `<button class="btn" data-value="back">← 戻る</button>`
      : `<button class="btn" data-value="profile">👤 ${esc(currentProfileName())}</button>
         <button class="btn" data-value="difficulty">⚙ 難易度: ${diff.icon}${diff.label}</button>
         <button class="btn" data-value="matchlen">⏱ 決着: ${ml.icon}${ml.label}</button>
         <button class="btn" data-value="album">📚 アルバム（${distinctOwned()}/${CARD_DB.length}）</button>
         <button class="btn" data-value="deck">🛠 デッキ構築</button>
         <button class="btn" data-value="workshop">♻️ 交換所（🎟${shardCount()}）</button>
         <button class="btn" data-value="training">🎯 トレーニング</button>
         <button class="btn" data-value="royale">⚔ 三つ巴</button>
         <button class="btn" data-value="sealed">🎁 シールド戦</button>
         <button class="btn" data-value="versus">🎮 2人対戦</button>
         <button class="btn" data-value="weekly">🎪 週替り: ${wr.icon}${esc(wr.name)}${wOn ? "" : "（OFF）"}</button>
         <button class="btn" data-value="help">❓ 遊び方</button>`;
    overlay.classList.add("show");
    const close = v => { overlay.classList.remove("show"); resolve(v); };

    // --- ステージ一覧（「← ステージを選び直す」でここへ戻ってくる） ---
    function renderList() {
      box.innerHTML = `${header}<div class="stage-list">${rows}</div><div class="dlg-buttons">${buttons}</div>`;
      box.scrollTop = 0;
      box.querySelectorAll(".stage-btn:not(.locked)").forEach(btn =>
        btn.addEventListener("click", () => pick(Number(btn.dataset.idx))));
      box.querySelectorAll(".dlg-buttons .btn").forEach(btn =>
        btn.addEventListener("click", () => close(btn.dataset.value)));
    }

    // v28: ステージを押した瞬間に開戦していたため、押し間違えても戻れなかった。
    // 出陣確認を1枚挟んで「選び直せる」ようにする。
    // （🎁シールド戦だけは startSealed 側にパック開封前の確認があるので二重にしない）
    function pick(idx) {
      if (sealed) { close(idx); return; }
      renderConfirm(idx);
    }

    // --- 出陣確認（相手の顔・盤面の規模・目標・ルールを見てから決める） ---
    function renderConfirm(idx) {
      const s = STAGES[idx];
      const ch = (typeof CHARACTERS !== "undefined" && CHARACTERS[s.id]) || null;
      const target = (s.rules && s.rules.target) || 4000;
      const facts = [
        versus ? `🎮 <b>${esc(versus.names[0])}</b> vs <b>${esc(versus.names[1])}</b>` : "",
        `🔲 盤面: <b>${buildBoard(s).length}マス</b>`,
        `🎯 目標資産: <b>${target}G</b>`,
        `⛩ 周回に必要な関門: <b>${s.gatesNeeded || 3}</b>`,
        prog.cleared[s.id] ? "⭐ クリア済み" : "🆕 未クリア",
        training ? "🎯 トレーニング（進行度は変化しません）"
          : royale ? "⚔ 三つ巴（進行度は変化しません）"
          : versus ? "🎮 2人対戦（報酬・進行度はありません）" : "",
        versus ? "" : `⚙ 難易度: <b>${diff.icon}${diff.label}</b>`,
        weeklyChip, mlChip,
      ];
      box.innerHTML = `
        <div class="ss-confirm">
          <div class="sc-head">
            <div class="sc-face">${ch ? charPortraitSVG(ch, 72) : `<span class="sc-emoji">${s.icon}</span>`}</div>
            <div class="sc-title">
              <div class="sc-no">STAGE ${idx + 1}</div>
              <h2>${s.icon} ${esc(s.name)}</h2>
              ${versus ? "" : `<div class="sc-cpu" style="color:${ch ? ch.color : "var(--gold)"}">🗡 ${esc(s.cpuName)}${royale ? "　＋ 🟢乱入者1名" : ""}</div>`}
            </div>
          </div>
          <p class="sc-desc">${esc(s.desc)}</p>
          ${ch && !versus ? `<p class="sc-quote">「${esc((ch.lines.greet && ch.lines.greet[0]) || "")}」</p>` : ""}
          <div class="ss-chips sc-facts">${facts.filter(Boolean).map(t => `<span class="ss-chip">${t}</span>`).join("")}</div>
        </div>
        <div class="dlg-buttons">
          <button class="btn primary" data-go>⚔ この盤面で挑む</button>
          <button class="btn" data-reselect>← ステージを選び直す</button>
        </div>`;
      box.scrollTop = 0;
      box.querySelector("[data-go]").addEventListener("click", () => close(idx));
      box.querySelector("[data-reselect]").addEventListener("click", renderList);
    }

    renderList();
  });
}

// ---------- 難易度選択（イージー/ノーマル/ハード） ----------
function showDifficultyPicker() {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const cur = loadDifficulty();
    const rows = Object.keys(DIFFICULTIES).map(k => {
      const d = DIFFICULTIES[k];
      return `<button class="stage-btn ${k === cur ? "diff-current" : ""}" data-diff="${k}">
        <span class="st-icon">${d.icon}</span>
        <span class="st-main"><b>${d.label}${k === cur ? "（現在）" : ""}</b><small>${esc(d.desc)}</small></span>
        <span class="st-star">${k === cur ? "✔" : ""}</span>
      </button>`;
    }).join("");
    box.innerHTML = `<h2>⚙ ゲーム難易度</h2>
      <p class="dlg-body">相手ごとの強さの違いはそのままに、<b>全体の手ごたえ</b>を調整します（CPUの積極性・デッキの強さ・資金力が変わります）。次の対戦から反映されます。</p>
      <div class="stage-list">${rows}</div>
      <div class="dlg-buttons"><button class="btn" data-value="back">← 戻る</button></div>`;
    overlay.classList.add("show");
    const close = () => { overlay.classList.remove("show"); resolve(); };
    box.querySelectorAll("[data-diff]").forEach(btn => btn.addEventListener("click", () => {
      saveDifficulty(btn.dataset.diff); close();
    }));
    box.querySelector("[data-value=back]").addEventListener("click", close);
  });
}

// ---------- 決着モード選択（短期戦/標準/長期戦/大戦） ----------
// 目標資産とラウンド上限に倍率を掛けて、対戦の長さを好みに調整する（v18・トレーニング以外の全モードに適用）
function showMatchLengthPicker() {
  return new Promise(resolve => {
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    const cur = loadMatchLength();
    const rows = Object.keys(MATCH_LENGTHS).map(k => {
      const m = MATCH_LENGTHS[k];
      return `<button class="stage-btn ${k === cur ? "diff-current" : ""}" data-ml="${k}">
        <span class="st-icon">${m.icon}</span>
        <span class="st-main"><b>${m.label}${k === cur ? "（現在）" : ""}</b><small>${esc(m.desc)}</small></span>
        <span class="st-star">${k === cur ? "✔" : ""}</span>
      </button>`;
    }).join("");
    box.innerHTML = `<h2>⏱ 決着モード（対戦の長さ）</h2>
      <p class="dlg-body">ステージの<b>目標資産</b>と<b>ラウンド上限</b>に倍率を掛けて、決着までの長さを調整します。
      正規対戦・三つ巴・2人対戦に適用（トレーニングは常に時短）。次の対戦から反映されます。</p>
      <div class="stage-list">${rows}</div>
      <div class="dlg-buttons"><button class="btn" data-value="back">← 戻る</button></div>`;
    overlay.classList.add("show");
    const close = () => { overlay.classList.remove("show"); resolve(); };
    box.querySelectorAll("[data-ml]").forEach(btn => btn.addEventListener("click", () => {
      saveMatchLength(btn.dataset.ml); close();
    }));
    box.querySelector("[data-value=back]").addEventListener("click", close);
  });
}

// ---------- バトル演出（フルスクリーンのカットイン・スキップ可） ----------
// 侵略側が左から、防衛側が右から突撃してくるカットイン。攻撃のたびにカードが突進し、
// 被弾側が揺れる。「⏩ スキップ」で残りのログを一括表示して即座に決着へ進める。
UI.battleSkip = false;
UI.battleCtx = null; // { attName, defName } — ログ行からどちらの攻撃かを判定する

function openBattleView(g, attackerName, attCard, attItem, tile, defItem) {
  closePassiveDialog(); // 🔍マス情報などが開いていたら閉じてから（上書きでbusyカウンタが狂うのを防ぐ）
  const defCard = CARD_BY_ID[tile.creature.cardId];
  const defBonus = attCard.ab.includes("pierce") ? 0 : landHpBonus(tile, defCard);
  const support = landSupportSt(g, tile);
  const dCur = tile.creature.hp ?? defCard.hp;
  UI.battleSkip = false;
  UI.battleCtx = { attName: attCard.name, defName: defCard.name };
  const cutin = document.getElementById("battle-cutin");
  const fighter = (c, item, extraHp, side, extraMods = "") => `
    <div class="fighter ${side === "att" ? "bc-att" : "bc-def"}" id="bc-${side}">
      <div class="f-side">${side === "att" ? "⚔ 侵略" : "🛡 防衛"}</div>
      ${cardHTML(c)}
      <div class="f-mods">
        ${item ? `<span class="f-mod">${item.st > 0 ? "⚔️" : "🛡️"} ${esc(item.name)}</span>` : ""}
        ${extraHp > 0 ? `<span class="f-mod">🏞 土地HP+${extraHp}</span>` : ""}
        ${extraMods}
      </div>
    </div>`;
  // 物理/魔法の攻防に関わる要素はカットインにバッジで明示（魔法攻撃はアイテム由来も含む）
  const typeMods = (c, item) =>
    (c.ab.includes("physnull") ? `<span class="f-mod">🌫 物理無効</span>` : "") +
    (c.ab.includes("physreflect") ? `<span class="f-mod">🪞 物理反射</span>` : "") +
    ((c.ab.includes("magicatk") || (item && item.magicatk)) ? `<span class="f-mod">✨ 魔法攻撃</span>` : "");
  // 属性4すくみの有利不利をバッジと相性バナーで明示（v22）
  const rel = elemRelation(attCard.element, defCard.element); // 攻撃側から見た関係
  const elemMod = r =>
    r === "adv" ? `<span class="f-mod f-adv">⚡ 属性有利 ST+${ELEM_ADV_ST}</span>` :
    r === "dis" ? `<span class="f-mod f-dis">⚠ 属性不利</span>` : "";
  const relBanner =
    rel === "adv"  ? `<span class="be-rel be-adv">⚡ 有利 ST+${ELEM_ADV_ST} ▶</span>` :
    rel === "dis"  ? `<span class="be-rel be-dis">◀ 不利（相手にST+${ELEM_ADV_ST}）</span>` :
    rel === "none" ? `<span class="be-rel be-none">⚪ 相性なし（無属性）</span>` :
                     `<span class="be-rel be-even">— 互角 —</span>`;
  const elemChip = e => `<span class="be-elem" style="--ec:${ELEMENTS[e].color}">${ELEMENTS[e].icon} ${ELEMENTS[e].name}</span>`;
  const elemBanner = `<div class="bc-elems">
      ${elemChip(attCard.element)}${relBanner}${elemChip(defCard.element)}
      <div class="bc-wheel">${elemWheelHTML([attCard.element, defCard.element].filter(e => e !== "neutral"))}</div>
    </div>`;
  const defMods =
    (support > 0 ? `<span class="f-mod">🏰 援護ST+${support}</span>` : "") +
    (dCur < defCard.hp ? `<span class="f-mod">🩹 HP残${dCur}</span>` : "") +
    (defCard.ab.includes("capture") ? `<span class="f-mod">🕸️ 捕縛</span>` : "") +
    elemMod(rel === "adv" ? "dis" : rel === "dis" ? "adv" : rel) +
    typeMods(defCard, defItem);
  cutin.innerHTML = `
    <div class="bc-flash" id="bc-flash"></div>
    <div class="bc-inner">
      <h2 class="bc-title">⚔ バトル！ <small>${esc(ELEMENTS[tile.element].name)}の土地 Lv${tile.level}</small></h2>
      ${elemBanner}
      <div class="battle-arena">
        ${fighter(attCard, attItem, 0, "att", elemMod(rel) + typeMods(attCard, attItem))}
        <div class="vs">VS</div>
        ${fighter(defCard, defItem, defBonus, "def", defMods)}
      </div>
      <div id="battle-log"></div>
      <div class="bc-actions"><button id="battle-skip" class="btn small" title="残りの演出を飛ばして決着まで進めます">⏩ 演出をスキップ</button></div>
    </div>`;
  cutin.classList.remove("hidden", "bc-out");
  document.getElementById("battle-skip").addEventListener("click", () => {
    UI.battleSkip = true;
    cutin.classList.add("bc-skipping");
  });
}

// ログ行に応じたカットインの動き（突進・被弾・会心フラッシュ・撃破）
function _battleLineFx(line) {
  const ctx = UI.battleCtx || {};
  const att = document.getElementById("bc-att");
  const def = document.getElementById("bc-def");
  const flash = document.getElementById("bc-flash");
  const pulse = (el, cls) => {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // アニメを再発火させるためのリフロー
    el.classList.add(cls);
  };
  if (line.includes("会心")) { pulse(flash, "go-crit"); return; }
  if (line.startsWith(`${ctx.attName}の攻撃`) || line.startsWith(`${ctx.attName}の魔法攻撃`)) { pulse(att, "bc-lunge-r"); pulse(def, "bc-hurt"); pulse(flash, "go"); return; }
  if (line.startsWith(`${ctx.defName}の攻撃`) || line.startsWith(`${ctx.defName}の魔法攻撃`)) { pulse(def, "bc-lunge-l"); pulse(att, "bc-hurt"); pulse(flash, "go"); return; }
  if (line.includes("物理無効！") || line.includes("物理反射！")) { pulse(flash, "go"); return; }
  if (line.includes("跳ね返った")) { // 物理反射のダメージが攻撃側に返った行（行頭は被弾した側の名前）
    if (line.startsWith(ctx.attName)) pulse(att, "bc-hurt");
    else if (line.startsWith(ctx.defName)) pulse(def, "bc-hurt");
    pulse(flash, "go"); return;
  }
  if (line.includes("倒された")) {
    if (line.startsWith(ctx.defName)) pulse(def, "bc-dead");
    else if (line.startsWith(ctx.attName)) pulse(att, "bc-dead");
  }
}

async function playBattleLines(lines, interval = 700) {
  const el = document.getElementById("battle-log");
  for (const line of lines) {
    const instant = UI.battleSkip; // スキップ後は残りを一括表示
    if (el) {
      const div = document.createElement("div");
      div.textContent = line;
      if (line.includes("会心")) div.className = "crit";
      else if (line.startsWith("📊")) div.className = "formula";
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
    }
    log(line, "battle");
    if (instant) continue;
    if (line.includes("倒された")) SFX.destroy();
    else if (line.includes("会心")) SFX.destroy();
    else if (line.includes("攻撃！")) SFX.hit();
    _battleLineFx(line);
    await sleep(interval);
  }
}

function closeBattleView() {
  const cutin = document.getElementById("battle-cutin");
  cutin.classList.add("bc-out"); // フェードアウトしてから消す
  setTimeout(() => { cutin.classList.add("hidden"); cutin.classList.remove("bc-out", "bc-skipping"); }, 320);
}

// ---------- 勝利の祝福演出 ----------
// 金色の光条＋舞い散る紙吹雪＋祝福の鐘の音。演出中もクリックは透過する（pointer-events:none）ので
// 続く報酬ダイアログの操作を妨げない。opts.grand で紙吹雪を増量（初クリア用）。
async function playVictoryFx(title, sub, opts = {}) {
  const old = document.getElementById("victory-fx");
  if (old) old.remove();
  const host = document.createElement("div");
  host.id = "victory-fx";
  const colors = ["#ffd76a", "#ffe9a0", "#4da3ff", "#ff8a6a", "#8ee0a0", "#d9a6ff", "#fff"];
  const n = opts.grand ? 110 : 70;
  let confetti = "";
  for (let i = 0; i < n; i++) {
    const left = Math.random() * 100;
    const delay = Math.random() * 1.6;
    const dur = 2.2 + Math.random() * 1.6;
    const c = colors[Math.floor(Math.random() * colors.length)];
    const w = 6 + Math.random() * 7, h = 8 + Math.random() * 9;
    const rot = Math.floor(Math.random() * 360);
    confetti += `<i class="vf-confetti" style="left:${left}vw;width:${w}px;height:${h}px;background:${c};animation-delay:${delay}s;animation-duration:${dur}s;transform:rotate(${rot}deg)"></i>`;
  }
  host.innerHTML = `
    <div class="vf-rays"></div>
    <div class="vf-title">${esc(title)}</div>
    <div class="vf-sub">${esc(sub || "")}</div>
    ${confetti}`;
  document.body.appendChild(host);
  SFX.bless();
  await sleep(1700); // タイトルの余韻まで待ってから次へ（紙吹雪は背後で降り続ける）
  (async () => {   // 後片付けは待たずに進める（ダイアログの背後で静かにフェードアウト）
    await sleep(2600);
    host.classList.add("vf-fade");
    await sleep(1100);
    host.remove();
  })();
}

// ============================================================
// 分かれ道の選択（v31・原さん要望「方向指示は盤面上・マス目で方向だけを選択する。細かい表示は不要」）
// ------------------------------------------------------------
// v30までは「行き先ごとにルートプレビュー（この先6マスのアイコン列）を並べたダイアログ」を出していた。
// 情報は多いが、①盤面がダイアログで隠れる ②結局どっちへ曲がるかを見たいだけ、という問題があった。
// v31では ダイアログを一切出さず、進めるマスを盤面上で光らせ＋進入方向の大矢印を描いて、
// そのマスを直接タップ（クリック）して選ぶ。残りマス数だけは上部のメッセージ欄に出す。
// ============================================================

// 行き先候補マスに重ねる標識（tileSVG から呼ばれる）。光る枠＋進入方向の大矢印だけの最小構成
function dirCandidateSVG(g, tile) {
  const from = g.tiles[UI.dirChoice.fromId];
  const a = tileCenter(from), b = tileCenter(tile);
  const S = TILE, u = S / 90;
  let vx = b.cx - a.cx, vy = b.cy - a.cy;
  const len = Math.hypot(vx, vy) || 1;
  vx /= len; vy /= len;
  const px = -vy, py = vx;                       // 進行方向に直交する軸（矢じりの幅方向）
  // 矢印は「来た側の縁」に置く＝マスの中身（属性・クリーチャー）を隠さない
  const ox = b.cx - vx * S * 0.40, oy = b.cy - vy * S * 0.40;
  const H = 15 * u, W = 12 * u;
  const pts = [[ox + vx * H, oy + vy * H],
    [ox - vx * H * 0.5 + px * W, oy - vy * H * 0.5 + py * W],
    [ox - vx * H * 0.5 - px * W, oy - vy * H * 0.5 - py * W]];
  let s = `<path d="${tileShapeD(tile, b.cx, b.cy, S + 6)}" fill="none" stroke="#7ef0ff" stroke-width="6" stroke-linejoin="round">` +
    `<animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite"/></path>`;
  s += `<g><animateTransform attributeName="transform" type="translate" values="0 0;${_n(vx * 5 * u)} ${_n(vy * 5 * u)};0 0" dur="1.1s" repeatCount="indefinite"/>` +
    `<polygon points="${pts.map(q => `${_n(q[0])},${_n(q[1])}`).join(" ")}" fill="#7ef0ff" stroke="#06323d" stroke-width="${_n(1.8 * u)}" stroke-linejoin="round"/></g>`;
  return s;
}

// 盤面のスクロール位置を指定マスに合わせる（拡大中でも選択対象が画面外にならないように）
function scrollBoardTo(tile) {
  const wrap = document.getElementById("board-wrap");
  const svg = document.getElementById("board");
  if (!wrap || !svg || !tile) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const totalW = (Math.max(...G.tiles.map(t => t.x)) + 1) * CELL + BOARD_PAD * 2;
  const totalH = (Math.max(...G.tiles.map(t => t.y)) + 1) * CELL + BOARD_PAD * 2;
  const { cx, cy } = tileCenter(tile);
  const px = (cx + BOARD_PAD) / totalW * rect.width;
  const py = (cy + BOARD_PAD) / totalH * rect.height;
  wrap.scrollTo({ left: px - wrap.clientWidth / 2, top: py - wrap.clientHeight / 2, behavior: "smooth" });
}

// v24（方向つき移動）: 進める方向＝moveOptions（隣接から背後＝prevIdを除いたもの）。
// 通常は逆走できないため、選択が発生するのは分岐・交差か、方向未確定（🧭出発時）のときだけ。
// v31: ダイアログではなく盤面のマスをクリックして決める
function humanChooseDirection(p, tile, stepsLeft, prevId = null) {
  const opts = moveOptions(G, tile, prevId);
  if (opts.length <= 1) return Promise.resolve(opts[0].id);
  return new Promise(resolve => {
    closePassiveDialog(); // 🔍マス情報などが開いていたら畳む（盤面を素通しで見せる）
    const svg = document.getElementById("board");
    const msgEl = document.getElementById("message");
    const prevMsg = msgEl ? msgEl.innerHTML : "";
    UI.dirChoice = { fromId: tile.id, ids: new Set(opts.map(t => t.id)) };
    setMessage(`🧭 <b>進む方向を選んでください</b>（残り ${stepsLeft} マス）— 光っているマスをタップ`);
    scrollBoardTo(tile);
    renderBoard(G);
    const finish = id => {
      svg.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      UI.dirChoice = null;
      if (msgEl) msgEl.innerHTML = prevMsg;
      renderBoard(G);
      if (typeof SFX !== "undefined" && SFX.step) SFX.step();
      resolve(id);
    };
    const onClick = e => {
      const gEl = e.target.closest && e.target.closest(".tile");
      if (!gEl) return;
      const id = Number(gEl.dataset.tile);
      if (UI.dirChoice && UI.dirChoice.ids.has(id)) finish(id);
    };
    // 矢印キー / WASD でも選べる（「方向だけを選ぶ」操作に素直に対応する）
    const KEY_DIR = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    };
    const onKey = e => {
      const dir = KEY_DIR[e.key] || KEY_DIR[String(e.key).toLowerCase()];
      if (!dir) return;
      const hit = opts.find(t => Math.sign(t.x - tile.x) === dir[0] && Math.sign(t.y - tile.y) === dir[1]);
      if (hit) { e.preventDefault(); finish(hit.id); }
    };
    svg.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
  });
}

// ダイスの目を選ぶ（ホーリーワード用）
async function showDicePicker() {
  return new Promise(resolve => {
    closePassiveDialog();
    UI.dialogBusy++;
    const overlay = document.getElementById("overlay");
    const box = document.getElementById("dialog");
    box.innerHTML = `<h2>ホーリーワード</h2><p class="dlg-body">次のダイスの目を選んでください</p>
      <div class="dlg-buttons dice-pick">` +
      [1, 2, 3, 4, 5, 6].map(n => `<button class="btn primary" data-n="${n}">${n}</button>`).join("") +
      `</div>`;
    overlay.classList.add("show");
    box.querySelectorAll("[data-n]").forEach(btn => btn.addEventListener("click", () => {
      UI.dialogBusy = Math.max(0, UI.dialogBusy - 1);
      overlay.classList.remove("show");
      resolve(Number(btn.dataset.n));
    }));
  });
}

// ---------- メインの操作ボタン（v27: 操作ドック） ----------
// ダイスを振る操作は専用の丸いボタン（#roll-btn＝出目表示に重なる大きな的）で受ける。
// 盤面中央から下段の右端へ移したので、盤面を隠さずに親指の届く位置で押せる。
// それ以外のラベル（▶次へ等）は同じドックのピル（#action-btn）に出す。
function mainActionButton(label) {
  return /🎲/.test(label) ? document.getElementById("roll-btn") : document.getElementById("action-btn");
}
function showActionButton(label) {
  const btn = mainActionButton(label);
  if (btn.id === "action-btn") btn.textContent = label; // ダイスボタンの中身は固定（🎲＋振る）
  btn.classList.remove("hidden");
  UI._actionBtn = btn; // Space / Enter キーで押せるようにするため覚えておく
  return btn;
}
function hideActionButton(btn) {
  const b = btn || UI._actionBtn;
  if (b) b.classList.add("hidden");
  if (!btn || btn === UI._actionBtn) UI._actionBtn = null;
}
// メインの操作ボタン（1つだけ表示して押されるのを待つ）
function waitButton(label) {
  return new Promise(resolve => {
    const btn = showActionButton(label);
    const handler = () => {
      hideActionButton(btn);
      btn.removeEventListener("click", handler);
      resolve();
    };
    btn.addEventListener("click", handler);
  });
}

// ダイス演出
async function animateDice(finalValue) {
  const el = document.getElementById("dice");
  el.classList.add("rolling");
  for (let i = 0; i < 8; i++) {
    el.textContent = 1 + Math.floor(Math.random() * 6);
    SFX.dice();
    await sleep(60);
  }
  el.textContent = finalValue;
  el.classList.remove("rolling");
  await sleep(350);
}
