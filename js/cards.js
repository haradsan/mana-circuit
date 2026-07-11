// ============================================================
// cards.js — カードデータベースとデッキ構築
// ============================================================
"use strict";

// 属性は4種。相性の輪（水＞火＞木＞地＞水 ＝ 火→木→地→水→火）に沿った並び順にしてある
// （アルバム・パネルの表示順や色の割り当てが相性の輪と一致して分かりやすい）。
// 色は4色を明確に見分けられるように設定（木=緑 / 地=茶で木と区別）。
const ELEMENTS = {
  fire:  { name: "火", icon: "🔥", color: "#e05537" },
  wood:  { name: "木", icon: "🌳", color: "#4e9a2f" },
  earth: { name: "地", icon: "⛰️", color: "#8a6b3a" },
  water: { name: "水", icon: "💧", color: "#3d7de0" },
  // 無属性（クリーチャー専用・土地には存在しない）: 相性の輪の外＝有利も不利も取らない。
  // 土地の加護（属性一致HPボーナス）も一切受けない代わりに、素のコスト効率がやや高くユニークな能力を持つ。
  neutral: { name: "無", icon: "⚪", color: "#9d97b5" },
};
// 土地として存在できる属性（盤面・エレメンタルシフト・デッキの属性枠は無属性を除く4種）
const LAND_ELEMENTS = ["fire", "wood", "earth", "water"];

// 属性相性（4すくみ）: 火→木→地→水→火（左が右に強い）＝「水＞火＞木＞地＞水」。バトル時 ST+10
// 火は木を焼き、木は地を痩せさせ（根が土を割る）、地は水を堰き止め、水は火を消す。
const ELEM_ADVANTAGE = { fire: "wood", wood: "earth", earth: "water", water: "fire" };
const ELEM_ADV_ST = 10;
function hasElemAdvantage(attElem, defElem) { return ELEM_ADVANTAGE[attElem] === defElem; }

// 能力: first=先制 / pierce=貫通 / assault=強襲(侵略時ST+20)
//       guard=守護(防衛時HP+20) / lucky=豪運(会心率10%→25%)
//       capture=捕縛(防衛で撃退した侵略者を1ターン拘束) / immobile=不動(侵略・侵攻に出せない防御専用)
const ABILITY_INFO = {
  first:    { name: "先制", desc: "防衛時でも先に攻撃する" },
  pierce:   { name: "貫通", desc: "土地のHPボーナスを無視する" },
  assault:  { name: "強襲", desc: "侵略時にST+20" },
  guard:    { name: "守護", desc: "防衛時にHP+20" },
  lucky:    { name: "豪運", desc: "会心の一撃(ダメージ1.5倍)が出やすい(25%)" },
  capture:  { name: "捕縛", desc: "防衛して撃退すると、侵略してきた相手を次の1ターン拘束する" },
  immobile: { name: "不動", desc: "侵略・侵攻には出せない防御専用（そのぶんHPが高い）" },
  spellproof: { name: "護法", desc: "敵の対象指定スペル（メテオ・バニッシュ・ガスト）の対象にならない" },
  double:   { name: "連撃", desc: "バトルで続けて2回攻撃する（1撃目で相手が倒れなければもう1撃）" },
};

