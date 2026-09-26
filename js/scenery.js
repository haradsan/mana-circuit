// ============================================================
// scenery.js — 盤面の地形（v35・原さん要望「ステージ・ボードのクオリティ向上」）
// ------------------------------------------------------------
// v34までの盤面の背景は「テーマ色の四角＋巨大な透かし絵文字」だけで、マスの外側・環の内側が
// ほぼ空っぽだった。v35では各ステージに“地形”を敷く:
//   🌿草原＝草むらと野の花と蛍 ／ 🌋火山＝溶岩の亀裂と火の粉 ／ 🌊水都＝波紋と泡 ／ 🍃高地＝風の筋と舞う葉 …
// 盤面の下層に一度だけ描く静的レイヤー（ui.js renderBoard の bl-bg）なので、手番中の再描画コストは増えない。
// 粒の配置はステージidから作る決定論の乱数（art.js _artRng）＝何度開いても同じ景色になる。
// 動く粒（火の粉・泡・蛍など）は各盤面10個前後に抑え、CSSアニメーション（style.css の .amb-*）で動かす。
// 端末が「視差効果を減らす」設定なら CSS 側で止まる。
// ============================================================
"use strict";

// ステージ → 地形の種類（stages.js の look.scenery で個別に上書きできる）
const SCENERY_OF_STAGE = {
  s1: "meadow", s2: "volcano", s3: "sea", s4: "highland", s5: "mountain", s6: "mirage",
  s7: "market", s8: "arena", s9: "storm", s10: "inferno", s11: "starry", s12: "royal",
  s13: "prairie", s14: "clockwork", s15: "temple", s16: "chronos",
};

const _sc = v => Math.round(v * 10) / 10;
// 動く粒（CSSアニメ）。cls＝.amb-rise（立ちのぼる）/ .amb-drift（横に流れる）/ .amb-twinkle（瞬く）/ .amb-flash（稲光）
function _amb(cls, inner, dur, delay) {
  return `<g class="amb ${cls}" style="animation-duration:${_sc(dur)}s;animation-delay:-${_sc(delay)}s">${inner}</g>`;
}
// 盤面の広さに比例した個数（6×6の小盤面で base 個）
function _scN(w, h, base) { return Math.max(4, Math.round(base * (w * h) / (600 * 600))); }