// レア度: カードの希少度。card.rarity で個別指定、無ければコストとタイプから推定。
// パックの排出重み（weight）と、カード/アルバムでの見た目（stars/color）に使う。
const RARITY_META = {
  common:    { label: "コモン",     stars: "★",     color: "#9aa0b5", weight: 8 },
  uncommon:  { label: "アンコモン", stars: "★★",    color: "#57c26a", weight: 4 },
  rare:      { label: "レア",       stars: "★★★",   color: "#4da3ff", weight: 2 },
  legendary: { label: "レジェンド", stars: "★★★★",  color: "#ffb14d", weight: 1 },
};
function cardRarity(card) {
  if (card.rarity) return card.rarity;
  const c = card.cost;
  if (c >= 135) return "legendary";
  if (c >= 110) return "rare";
  if (c >= 75)  return "uncommon";
  return "common";
}
const RARITY_WEIGHT = Object.fromEntries(Object.entries(RARITY_META).map(([k, v]) => [k, v.weight]));
const RARITY_ORDER = ["common", "uncommon", "rare", "legendary"];
// レア度 → そのレア度のカードid一覧（パック排出で「レア度を決めてから一様に1枚選ぶ」ために使う）
let _cardsByRarity = null;
function cardsOfRarity(rarity) {
  if (!_cardsByRarity) {
    _cardsByRarity = {};
    RARITY_ORDER.forEach(r => { _cardsByRarity[r] = []; });
    CARD_DB.forEach(c => { _cardsByRarity[cardRarity(c)].push(c.id); });
  }
  return _cardsByRarity[rarity] || [];
}

const CARD_DB = [
  // --- 火（攻撃寄り） ---
  { id: "imp",         name: "インプ",           type: "creature", element: "fire",  cost: 40,  st: 20, hp: 30, ab: ["lucky"] },
  { id: "firelizard",  name: "ファイアリザード", type: "creature", element: "fire",  cost: 50,  st: 30, hp: 30, ab: [] },
  { id: "bombeetle",   name: "ボムビートル",     type: "creature", element: "fire",  cost: 45,  st: 40, hp: 20, ab: [] }, // v13: 55→45（同コストのブランブルハウンドに完全に劣っていたため値下げ）
  { id: "flamewolf",   name: "フレイムウルフ",   type: "creature", element: "fire",  cost: 60,  st: 40, hp: 30, ab: ["assault"] },
  { id: "hellhound",   name: "ヘルハウンド",     type: "creature", element: "fire",  cost: 70,  st: 40, hp: 40, ab: ["pierce"] },
  { id: "salamander",  name: "サラマンダー",     type: "creature", element: "fire",  cost: 80,  st: 50, hp: 40, ab: [] },
  { id: "flamedancer", name: "フレイムダンサー", type: "creature", element: "fire",  cost: 85,  st: 40, hp: 40, ab: ["first"] },
  { id: "lavagolem",   name: "ラーヴァゴーレム", type: "creature", element: "fire",  cost: 100, st: 50, hp: 60, ab: [] },
  { id: "minotaur",    name: "ミノタウロス",     type: "creature", element: "fire",  cost: 105, st: 60, hp: 40, ab: ["assault"] },
  { id: "phoenix",     name: "フェニックス",     type: "creature", element: "fire",  cost: 120, st: 60, hp: 50, ab: ["first"] },
  { id: "efreet",      name: "イフリート",       type: "creature", element: "fire",  cost: 130, st: 70, hp: 40, ab: ["pierce"] },
  { id: "reddragon",   name: "レッドドラゴン",   type: "creature", element: "fire",  cost: 140, st: 70, hp: 60, ab: ["lucky"] },
  // --- 水（バランス・守り） ---
  { id: "aquasprite",  name: "アクアスピリット", type: "creature", element: "water", cost: 40,  st: 20, hp: 40, ab: [] },
  { id: "merman",      name: "マーマン",         type: "creature", element: "water", cost: 50,  st: 30, hp: 40, ab: [] },
  { id: "frostnaga",   name: "フロストナーガ",   type: "creature", element: "water", cost: 60,  st: 40, hp: 30, ab: ["first"] },
  { id: "shellcrab",   name: "シェルクラブ",     type: "creature", element: "water", cost: 65,  st: 20, hp: 60, ab: ["guard"] },
  { id: "undine",      name: "ウンディーネ",     type: "creature", element: "water", cost: 65,  st: 30, hp: 50, ab: ["guard"] }, // v13: 70→65（同コスト帯のドリアードに見劣りしていたため値下げ）
  { id: "mermaid",     name: "マーメイドナイト", type: "creature", element: "water", cost: 80,  st: 30, hp: 65, ab: [] }, // v13: HP60→65（同コストのロックゴーレムに完全に劣っていたため）
  { id: "seaserpent",  name: "シーサーペント",   type: "creature", element: "water", cost: 90,  st: 50, hp: 60, ab: [] }, // v13: HP50→60（同コストのバジリスク(貫通付き)に完全に劣っていたため）
  { id: "sirene",      name: "セイレーン",       type: "creature", element: "water", cost: 95,  st: 40, hp: 50, ab: ["first"] },
  { id: "frostgiant",  name: "フロストジャイアント", type: "creature", element: "water", cost: 110, st: 55, hp: 65, ab: [] }, // v13: 50/60→55/65（同コストのフォレストロード(捕縛付き)に完全に劣っていたため）
  { id: "kraken",      name: "クラーケン",       type: "creature", element: "water", cost: 120, st: 60, hp: 60, ab: ["capture"] }, // v13: 捕縛を付与（同コストのグリーンドラゴン(貫通)に完全に劣っていた。触腕で搦め捕るイメージ）
  { id: "tidallord",   name: "タイダルロード",   type: "creature", element: "water", cost: 135, st: 65, hp: 75, ab: ["first"] },
  { id: "leviathan",   name: "リヴァイアサン",   type: "creature", element: "water", cost: 140, st: 70, hp: 60, ab: ["pierce"] },
  { id: "abyssturtle", name: "アビスタートル",   type: "creature", element: "water", cost: 100, st: 10, hp: 90, ab: ["immobile", "guard"] },
  { id: "netjelly",    name: "ネットジェリー",   type: "creature", element: "water", cost: 65,  st: 20, hp: 55, ab: ["capture"] },
  // --- 地（HP・防衛） ---
  { id: "mudman",      name: "マッドマン",       type: "creature", element: "earth", cost: 40,  st: 20, hp: 40, ab: [] },
  { id: "dwarfguard",  name: "ドワーフガード",   type: "creature", element: "earth", cost: 50,  st: 20, hp: 50, ab: ["guard"] },
  { id: "stonewall",   name: "ストーンウォール", type: "creature", element: "earth", cost: 60,  st: 10, hp: 80, ab: [] },
  { id: "needlemole",  name: "ニードルモール",   type: "creature", element: "earth", cost: 65,  st: 40, hp: 40, ab: [] },
  { id: "rockgolem",   name: "ロックゴーレム",   type: "creature", element: "earth", cost: 80,  st: 30, hp: 70, ab: [] },
  { id: "basilisk",    name: "バジリスク",       type: "creature", element: "earth", cost: 90,  st: 50, hp: 50, ab: ["pierce"] },
  { id: "ogre",        name: "オーガ",           type: "creature", element: "earth", cost: 95,  st: 60, hp: 40, ab: ["assault"] },
  { id: "ironturtle",  name: "アイアンタートル", type: "creature", element: "earth", cost: 105, st: 30, hp: 90, ab: ["guard"] },
  { id: "earthdragon", name: "アースドラゴン",   type: "creature", element: "earth", cost: 120, st: 50, hp: 70, ab: [] },
  { id: "behemoth",    name: "ベヒーモス",       type: "creature", element: "earth", cost: 135, st: 70, hp: 50, ab: ["assault"] },
  { id: "gaiatitan",   name: "ガイアタイタン",   type: "creature", element: "earth", cost: 140, st: 65, hp: 85, ab: ["guard"] },
  { id: "greatwall",   name: "グレートウォール", type: "creature", element: "earth", cost: 90,  st: 10, hp: 100, ab: ["immobile"] },
  { id: "maneater",    name: "マンイーター",     type: "creature", element: "earth", cost: 75,  st: 40, hp: 55, ab: ["capture"] },
  // --- v4追加クリーチャー（各属性に追加） ---
  { id: "hellcat",     name: "ヘルキャット",     type: "creature", element: "fire",  cost: 45,  st: 30, hp: 20, ab: ["first"] },
  { id: "cerberus",    name: "ケルベロス",       type: "creature", element: "fire",  cost: 110, st: 60, hp: 50, ab: ["assault"] },
  { id: "magmagolem",  name: "マグマゴーレム",   type: "creature", element: "fire",  cost: 95,  st: 40, hp: 60, ab: [] },
  { id: "vulcandrake", name: "ヴォルカンドレイク", type: "creature", element: "fire", cost: 150, st: 80, hp: 55, ab: ["pierce"] },
  { id: "icesprite",   name: "アイススプライト", type: "creature", element: "water", cost: 45,  st: 20, hp: 40, ab: [] },
  { id: "kappa",       name: "カッパ",           type: "creature", element: "water", cost: 60,  st: 30, hp: 45, ab: ["guard"] },
  { id: "seawitch",    name: "シーウィッチ",     type: "creature", element: "water", cost: 90,  st: 50, hp: 45, ab: ["first"] },
  { id: "waterdragon", name: "ウォータードラゴン", type: "creature", element: "water", cost: 125, st: 60, hp: 65, ab: [] },
  { id: "gnome",       name: "ノーム",           type: "creature", element: "earth", cost: 45,  st: 20, hp: 45, ab: [] },
  { id: "goblinaxe",   name: "ゴブリンアックス", type: "creature", element: "earth", cost: 60,  st: 40, hp: 35, ab: ["assault"] },
  { id: "clayhulk",    name: "クレイハルク",     type: "creature", element: "earth", cost: 100, st: 40, hp: 75, ab: ["guard"] },
  // --- 木（生命と搦め手：capture／firstが主軸の中量級。地の「純HP壁・守護」とは役割を変えてある）---
  //     地＝重装の高HP壁で受ける。木＝先制と絡め手（捕縛）で手数を取り、相手を拘束して立ち回る。
  //     トレント／タイタンオークは樹木モチーフのため木属性（旧地属性からの名実一致移籍。数値・能力は不変）。
  { id: "treant",      name: "トレント",         type: "creature", element: "wood",  cost: 70,  st: 30, hp: 65, ab: [] }, // v13: HP60→65（守護付きドリアードと差別化＝素のHPで上回る壁に）
  { id: "titanoak",    name: "タイタンオーク",   type: "creature", element: "wood",  cost: 130, st: 60, hp: 70, ab: [] },
  { id: "kodama",      name: "コダマ",           type: "creature", element: "wood",  cost: 45,  st: 20, hp: 35, ab: ["lucky"] },
  { id: "sprout",      name: "スプラウト",       type: "creature", element: "wood",  cost: 40,  st: 20, hp: 40, ab: [] },
  { id: "thornvine",   name: "ソーンヴァイン",   type: "creature", element: "wood",  cost: 55,  st: 30, hp: 40, ab: ["capture"] },
  { id: "pixie",       name: "ピクシー",         type: "creature", element: "wood",  cost: 60,  st: 30, hp: 40, ab: ["first"] },
  { id: "bramblehound",name: "ブランブルハウンド", type: "creature", element: "wood", cost: 55, st: 40, hp: 30, ab: ["assault"] },
  { id: "mandrake",    name: "マンドレイク",     type: "creature", element: "wood",  cost: 65,  st: 40, hp: 40, ab: ["capture"] },
  { id: "dryad",       name: "ドリアード",       type: "creature", element: "wood",  cost: 70,  st: 30, hp: 55, ab: ["guard"] },
  { id: "woodwolf",    name: "ウッドウルフ",     type: "creature", element: "wood",  cost: 75,  st: 50, hp: 40, ab: ["first"] },
  { id: "mossgiant",   name: "モスジャイアント", type: "creature", element: "wood",  cost: 90,  st: 40, hp: 65, ab: ["capture"] },
  { id: "worldtree",   name: "ワールドツリー",   type: "creature", element: "wood",  cost: 100, st: 20, hp: 85, ab: ["immobile", "capture"] },
  { id: "forestlord",  name: "フォレストロード", type: "creature", element: "wood",  cost: 110, st: 50, hp: 60, ab: ["capture"] },
  { id: "greendragon", name: "グリーンドラゴン", type: "creature", element: "wood",  cost: 120, st: 60, hp: 60, ab: ["pierce"] },
  { id: "elderent",    name: "エンシェントエント", type: "creature", element: "wood", cost: 135, st: 60, hp: 75, ab: ["capture"] },
  // --- v13追加クリーチャー ---
  { id: "alraune",     name: "アルラウネ",       type: "creature", element: "wood",  cost: 85,  st: 40, hp: 50, ab: ["capture"] },
  // --- 無属性（v13追加）: 土地の加護を一切受けず属性相性の輪の外＝どの土地でも同じ強さ。
  //     そのぶんコスト効率がやや高く、全員レア以上でユニークな能力（護法/連撃/二重能力）を持つ ---
  { id: "gargoyle",     name: "ガーゴイル",       type: "creature", element: "neutral", cost: 60,  st: 35, hp: 55, ab: ["guard", "spellproof"], rarity: "rare" },
  { id: "unicorn",      name: "ユニコーン",       type: "creature", element: "neutral", cost: 75,  st: 45, hp: 45, ab: ["first", "lucky"],      rarity: "rare" },
  { id: "mithrilgolem", name: "ミスリルゴーレム", type: "creature", element: "neutral", cost: 95,  st: 50, hp: 70, ab: ["spellproof"],           rarity: "rare" },
  { id: "chimera",      name: "キメラ",           type: "creature", element: "neutral", cost: 115, st: 45, hp: 60, ab: ["double"],               rarity: "legendary" },
  // --- アイテム（バトル時に装備、使い切り） ---
  { id: "longsword",     name: "ロングソード",     type: "item", cost: 40,  st: 20, hp: 0,  desc: "バトル時 ST+20" },
  { id: "battleaxe",     name: "バトルアックス",   type: "item", cost: 70,  st: 40, hp: 0,  desc: "バトル時 ST+40" },
  { id: "greatsword",    name: "グレートソード",   type: "item", cost: 100, st: 55, hp: 0,  desc: "バトル時 ST+55" },
  { id: "assassindagger",name: "アサシンダガー",   type: "item", cost: 80,  st: 15, hp: 0,  grant: ["first"], desc: "ST+15・先制を得る" },
  { id: "leathershield", name: "レザーシールド",   type: "item", cost: 40,  st: 0,  hp: 20, desc: "バトル時 HP+20" },
  { id: "towershield",   name: "タワーシールド",   type: "item", cost: 70,  st: 0,  hp: 40, desc: "バトル時 HP+40" },
  { id: "platemail",     name: "プレートメイル",   type: "item", cost: 100, st: 0,  hp: 55, desc: "バトル時 HP+55" },
  { id: "elementalorb",  name: "エレメンタルオーブ", type: "item", cost: 60, st: 15, hp: 15, desc: "バトル時 ST+15 / HP+15" },
  // --- v4追加アイテム ---
  { id: "claymore",      name: "クレイモア",       type: "item", cost: 130, st: 70, hp: 0,  desc: "バトル時 ST+70" },
  { id: "mithrilshield", name: "ミスリルシールド", type: "item", cost: 130, st: 0,  hp: 70, desc: "バトル時 HP+70" },
  { id: "dualblade",     name: "デュアルブレード", type: "item", cost: 95,  st: 35, hp: 0,  grant: ["first"], desc: "ST+35・先制を得る" },
  { id: "luckycharm",    name: "ラックチャーム",   type: "item", cost: 50,  st: 10, hp: 10, grant: ["lucky"], desc: "ST+10/HP+10・会心率アップ" },
  { id: "vampirelance",  name: "ヴァンパイアランス", type: "item", cost: 75, st: 30, hp: 0,  grant: ["pierce"], desc: "ST+30・貫通を得る" },
  { id: "saintarmor",    name: "セイントアーマー", type: "item", cost: 110, st: 0,  hp: 45, grant: ["guard"], desc: "HP+45・守護を得る" },
  // --- v13追加アイテム ---
  { id: "warbanner",     name: "ウォーバナー",     type: "item", cost: 65,  st: 25, hp: 10, desc: "バトル時 ST+25 / HP+10" },
  // --- スペル ---
  { id: "manadrain", name: "マナドレイン",   type: "spell", cost: 50,  spell: "drain",    desc: "相手から200Gを奪う（低コスト高効率）" },
  { id: "holyword",  name: "ホーリーワード", type: "spell", cost: 60,  spell: "holyword", desc: "次のダイスの目を自由に選ぶ" },
  { id: "drawmist",  name: "ドローミスト",   type: "spell", cost: 70,  spell: "draw",     desc: "カードを2枚引く" },
  { id: "quake",     name: "クエイク",       type: "spell", cost: 120, spell: "quake",    desc: "敵の土地1つのレベルを1下げる" },
  { id: "growth",    name: "グロース",       type: "spell", cost: 150, spell: "growth",   rarity: "rare", desc: "自分のLv3以下の土地1つをLv+1" },
  { id: "recall",    name: "リコール",       type: "spell", cost: 100, spell: "recall",   desc: "城へテレポート（総資産達成なら勝利！ 関門を規定数すべて通過済みなら周回ボーナスも得る）" },
  { id: "revenge",   name: "リベンジ",       type: "spell", cost: 80,  spell: "revenge",  desc: "総資産で負けている時、差額の25%（最大500G）を相手から奪う" },
  { id: "eleshift",  name: "エレメンタルシフト", type: "spell", cost: 90, spell: "eleshift", desc: "自分の土地1つの属性を変える（連鎖の組み替えに）" },
  { id: "vanish",    name: "バニッシュ",     type: "spell", cost: 160, spell: "vanish",   desc: "敵クリーチャー1体を無条件で消滅させ土地を解放する（HP不問＝どんな相手でも確実に破壊／土地レベルは残る）" },
  { id: "gust",      name: "ガスト",         type: "spell", cost: 90,  spell: "gust", rarity: "rare", icon: "🌬️", desc: "敵クリーチャー1体を隣接する空き地へ強制的に押し出す（元の土地は空き地に戻る＝連鎖崩し・防衛どかしに／不動・結界は対象外）" },
  { id: "regen",     name: "リジェネ",       type: "spell", cost: 60,  spell: "regen", icon: "💚", desc: "負傷した自分のクリーチャー1体のHPを全回復する" },
  { id: "renew",     name: "引き直し",       type: "spell", cost: 40,  spell: "renew",    desc: "手札をすべて捨て、新たに6枚引く（手札事故のリセットに）" },
  // --- v4追加スペル ---
  { id: "meteor",    name: "メテオ",         type: "spell", cost: 110, spell: "meteor",   icon: "☄️", desc: "敵クリーチャー1体に40ダメージ（現在HPが0以下になれば破壊し土地を解放／高HPの相手は削って弱らせる）。バニッシュより安価で小回りが利く" },
  { id: "freeze",    name: "フリーズ",       type: "spell", cost: 100, spell: "freeze",   icon: "❄️", desc: "相手を凍らせ、次のターンを1回休みにする" },
  { id: "treasure",  name: "トレジャー",     type: "spell", cost: 50,  spell: "treasure", icon: "💰", desc: "所有する土地1つにつき+40G（土地が多いほど得）" },
  { id: "steal",     name: "スティール",     type: "spell", cost: 80,  spell: "steal",    icon: "🎭", desc: "相手の手札からランダムに1枚奪う" },
  { id: "salvage",   name: "サルベージ",     type: "spell", cost: 40,  spell: "salvage",  icon: "♻️", desc: "自分の捨て札からカード1枚を選んで手札に戻す" },
  // --- v13追加スペル ---
  { id: "alchemy",   name: "アルケミー",     type: "spell", cost: 40,  spell: "alchemy",  icon: "⚗️", desc: "手札から1枚を選んで捨て、120Gに変える（使わないカードを資金に）" },
  // --- v5追加スペル/アイテム ---
  { id: "plunder",     name: "プランダー",       type: "spell", cost: 95, spell: "plunder",    rarity: "rare",     icon: "💰", desc: "相手の所持金の半分を奪う（相手が富むほど大きい）" },
  { id: "hyperdice",   name: "ダイスブースト",   type: "spell", cost: 50, spell: "dicedouble", rarity: "uncommon", icon: "🎲", desc: "次のダイスの出目を2倍にする（最大12マス進む）" },
  { id: "dispelward",  name: "ディスペルワード", type: "item", cost: 55, st: 0, hp: 0,  nullify: true,  rarity: "rare", desc: "バトル時、相手のアイテムの効果を打ち消す（相手のアイテムを無効化）" },
  { id: "mirrorshield",name: "ミラーシールド",   type: "item", cost: 95, st: 0, hp: 20, reflect: 0.5, rarity: "rare", desc: "バトル時 HP+20・受けた攻撃ダメージの50%を相手に反射する" },
  // --- 盤面エフェクト（スペル枠で発動、2ラウンドの時限効果でマスそのものを変化させる） ---
  { id: "sanctuary", name: "サンクチュアリ", type: "spell", cost: 140, spell: "sanctuary", fx: true, icon: "🛡️",
    desc: "【盤面】自分の土地1つに2Rの結界。侵略・クリーチャー侵攻・敵スペルの対象にならない" },
  { id: "ensnare",   name: "スネアトラップ", type: "spell", cost: 110, spell: "ensnare",   fx: true, icon: "🕸️",
    desc: "【盤面】土地1つに2Rの罠。相手が通過・停止するとその場で足止め（移動終了）される" },
];