const SCENERY = {
  // 🌿 草原: 明るい草むらのまだら・草の房・野の花・漂う蛍
  meadow(w, h, R, th) {
    let s = "";
    for (let i = 0; i < _scN(w, h, 9); i++)
      s += `<ellipse cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" rx="${_sc(50 + R() * 90)}" ry="${_sc(30 + R() * 50)}" fill="#8fd46a" opacity="${_sc(0.03 + R() * 0.04)}"/>`;
    for (let i = 0; i < _scN(w, h, 70); i++) {
      const x = R() * w, y = R() * h, k = 0.7 + R() * 0.8;
      s += `<path d="M${_sc(x)} ${_sc(y)} l${_sc(-4 * k)} ${_sc(-9 * k)} M${_sc(x)} ${_sc(y)} l${_sc(1 * k)} ${_sc(-12 * k)} M${_sc(x)} ${_sc(y)} l${_sc(5 * k)} ${_sc(-8 * k)}" stroke="${th.dot || "#6f9a6f"}" stroke-width="1.6" stroke-linecap="round" opacity="${_sc(0.25 + R() * 0.25)}"/>`;
    }
    const petals = ["#fff4d6", "#ffd76a", "#ffb0c8", "#d9c8ff"];
    for (let i = 0; i < _scN(w, h, 26); i++)
      s += `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="${_sc(1.6 + R() * 1.8)}" fill="${petals[i % 4]}" opacity="${_sc(0.35 + R() * 0.3)}"/>`;
    for (let i = 0; i < _scN(w, h, 9); i++)
      s += _amb("amb-drift", `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="2.6" fill="#e8ff9a"/>`, 6 + R() * 5, R() * 8);
    return s;
  },
  // 🌋 火山: 焦げた岩肌・溶岩の亀裂（光る）・溶岩溜まり・舞い上がる火の粉
  volcano(w, h, R, th, hot = "#ff6a2a") {
    let s = "";
    for (let i = 0; i < _scN(w, h, 4); i++) {
      const x = R() * w, y = R() * h, r = 40 + R() * 60;
      s += `<ellipse cx="${_sc(x)}" cy="${_sc(y)}" rx="${_sc(r)}" ry="${_sc(r * 0.6)}" fill="${hot}" opacity="0.06"/>` +
        `<ellipse cx="${_sc(x)}" cy="${_sc(y)}" rx="${_sc(r * 0.45)}" ry="${_sc(r * 0.26)}" fill="${hot}" opacity="0.09"/>`;
    }
    for (let i = 0; i < _scN(w, h, 16); i++) {
      let x = R() * w, y = R() * h, d = `M${_sc(x)} ${_sc(y)}`;
      let a = R() * Math.PI * 2;
      for (let k = 0; k < 5; k++) { a += (R() - 0.5) * 1.4; x += Math.cos(a) * (14 + R() * 18); y += Math.sin(a) * (14 + R() * 18); d += ` L${_sc(x)} ${_sc(y)}`; }
      s += `<path d="${d}" fill="none" stroke="${hot}" stroke-width="7" stroke-linejoin="round" opacity="0.07"/>` +
        `<path d="${d}" fill="none" stroke="${hot}" stroke-width="1.8" stroke-linejoin="round" opacity="0.4"/>`;
    }
    for (let i = 0; i < _scN(w, h, 30); i++)
      s += `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="${_sc(2 + R() * 4)}" fill="#000" opacity="0.18"/>`;
    for (let i = 0; i < _scN(w, h, 12); i++)
      s += _amb("amb-rise", `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="${_sc(1.5 + R() * 1.5)}" fill="${i % 3 ? "#ffb37c" : "#fff0b0"}"/>`, 4 + R() * 4, R() * 8);
    return s;
  },
  // 🔥 地獄回廊: 火山をより赤く、魔法陣の焼け跡を足す
  inferno(w, h, R, th) {
    let s = SCENERY.volcano(w, h, R, th, "#ff3a3a");
    for (let i = 0; i < 3; i++) {
      const x = w * (0.2 + R() * 0.6), y = h * (0.2 + R() * 0.6), r = 50 + R() * 40;
      s += `<circle cx="${_sc(x)}" cy="${_sc(y)}" r="${_sc(r)}" fill="none" stroke="#ff5a4a" stroke-width="2" stroke-dasharray="4 7" opacity="0.2"/>` +
        `<circle cx="${_sc(x)}" cy="${_sc(y)}" r="${_sc(r * 0.72)}" fill="none" stroke="#ff5a4a" stroke-width="1.2" opacity="0.14"/>`;
    }
    return s;
  },
  // 🌊 水都: 波紋の弧・水面の光・立ちのぼる泡
  sea(w, h, R, th) {
    let s = "";
    for (let i = 0; i < _scN(w, h, 6); i++)
      s += `<ellipse cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" rx="${_sc(60 + R() * 80)}" ry="${_sc(14 + R() * 18)}" fill="#8cc8ff" opacity="0.045"/>`;
    for (let i = 0; i < _scN(w, h, 60); i++) {
      const x = R() * w, y = R() * h, r = 7 + R() * 9;
      s += `<path d="M${_sc(x - r)} ${_sc(y)} Q${_sc(x - r / 2)} ${_sc(y - r * 0.5)} ${_sc(x)} ${_sc(y)} T${_sc(x + r)} ${_sc(y)}" fill="none" stroke="#9ad2ff" stroke-width="1.4" stroke-linecap="round" opacity="${_sc(0.14 + R() * 0.14)}"/>`;
    }
    for (let i = 0; i < _scN(w, h, 10); i++)
      s += _amb("amb-rise", `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="${_sc(2 + R() * 2)}" fill="none" stroke="#bfe3ff" stroke-width="1.1"/>`, 5 + R() * 4, R() * 9);
    return s;
  },
  // 🍃 高地: 風の筋（流れる）・低い草・舞い散る葉
  highland(w, h, R, th) {
    let s = "";
    for (let i = 0; i < _scN(w, h, 14); i++) {
      const x = R() * w, y = R() * h, L = 60 + R() * 90, b = (R() - 0.5) * 30;
      s += `<path class="wind" d="M${_sc(x)} ${_sc(y)} q${_sc(L / 2)} ${_sc(b)} ${_sc(L)} 0" fill="none" stroke="#e6f5d0" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="18 60" opacity="${_sc(0.12 + R() * 0.12)}" style="animation-delay:-${_sc(R() * 4)}s"/>`;
    }
    for (let i = 0; i < _scN(w, h, 40); i++) {
      const x = R() * w, y = R() * h;
      s += `<path d="M${_sc(x)} ${_sc(y)} q3 -8 9 -9" fill="none" stroke="${th.dot || "#7a9a5a"}" stroke-width="1.4" opacity="${_sc(0.22 + R() * 0.2)}"/>`;
    }
    for (let i = 0; i < _scN(w, h, 9); i++)
      s += _amb("amb-drift", `<ellipse cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" rx="3.2" ry="1.6" fill="#b8e28a"/>`, 5 + R() * 4, R() * 8);
    return s;
  },
  // ⛰️ 霊峰: 岩の稜線・転がる岩塊・地層の縞
  mountain(w, h, R, th) {
    let s = "";
    for (let row = 0; row < 3; row++) {
      const y0 = h * (0.25 + row * 0.3);
      let d = `M-40 ${_sc(y0)}`;
      for (let x = -40; x <= w + 40; x += 40) d += ` L${x} ${_sc(y0 - R() * 38)}`;
      s += `<path d="${d}" fill="none" stroke="${th.dot || "#8a7a5a"}" stroke-width="2" stroke-linejoin="round" opacity="0.18"/>`;
    }
    for (let i = 0; i < _scN(w, h, 22); i++) {
      const x = R() * w, y = R() * h, r = 5 + R() * 10;
      s += `<path d="M${_sc(x - r)} ${_sc(y + r * 0.4)} L${_sc(x - r * 0.4)} ${_sc(y - r * 0.7)} L${_sc(x + r * 0.6)} ${_sc(y - r * 0.5)} L${_sc(x + r)} ${_sc(y + r * 0.4)} Z" fill="#000" opacity="0.2"/>` +
        `<path d="M${_sc(x - r * 0.4)} ${_sc(y - r * 0.7)} L${_sc(x + r * 0.6)} ${_sc(y - r * 0.5)}" stroke="#f0d8a8" stroke-width="1" opacity="0.2"/>`;
    }
    for (let i = 0; i < _scN(w, h, 6); i++)
      s += _amb("amb-drift", `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="1.6" fill="#f0d8a8"/>`, 7 + R() * 5, R() * 8);
    return s;
  },
  // 🌀 幻影回廊: 渦巻く霧・揺らめく輪・浮遊する光
  mirage(w, h, R, th) {
    let s = "";
    for (let i = 0; i < _scN(w, h, 6); i++) {
      const x = R() * w, y = R() * h;
      for (let k = 1; k <= 4; k++)
        s += `<circle cx="${_sc(x)}" cy="${_sc(y)}" r="${_sc(k * (12 + R() * 8))}" fill="none" stroke="${th.dot || "#8a6ab8"}" stroke-width="1.2" opacity="${_sc(0.2 - k * 0.035)}"/>`;
    }
    for (let i = 0; i < _scN(w, h, 8); i++)
      s += `<ellipse cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" rx="${_sc(60 + R() * 70)}" ry="${_sc(20 + R() * 20)}" fill="#c8a8ff" opacity="0.04" transform="rotate(${Math.round(R() * 60 - 30)} ${_sc(w / 2)} ${_sc(h / 2)})"/>`;
    for (let i = 0; i < _scN(w, h, 12); i++)
      s += _amb("amb-twinkle", `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="${_sc(1.6 + R() * 1.6)}" fill="#e0ccff"/>`, 2.5 + R() * 3, R() * 4);
    return s;
  },
  // 🎭 円卓の三叉界: 格子の絨毯（菱形の文様）＋霧
  royal(w, h, R, th) {
    let s = "";
    const step = 50;
    for (let y = -step; y <= h + step; y += step)
      for (let x = -step; x <= w + step; x += step)
        s += `<path d="M${x} ${y - 20} L${x + 20} ${y} L${x} ${y + 20} L${x - 20} ${y} Z" fill="none" stroke="${th.dot || "#9a6ab8"}" stroke-width="1" opacity="0.1"/>`;
    return s + SCENERY.mirage(w, h, R, th);
  },
  // 💰 黄金市場: 石畳・散らばる金貨・きらめき
  market(w, h, R, th) {
    let s = "";
    const bw = 34, bh = 20;
    for (let y = 0, row = 0; y < h; y += bh, row++)
      for (let x = (row % 2) * -bw / 2; x < w; x += bw)
        if (R() < 0.55) s += `<rect x="${_sc(x + 1.5)}" y="${_sc(y + 1.5)}" width="${bw - 3}" height="${bh - 3}" rx="4" fill="none" stroke="${th.dot || "#b89a4a"}" stroke-width="1" opacity="${_sc(0.08 + R() * 0.08)}"/>`;
    for (let i = 0; i < _scN(w, h, 22); i++) {
      const x = R() * w, y = R() * h;
      s += `<ellipse cx="${_sc(x)}" cy="${_sc(y)}" rx="4.5" ry="3.2" fill="#ffd76a" opacity="${_sc(0.25 + R() * 0.25)}"/>` +
        `<ellipse cx="${_sc(x)}" cy="${_sc(y)}" rx="2.4" ry="1.5" fill="none" stroke="#8a6620" stroke-width="0.8" opacity="0.5"/>`;
    }
    for (let i = 0; i < _scN(w, h, 10); i++) {
      const x = R() * w, y = R() * h;
      s += _amb("amb-twinkle", `<path d="M${_sc(x)} ${_sc(y - 5)} L${_sc(x + 1.3)} ${_sc(y - 1.3)} L${_sc(x + 5)} ${_sc(y)} L${_sc(x + 1.3)} ${_sc(y + 1.3)} L${_sc(x)} ${_sc(y + 5)} L${_sc(x - 1.3)} ${_sc(y + 1.3)} L${_sc(x - 5)} ${_sc(y)} L${_sc(x - 1.3)} ${_sc(y - 1.3)} Z" fill="#fff3c4"/>`, 2 + R() * 3, R() * 4);
    }
    return s;
  },
  // ⚔️ 闘技場: 砂の円（同心円＋放射線）・砂粒
  arena(w, h, R, th) {
    let s = "";
    const cx = w / 2, cy = h / 2, M = Math.max(w, h);
    for (let k = 1; k <= 6; k++)
      s += `<circle cx="${cx}" cy="${cy}" r="${_sc(M * k / 12)}" fill="none" stroke="${th.dot || "#a05a6a"}" stroke-width="${k % 2 ? 2 : 1}" opacity="${k % 2 ? 0.16 : 0.1}"/>`;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      s += `<path d="M${_sc(cx + Math.cos(a) * M * 0.08)} ${_sc(cy + Math.sin(a) * M * 0.08)} L${_sc(cx + Math.cos(a) * M * 0.5)} ${_sc(cy + Math.sin(a) * M * 0.5)}" stroke="${th.dot || "#a05a6a"}" stroke-width="1" opacity="0.08"/>`;
    }
    for (let i = 0; i < _scN(w, h, 80); i++)
      s += `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="${_sc(0.8 + R() * 1.3)}" fill="#f0c8a0" opacity="${_sc(0.1 + R() * 0.15)}"/>`;
    for (let i = 0; i < _scN(w, h, 6); i++)
      s += _amb("amb-drift", `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="2" fill="#f0c8a0"/>`, 6 + R() * 4, R() * 8);
    return s;
  },
  // ⚡ 雷鳴峡谷: 岩の亀裂・ときどき走る稲光
  storm(w, h, R, th) {
    let s = SCENERY.mountain(w, h, R, th);
    for (let i = 0; i < _scN(w, h, 5); i++) {
      let x = R() * w, y = R() * h * 0.5, d = `M${_sc(x)} ${_sc(y)}`;
      for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 40; y += 14 + R() * 18; d += ` L${_sc(x)} ${_sc(y)}`; }
      s += _amb("amb-flash", `<path d="${d}" fill="none" stroke="#cfe0ff" stroke-width="2.4" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#7a9aff" stroke-width="8" stroke-linejoin="round" opacity="0.25"/>`, 5 + R() * 6, R() * 10);
    }
    return s;
  },
  // ✴️ 星辰: 星空・星座の線・瞬く星
  starry(w, h, R, th) {
    let s = "";
    for (let i = 0; i < _scN(w, h, 90); i++)
      s += `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="${_sc(0.6 + R() * 1.4)}" fill="#fff" opacity="${_sc(0.15 + R() * 0.45)}"/>`;
    for (let c = 0; c < _scN(w, h, 3); c++) {
      let x = R() * w, y = R() * h;
      const pts = [[x, y]];
      for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 120; y += (R() - 0.5) * 120; pts.push([x, y]); }
      s += `<path d="M${pts.map(p => `${_sc(p[0])} ${_sc(p[1])}`).join(" L")}" fill="none" stroke="#b8c8ff" stroke-width="1" opacity="0.18"/>`;
      s += pts.map(p => `<circle cx="${_sc(p[0])}" cy="${_sc(p[1])}" r="2.4" fill="#e8eeff" opacity="0.55"/>`).join("");
    }
    for (let i = 0; i < _scN(w, h, 14); i++)
      s += _amb("amb-twinkle", `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="${_sc(1.8 + R() * 1.4)}" fill="#fff"/>`, 2 + R() * 3, R() * 4);
    return s;
  },
  // 🐪 大草原: 砂丘の曲線・まばらな草・流れる砂塵
  prairie(w, h, R, th) {
    let s = "";
    for (let i = 0; i < _scN(w, h, 16); i++) {
      const x = R() * w, y = R() * h, L = 80 + R() * 120;
      s += `<path d="M${_sc(x)} ${_sc(y)} q${_sc(L / 2)} ${_sc(-14 - R() * 10)} ${_sc(L)} 0" fill="none" stroke="${th.dot || "#b0a45a"}" stroke-width="1.8" opacity="${_sc(0.1 + R() * 0.1)}"/>`;
    }
    for (let i = 0; i < _scN(w, h, 30); i++) {
      const x = R() * w, y = R() * h;
      s += `<path d="M${_sc(x)} ${_sc(y)} l-3 -7 M${_sc(x)} ${_sc(y)} l2 -9 M${_sc(x)} ${_sc(y)} l5 -6" stroke="#9aa050" stroke-width="1.3" opacity="${_sc(0.2 + R() * 0.2)}"/>`;
    }
    for (let i = 0; i < _scN(w, h, 7); i++)
      s += _amb("amb-drift", `<circle cx="${_sc(R() * w)}" cy="${_sc(R() * h)}" r="2.2" fill="#e8d8a0"/>`, 6 + R() * 5, R() * 8);
    return s;
  },
  // ⚙️ 時計仕掛け: ゆっくり回る大きな歯車（互い違いに逆回転）
  clockwork(w, h, R, th) {
    let s = "";
    const gear = (x, y, r, teeth) => {
      const pts = [], step = Math.PI * 2 / teeth;
      for (let i = 0; i < teeth; i++) {
        const a = i * step;
        pts.push([x + r * 0.84 * Math.cos(a), y + r * 0.84 * Math.sin(a)]);
        pts.push([x + r * Math.cos(a + step * 0.18), y + r * Math.sin(a + step * 0.18)]);
        pts.push([x + r * Math.cos(a + step * 0.36), y + r * Math.sin(a + step * 0.36)]);
        pts.push([x + r * 0.84 * Math.cos(a + step * 0.54), y + r * 0.84 * Math.sin(a + step * 0.54)]);
      }
      return `<path d="M${pts.map(p => `${_sc(p[0])} ${_sc(p[1])}`).join(" L")} Z" fill="none" stroke="${th.dot || "#b08a4a"}" stroke-width="2"/>` +
        `<circle cx="${_sc(x)}" cy="${_sc(y)}" r="${_sc(r * 0.3)}" fill="none" stroke="${th.dot || "#b08a4a"}" stroke-width="2"/>` +
        `<path d="M${_sc(x - r * 0.7)} ${_sc(y)} L${_sc(x + r * 0.7)} ${_sc(y)} M${_sc(x)} ${_sc(y - r * 0.7)} L${_sc(x)} ${_sc(y + r * 0.7)}" stroke="${th.dot || "#b08a4a"}" stroke-width="1.4"/>`;
    };
    for (let i = 0; i < _scN(w, h, 5); i++) {
      const r = 40 + R() * 70, teeth = 10 + Math.round(r / 12);
      s += `<g class="amb-spin${i % 2 ? " rev" : ""}" style="animation-duration:${_sc(50 + R() * 40)}s" opacity="0.16">${gear(R() * w, R() * h, r, teeth)}</g>`;
    }
    return s;
  },
  // 🕯️ 五王の間: 六角の敷石・燭台の灯（揺らめく）
  temple(w, h, R, th) {
    let s = "";
    const r = 30, dx = r * 1.5, dy = r * Math.sqrt(3);
    for (let col = -1, x = 0; x < w + dx; col++, x = col * dx)
      for (let y = (col % 2 ? dy / 2 : 0) - dy; y < h + dy; y += dy) {
        const pts = [];
        for (let k = 0; k < 6; k++) pts.push([x + r * 0.94 * Math.cos(k * Math.PI / 3), y + r * 0.94 * Math.sin(k * Math.PI / 3)]);
        s += `<path d="M${pts.map(p => `${_sc(p[0])} ${_sc(p[1])}`).join(" L")} Z" fill="none" stroke="${th.dot || "#c8a44a"}" stroke-width="1" opacity="0.1"/>`;
      }
    for (let i = 0; i < _scN(w, h, 8); i++) {
      const x = R() * w, y = R() * h;
      s += `<circle cx="${_sc(x)}" cy="${_sc(y)}" r="22" fill="#ffc86a" opacity="0.05"/>` +
        _amb("amb-flicker", `<path d="M${_sc(x)} ${_sc(y - 7)} C${_sc(x + 3)} ${_sc(y - 3)} ${_sc(x + 2)} ${_sc(y + 1)} ${_sc(x)} ${_sc(y + 2)} C${_sc(x - 2)} ${_sc(y + 1)} ${_sc(x - 3)} ${_sc(y - 3)} ${_sc(x)} ${_sc(y - 7)} Z" fill="#ffd98a"/>`, 1.2 + R(), R() * 2);
    }
    return s;
  },
  // ⏳ 時流の玉座: 星空＋盤面の中央に巨大な時計盤（針がゆっくり回る）
  chronos(w, h, R, th) {
    let s = SCENERY.starry(w, h, R, th);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.34;
    s += `<circle cx="${_sc(cx)}" cy="${_sc(cy)}" r="${_sc(r)}" fill="none" stroke="${th.dot || "#8a7ab8"}" stroke-width="3" opacity="0.2"/>`;
    s += `<circle cx="${_sc(cx)}" cy="${_sc(cy)}" r="${_sc(r * 0.9)}" fill="none" stroke="${th.dot || "#8a7ab8"}" stroke-width="1" stroke-dasharray="2 8" opacity="0.25"/>`;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      s += `<path d="M${_sc(cx + Math.cos(a) * r * 0.8)} ${_sc(cy + Math.sin(a) * r * 0.8)} L${_sc(cx + Math.cos(a) * r * 0.94)} ${_sc(cy + Math.sin(a) * r * 0.94)}" stroke="${th.dot || "#8a7ab8"}" stroke-width="${i % 3 ? 2 : 4}" opacity="0.28"/>`;
    }
    s += `<g class="amb-spin" style="animation-duration:120s" opacity="0.22"><circle cx="${_sc(cx)}" cy="${_sc(cy)}" r="${_sc(r * 0.75)}" fill="none"/><path d="M${_sc(cx)} ${_sc(cy)} L${_sc(cx)} ${_sc(cy - r * 0.75)}" stroke="${th.dot || "#8a7ab8"}" stroke-width="4" stroke-linecap="round"/></g>`;
    s += `<g class="amb-spin" style="animation-duration:30s" opacity="0.22"><circle cx="${_sc(cx)}" cy="${_sc(cy)}" r="${_sc(r * 0.55)}" fill="none"/><path d="M${_sc(cx)} ${_sc(cy)} L${_sc(cx + r * 0.55)} ${_sc(cy)}" stroke="${th.dot || "#8a7ab8"}" stroke-width="2.4" stroke-linecap="round"/></g>`;
    return s;
  },
};

// 盤面の地形SVG（ui.js boardBackdropSVG から呼ばれる）
function scenerySVG(g, w, h) {
  const stage = g.stage || {};
  const kind = (stage.look && stage.look.scenery) || SCENERY_OF_STAGE[stage.id] || "meadow";
  const R = _artRng(_artHash("scenery:" + (stage.id || "")));
  const fn = SCENERY[kind] || SCENERY.meadow;
  return `<g class="scenery sc-${kind}">${fn(w, h, R, stage.theme || {})}</g>`;
}