const CARD_BY_ID = Object.fromEntries(CARD_DB.map(c => [c.id, c]));

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// デッキ自動構築（30枚）: 主属性2つを厚めに + スペル + アイテム
// 属性は4種なので、主属性クリーチャー各6枚（2属性＝12）、副属性各3枚（残り2属性＝6）、
// スペル6枚、アイテム6枚＝合計30枚。biasElement を指定すると主属性の1つ目が固定される（ステージのCPU用）
// maxCost: このコストを超えるカードは入れない（弱い難易度のCPUほど低コスト＝弱いデッキになる）。
//   クリーチャーが枯れないよう、maxCost で候補が空になった場合はコスト昇順で最も安いものにフォールバックする。
function buildDeck(biasElement = null, maxCost = Infinity) {
  // 属性枠は土地属性の4種のみ（無属性クリーチャーはレア以上の特別枠＝自動デッキには入れず、構築デッキで使う）
  let elems = shuffle(LAND_ELEMENTS.slice());
  if (biasElement) elems = [biasElement, ...elems.filter(e => e !== biasElement)];
  const main = elems.slice(0, 2), sub = elems.slice(2); // main=2属性 / sub=残り2属性
  const deck = [];
  const pickType = (filter, n) => {
    const all = CARD_DB.filter(filter);
    if (all.length === 0) return;
    let pool = all.filter(c => c.cost <= maxCost);
    // maxCostで全滅したら、そのカテゴリの最安カードだけは使えるようにする（デッキが機能する保証）
    if (pool.length === 0) pool = [all.slice().sort((a, b) => a.cost - b.cost)[0]];
    for (let i = 0; i < n; i++) deck.push(pool[Math.floor(Math.random() * pool.length)].id);
  };
  main.forEach(e => pickType(c => c.type === "creature" && c.element === e, 6));
  sub.forEach(e => pickType(c => c.type === "creature" && c.element === e, 3));
  pickType(c => c.type === "spell", 6);
  pickType(c => c.type === "item", 6);
  return shuffle(deck);
}
