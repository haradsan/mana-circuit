// ============================================================
// battle.js — 侵略バトルの解決（アイテム・属性相性・会心対応）
// v19: 第二弾の新能力（群れ/遠隔/吸収/硬殻/背水/看破/成長）・巻物・建造物に対応
// ============================================================
"use strict";

const CRIT_RATE       = 0.10; // 会心の一撃（ダメージ1.5倍）の基本確率
const CRIT_RATE_LUCKY = 0.25; // 豪運持ちの会心確率
const ARMOR_REDUCE    = 10;   // 硬殻のダメージ軽減量
const LASTWARD_ST     = 25;   // 背水のST補正（HP半分以下）
const PACK_ST_MAX     = 30;   // 群れのST上限（+5×6体分）
const GROW_STEP       = 5;    // 成長1段階あたりのST/HP上昇（上限は grown=5 ＝ +25）

// 成長（grow）の段階（0〜5）。creature = tile.creature（{cardId, hp, grown}）
function grownOf(creature) { return Math.min(5, (creature && creature.grown) || 0); }

// attCard: 侵略側カード / tile: 防衛側の土地 / attItem, defItem: 装備アイテム(null可)
// opts.rng: true なら会心の一撃あり（実戦用）。false（既定）は決定論的（AIのシミュ用）
// opts.g: 指定すると土地の援護（隣接自軍領地による防衛ST補正）と群れ（pack）を計算に含める
// opts.attackerId: 侵略側プレイヤーid（群れの集計に使う。省略時は侵略側の群れは0）
// opts.attGrown: 侵略側クリーチャーの成長段階（march＝盤上からの侵攻時のみ。手札からの侵略は0）
// opts.attSrcId: march の出撃元タイルid（群れの集計から自分自身を除くため）
// 返り値: { attackerWins, log, attHp, defHp, attExtra, defExtra, attDrain, defDrain,
//           attRebirth, defRebirth, defCapture }
// ※状態は変更しない（AIのシミュレーションにも使う）
function resolveBattle(attCard, tile, attItem = null, defItem = null, opts = {}) {
  const rng = !!opts.rng;
  let defCard = CARD_BY_ID[tile.creature.cardId];
  const log = [];

  // 模倣（mimic・v17）: 相手カードの「基本ST・基本HP・能力」をそっくり写し取って戦う。
  // 名前と属性（無）はそのまま＝属性相性・土地の加護は発生しない。装備アイテムはコピーしない。
  // 両者が模倣なら互いに写し合うだけなので発動しない。防衛側の傷は「受けたダメージ量」として写し身へ引き継ぐ。
  const attMimicSwap = (attCard.ab || []).includes("mimic") && !(defCard.ab || []).includes("mimic");
  const defMimicSwap = (defCard.ab || []).includes("mimic") && !(attCard.ab || []).includes("mimic");
  const defWound = defCard.hp - (tile.creature.hp ?? defCard.hp); // これまでに受けているダメージ（成長分は負になり得る＝そのまま加算される）
  if (attMimicSwap) {
    log.push(`🎭 ${attCard.name}の模倣！ ${defCard.name}の力を写し取った（ST${defCard.st}/HP${defCard.hp}${defCard.ab.length ? "・" + defCard.ab.map(a => ABILITY_INFO[a].name).join("・") : ""}）`);
    attCard = { ...attCard, st: defCard.st, hp: defCard.hp, ab: defCard.ab.slice() };
  }
  if (defMimicSwap) {
    log.push(`🎭 ${defCard.name}の模倣！ ${attCard.name}の力を写し取った（ST${attCard.st}/HP${attCard.hp}${attCard.ab.length ? "・" + attCard.ab.map(a => ABILITY_INFO[a].name).join("・") : ""}）`);
    defCard = { ...defCard, st: attCard.st, hp: attCard.hp, ab: attCard.ab.slice() };
  }
  const defBaseHp = Math.max(1, defCard.hp - defWound); // 戦闘後HP残量（前回の傷／成長分を引き継ぐ）

  // 無力化の霧（v20）: 能力をすべて消された状態（2R）。カード固有の能力を無視する（アイテム付与は残る）
  const attCardNulled = !!opts.attNulled;
  const defCardNulled = !!(opts.g && typeof creatureNulled === "function" && creatureNulled(opts.g, tile.creature));
  if (attCardNulled) log.push(`🌫️ ${attCard.name}は無力化の霧に包まれている——能力を使えない！`);
  if (defCardNulled) log.push(`🌫️ ${defCard.name}は無力化の霧に包まれている——能力を使えない！`);

  // アイテム打消し: 🚫nullifyアイテム（ディスペルワード）または能力「看破」（グレムリン・v19）。
  // 看破はアイテムではないので打ち消されない（ただし無力化の霧では消える）
  const attDispel = !attCardNulled && (attCard.ab || []).includes("dispel");
  const defDispel = !defCardNulled && (defCard.ab || []).includes("dispel");
  const attNull = !!(attItem && attItem.nullify);
  const defNull = !!(defItem && defItem.nullify);
  const attItemEff = (defNull || defDispel) ? null : attItem; // 実際に効果を発揮する侵略側アイテム
  const defItemEff = (attNull || attDispel) ? null : defItem; // 実際に効果を発揮する防衛側アイテム
  if (attNull && defItem) log.push(`🚫 ${attItem.name}が${defCard.name}の${defItem.name}を打ち消した！`);
  if (defNull && attItem) log.push(`🚫 ${defItem.name}が${attCard.name}の${attItem.name}を打ち消した！`);
  if (attDispel && defItem && !attNull) log.push(`👁 ${attCard.name}の看破！ ${defCard.name}の${defItem.name}を打ち消した！`);
  if (defDispel && attItem && !defNull) log.push(`👁 ${defCard.name}の看破！ ${attCard.name}の${attItem.name}を打ち消した！`);

  // アイテムが付与する能力（アサシンダガーの先制など）も合算（打消し後の有効アイテムで判定）。
  // 無力化の霧（v20）中はカード固有の能力を除外（アイテム由来だけ残る）
  const abilities = (c, item, nulled) => new Set([...(nulled ? [] : (c.ab || [])), ...((item && item.grant) || [])]);
  const attAb = abilities(attCard, attItemEff, attCardNulled);
  const defAb = abilities(defCard, defItemEff, defCardNulled);
  const attReflect = (attItemEff && attItemEff.reflect) || 0; // 受けた攻撃を反射する割合
  const defReflect = (defItemEff && defItemEff.reflect) || 0;
  // 攻撃タイプ（v15）: 能力 magicatk か magicatk:true のアイテム（打消し後の有効アイテム）で攻撃が「魔法」になる。
  // 📜巻物（scroll・v19）も魔法攻撃扱い。物理無効・物理反射は「物理攻撃」だけを防ぐ／跳ね返す。
  const attScroll = attItemEff && attItemEff.scroll ? (attItemEff.scrollMirror ? defCard.st : attItemEff.scroll) : 0;
  const defScroll = defItemEff && defItemEff.scroll ? (defItemEff.scrollMirror ? attCard.st : defItemEff.scroll) : 0;
  const attMagic = attAb.has("magicatk") || !!(attItemEff && attItemEff.magicatk) || attScroll > 0;
  const defMagic = defAb.has("magicatk") || !!(defItemEff && defItemEff.magicatk) || defScroll > 0;

  // 成長（grow・v19）: 防衛側は tile.creature.grown、侵略側は opts.attGrown（march時のみ）。
  // v20: 🕊️ブレッシング（永続強化）も同じ grown 枠＝能力の有無に関わらず加算する
  const attGrown = Math.min(5, opts.attGrown || 0);
  const defGrown = grownOf(tile.creature);
  // 戦火の世（v20）: 2Rの間、侵略側ST+20（全員）
  const warFx = (opts.g && typeof activeFx === "function" && activeFx(opts.g, "war")) ? 20 : 0;
  // バトル支援スペル（v20）: ウォークライ/攻城の号令/護りの風/決死の覚悟（fightForがoptsで渡す）
  const attSpellSt = opts.attStBonus || 0;
  const defSpellSt = opts.defStBonus || 0;

  let attSt = attCard.st + (attItemEff ? attItemEff.st : 0) + (attAb.has("assault") ? 20 : 0) + RULES.invaderSt + attGrown * GROW_STEP + warFx + attSpellSt;
  let defSt = defCard.st + (defItemEff ? defItemEff.st : 0) + defGrown * GROW_STEP + defSpellSt;
  if (warFx) log.push(`🔥 戦火の世！ 攻め手の${attCard.name}はST+${warFx}`);
  if (attSpellSt) log.push(`📣 支援の詠唱！ ${attCard.name}のST+${attSpellSt}`);
  if (defSpellSt) log.push(`📣 支援の詠唱！ ${defCard.name}のST+${defSpellSt}`);
  const advAtt = hasElemAdvantage(attCard.element, defCard.element);
  const advDef = hasElemAdvantage(defCard.element, attCard.element);
  if (advAtt) attSt += ELEM_ADV_ST;
  if (advDef) defSt += ELEM_ADV_ST;
  const support = opts.g ? landSupportSt(opts.g, tile) : 0; // 隣接自軍領地の援護（見張り塔の烽火も含む）

  // 群れ（pack・v19）: 盤面の自軍同属性クリーチャー1体につきST+5（自分自身は除く・上限+30）
  const packCount = (playerId, element, excludeId) => {
    if (!opts.g || playerId == null) return 0;
    return opts.g.tiles.filter(t => t.type === "LAND" && t.owner === playerId &&
      t.creature && t.id !== excludeId && CARD_BY_ID[t.creature.cardId].element === element).length;
  };
  const attPack = attAb.has("pack") ? Math.min(PACK_ST_MAX, packCount(opts.attackerId, attCard.element, opts.attSrcId ?? -1) * 5) : 0;
  const defPack = defAb.has("pack") ? Math.min(PACK_ST_MAX, packCount(tile.owner, defCard.element, tile.id) * 5) : 0;
  attSt += attPack;
  defSt += defPack + support;

  const defBonus = attAb.has("pierce") ? 0 : landHpBonus(tile, defCard);
  const guardBonus = defAb.has("guard") ? 20 : 0;
  const defWindHp = opts.defHpBonus || 0; // 護りの風（v20）
  if (defWindHp) log.push(`🌬️ 護りの風！ ${defCard.name}のHP+${defWindHp}`);
  const attExtra = attItemEff ? attItemEff.hp : 0;
  const defExtra = (defItemEff ? defItemEff.hp : 0) + defBonus + guardBonus + defWindHp;
  // 決死の覚悟（v20）: 会心率の底上げ（豪運と重複時は高い方）
  const attCritRate = Math.max(attAb.has("lucky") ? CRIT_RATE_LUCKY : CRIT_RATE, opts.attCritRate || 0);
  const defCritRate = Math.max(defAb.has("lucky") ? CRIT_RATE_LUCKY : CRIT_RATE, opts.defCritRate || 0);
  let attHp = attCard.hp + attGrown * GROW_STEP + attExtra;
  let defHp = defBaseHp + defExtra;

  // 📜巻物: 攻撃が「記載ST固定の魔法攻撃」に置き換わる＝本体ST・強襲・属性・援護・群れの補正は乗らない
  if (attScroll > 0) { attSt = attScroll; log.push(`📜 ${attCard.name}は${attItemEff.name}を展開！ 攻撃がST${attScroll}固定の魔法砲撃になる`); }
  if (defScroll > 0) { defSt = defScroll; log.push(`📜 ${defCard.name}は${defItemEff.name}を展開！ 反撃がST${defScroll}固定の魔法砲撃になる`); }
  // 幻惑のマント（stDebuff・v19）: 相手のSTを下げる（最低10）
  if (defItemEff && defItemEff.stDebuff) { attSt = Math.max(10, attSt - defItemEff.stDebuff); log.push(`🌫 ${defItemEff.name}の幻惑！ ${attCard.name}のST-${defItemEff.stDebuff}`); }
  if (attItemEff && attItemEff.stDebuff) { defSt = Math.max(10, defSt - attItemEff.stDebuff); log.push(`🌫 ${attItemEff.name}の幻惑！ ${defCard.name}のST-${attItemEff.stDebuff}`); }
  // 平静のお守り（noCrit・v19）: 相手の会心を封じる
  const attNoCrit = !!(defItemEff && defItemEff.noCrit); // 侵略側は会心を出せない
  const defNoCrit = !!(attItemEff && attItemEff.noCrit); // 防衛側は会心を出せない

  if (defBaseHp < defCard.hp) log.push(`🩹 ${defCard.name}は前の戦いの傷でHP${defBaseHp}から`);
  if (attItem) log.push(`⚔ ${attCard.name}は${attItem.name}を装備！`);
  if (defItem) log.push(`🛡 ${defCard.name}は${defItem.name}を装備！`);
  if (attAb.has("assault") && !attScroll) log.push(`⚔ ${attCard.name}の強襲！ ST+20`);
  if (attGrown > 0) log.push(`🌱 ${attCard.name}は成長している！ ST/HP+${attGrown * GROW_STEP}`);
  if (defGrown > 0) log.push(`🌱 ${defCard.name}は成長している！ ST/HP+${defGrown * GROW_STEP}`);
  if (attPack > 0 && !attScroll) log.push(`🐺 ${attCard.name}の群れ！ 仲間の数だけST+${attPack}`);
  if (defPack > 0 && !defScroll) log.push(`🐺 ${defCard.name}の群れ！ 仲間の数だけST+${defPack}`);
  if (RULES.invaderSt > 0) log.push(`🏟 闘技場の熱気！ 侵略側ST+${RULES.invaderSt}`);
  if (support > 0 && !defScroll) log.push(`🏰 ${defCard.name}は隣接する味方領地の援護！ ST+${support}`);
  if (advAtt && !attScroll) log.push(`${ELEMENTS[attCard.element].icon} 属性の優位！ ${attCard.name}のST+${ELEM_ADV_ST}`);
  if (advDef && !defScroll) log.push(`${ELEMENTS[defCard.element].icon} 属性の優位！ ${defCard.name}のST+${ELEM_ADV_ST}`);
  if (attAb.has("pierce") && landHpBonus(tile, defCard) > 0) {
    log.push(`⚔ ${attCard.name}の貫通！ 土地ボーナス無効`);
  } else if (defBonus > 0) {
    log.push(`🛡 ${defCard.name}は土地の加護でHP+${defBonus}`);
  }
  if (guardBonus > 0) log.push(`🛡 ${defCard.name}の守護！ HP+${guardBonus}`);
  if (attMagic) log.push(`✨ ${attCard.name}の攻撃は魔法攻撃！（物理無効・物理反射を貫く）`);
  if (defMagic) log.push(`✨ ${defCard.name}の攻撃は魔法攻撃！（物理無効・物理反射を貫く）`);

  // 遠隔（ranged・v19）: 侵略側が遠隔なら防衛側は一切反撃できない（先制でも）。
  // 建造物（structure・v19）: 防衛してもST0の施設なので反撃しない
  const attRanged = attAb.has("ranged");
  const defStruct = !!defCard.structure;
  if (attRanged) log.push(`🏹 ${attCard.name}の遠隔攻撃！ 相手の反撃を受けない`);
  if (defStruct) log.push(`🏛 ${defCard.name}は建造物——反撃できない`);

  // 攻撃順: 通常は侵略側が先。防衛側だけが先制持ちなら防衛側が先（侵略側が遠隔なら無効）
  const defFirst = defAb.has("first") && !attAb.has("first") && !attRanged && !defStruct;

  // 背水（lastward・v19）: HPがバトル開始時の半分以下になるとST+25（バトル中の被弾でも発動する）
  const attStartHp = attHp, defStartHp = defHp;
  let attLastwardOn = false, defLastwardOn = false;
  const attStOf = () => {
    const on = attAb.has("lastward") && !attScroll && attHp <= attStartHp / 2;
    if (on && !attLastwardOn) { attLastwardOn = true; log.push(`🔥 ${attCard.name}の背水！ 追い詰められてST+${LASTWARD_ST}`); }
    return attSt + (on ? LASTWARD_ST : 0);
  };
  const defStOf = () => {
    const on = defAb.has("lastward") && !defScroll && defHp <= defStartHp / 2;
    if (on && !defLastwardOn) { defLastwardOn = true; log.push(`🔥 ${defCard.name}の背水！ 追い詰められてST+${LASTWARD_ST}`); }
    return defSt + (on ? LASTWARD_ST : 0);
  };

  // ▼ バフの計算式を明示する（会心以外は決定論＝この数式どおりに殴り合う）。
  const bd = (total, base, parts) => {
    const terms = parts.filter(([, v]) => v).map(([lbl, v]) => `${v > 0 ? "+" : ""}${v}(${lbl})`);
    return terms.length ? `${total} ＝ ${base} ${terms.join(" ")}` : `${total}`;
  };
  if (attScroll > 0) {
    log.push(`📊【式】侵略 ${attCard.name}: ST ${attSt}（📜巻物固定） ／ HP ${bd(attHp, attCard.hp, [["成長", attGrown * GROW_STEP], ["装備", attExtra]])}`);
  } else {
    log.push(`📊【式】侵略 ${attCard.name}: ST ${bd(attSt, attCard.st, [["装備", attItemEff ? attItemEff.st : 0], ["強襲", attAb.has("assault") ? 20 : 0], ["属性", advAtt ? ELEM_ADV_ST : 0], ["成長", attGrown * GROW_STEP], ["群れ", attPack], ["闘技場", RULES.invaderSt]])} ／ HP ${bd(attHp, attCard.hp, [["成長", attGrown * GROW_STEP], ["装備", attExtra]])}`);
  }
  if (defScroll > 0) {
    log.push(`📊【式】防衛 ${defCard.name}: ST ${defSt}（📜巻物固定） ／ HP ${bd(defHp, defBaseHp, [["装備", defItemEff ? defItemEff.hp : 0], ["土地の加護", defBonus], ["守護", guardBonus]])}`);
  } else {
    log.push(`📊【式】防衛 ${defCard.name}: ST ${bd(defSt, defCard.st, [["装備", defItemEff ? defItemEff.st : 0], ["属性", advDef ? ELEM_ADV_ST : 0], ["成長", defGrown * GROW_STEP], ["群れ", defPack], ["援護", support]])} ／ HP ${bd(defHp, defBaseHp, [["装備", defItemEff ? defItemEff.hp : 0], ["土地の加護", defBonus], ["守護", guardBonus]])}`);
  }
  // 侵略は「一撃で相手の実効HPを削り切れば占領」。硬殻は一撃ごとに-10されるためここで織り込む。
  const attBlocked = !attMagic && (defAb.has("physnull") || defAb.has("physreflect")); // 侵略の攻撃が通らない
  const defBlocked = !defMagic && (attAb.has("physnull") || attAb.has("physreflect")); // 防衛の反撃が通らない
  const defArmorCut = defAb.has("armor") ? ARMOR_REDUCE : 0;
  const attHitOnce = Math.max(0, attStOf() - defArmorCut);
  const attTotal = attAb.has("double") ? attHitOnce * 2 : attHitOnce;
  const canOneShot = !attBlocked && attTotal >= defHp;
  const critReach = !attBlocked && !canOneShot && !attNoCrit &&
    Math.max(0, Math.floor(attStOf() * 1.5) - defArmorCut) * (attAb.has("double") ? 2 : 1) >= defHp;
  if (attBlocked) {
    log.push(`📊【式】決着: ${defCard.name}の${defAb.has("physnull") ? "物理無効" : "物理反射"}により侵略の物理攻撃は通らない → 占領不可${defAb.has("physreflect") ? "（攻撃はそっくり跳ね返る）" : ""}${defBlocked ? "　※反撃も通らない（両者無傷）" : ""}`);
  } else {
    log.push(`📊【式】決着: 侵略の一撃 ${attHitOnce}${defArmorCut ? `（硬殻-${defArmorCut}後）` : ""}${attAb.has("double") ? `×2(連撃)＝${attTotal}` : ""} ${canOneShot ? "≥" : "<"} 防衛の実効HP${defHp} → ${canOneShot ? "撃破して占領" : `守られる（あと${defHp - attTotal}届かない${critReach ? "／💫会心が出れば届く" : ""}）`}${defFirst ? "　※防衛が先制（侵略側HPが低いと反撃で討死）" : ""}${attRanged ? "　※遠隔＝反撃なし" : ""}${defBlocked && !attRanged ? `　※侵略側の${attAb.has("physnull") ? "物理無効" : "物理反射"}で防衛の反撃は通らない` : ""}`);
  }

  // 一撃を計算（会心込み）。物理無効/物理反射（対象の能力）と魔法攻撃（攻撃側）・硬殻をここで解決する。
  // { remain: 対象の残HP, dmg: 与えたダメージ, bounced: 物理反射で攻撃側へ跳ね返ったダメージ } を返す
  const strike = (name, st, ab, isMagic, noCrit, critRate, targetName, targetAb, targetHp) => {
    let dmg = st;
    if (rng && !noCrit && Math.random() < critRate) {
      dmg = Math.floor(st * 1.5);
      log.push(`💫 ${name}の会心の一撃！！`);
    }
    if (!isMagic && targetAb.has("physnull")) {
      log.push(`🌫 ${targetName}の物理無効！ ${name}の攻撃はすり抜けた（0ダメージ）`);
      return { remain: targetHp, dmg: 0, bounced: 0 };
    }
    if (!isMagic && targetAb.has("physreflect")) {
      log.push(`🪞 ${targetName}の物理反射！ ${name}の攻撃がそっくり跳ね返る`);
      return { remain: targetHp, dmg: 0, bounced: dmg };
    }
    if (targetAb.has("armor") && dmg > 0) {
      const cut = Math.min(ARMOR_REDUCE, dmg);
      dmg -= cut;
      log.push(`🪨 ${targetName}の硬殻！ ダメージを${cut}軽減`);
      if (dmg <= 0) { log.push(`${name}の攻撃は${targetName}の殻に阻まれた（0ダメージ）`); return { remain: targetHp, dmg: 0, bounced: 0 }; }
    }
    const remain = targetHp - dmg;
    log.push(`${name}の${isMagic ? "魔法攻撃" : "攻撃"}！ ${targetName}に${dmg}ダメージ（残りHP ${Math.max(0, remain)}）`);
    return { remain, dmg, bounced: 0 };
  };
  // 反射（ミラーシールド）: 攻撃を受けた側が、受けたダメージの一部を攻撃側へ跳ね返す
  const reflectBack = (targetReflect, dmg, attackerName, reflectorName, attackerHp) => {
    if (targetReflect <= 0 || dmg <= 0) return attackerHp;
    const rf = Math.floor(dmg * targetReflect);
    if (rf <= 0) return attackerHp;
    // v23: 反射持ちアイテムはミラーシールドの他にスパイクメイルもあるため、装備名を出さない汎用文言にする
    log.push(`🪞 ${reflectorName}の装備が攻撃を弾く！ ${attackerName}に${rf}ダメージ反射`);
    return attackerHp - rf;
  };
  // 物理反射の跳ね返りダメージを攻撃側へ適用（strikeのbounced）
  const applyBounce = (bounced, strikerName, strikerHp) => {
    if (!bounced) return strikerHp;
    const remain = strikerHp - bounced;
    log.push(`${strikerName}は跳ね返った${bounced}ダメージを受けた！（残りHP ${Math.max(0, remain)}）`);
    return remain;
  };
  // 吸収（absorb・v19）: 与えたダメージの半分だけ回復（バトル開始時のHPが上限）
  const attAbsorb = (dmg) => {
    if (!attAb.has("absorb") || dmg <= 0 || attHp <= 0) return;
    const heal = Math.min(Math.floor(dmg / 2), attStartHp - attHp);
    if (heal > 0) { attHp += heal; log.push(`🩸 ${attCard.name}の吸収！ HPを${heal}回復（残りHP ${attHp}）`); }
  };
  const defAbsorb = (dmg) => {
    if (!defAb.has("absorb") || dmg <= 0 || defHp <= 0) return;
    const heal = Math.min(Math.floor(dmg / 2), defStartHp - defHp);
    if (heal > 0) { defHp += heal; log.push(`🩸 ${defCard.name}の吸収！ HPを${heal}回復（残りHP ${defHp}）`); }
  };
  // 与えたダメージの累計（吸奪武器 drainMagic の強奪額計算用。無効・反射で0なら加算されない）
  let attDealt = 0, defDealt = 0;
  // 侵略側の手番（1回）。連撃持ちなら相手が生き残っている限りもう1撃（合計2撃）
  const attTurn = () => {
    let r = strike(attCard.name, attStOf(), attAb, attMagic, attNoCrit, attCritRate, defCard.name, defAb, defHp);
    defHp = r.remain;
    attDealt += r.dmg;
    attHp = applyBounce(r.bounced, attCard.name, attHp); // 防衛側の物理反射
    attHp = reflectBack(defReflect, r.dmg, attCard.name, defCard.name, attHp); // 防衛側が反射
    attAbsorb(r.dmg);
    if (defHp > 0 && attHp > 0 && attAb.has("double")) {
      log.push(`🐲 ${attCard.name}の連撃！`);
      r = strike(attCard.name, attStOf(), attAb, attMagic, attNoCrit, attCritRate, defCard.name, defAb, defHp);
      defHp = r.remain;
      attDealt += r.dmg;
      attHp = applyBounce(r.bounced, attCard.name, attHp);
      attHp = reflectBack(defReflect, r.dmg, attCard.name, defCard.name, attHp);
      attAbsorb(r.dmg);
    }
  };
  // 防衛側の手番（1回）。連撃持ちなら同様に2撃目
  const defTurn = () => {
    let r = strike(defCard.name, defStOf(), defAb, defMagic, defNoCrit, defCritRate, attCard.name, attAb, attHp);
    attHp = r.remain;
    defDealt += r.dmg;
    defHp = applyBounce(r.bounced, defCard.name, defHp); // 侵略側の物理反射
    defHp = reflectBack(attReflect, r.dmg, defCard.name, attCard.name, defHp); // 侵略側が反射
    defAbsorb(r.dmg);
    if (attHp > 0 && defHp > 0 && defAb.has("double")) {
      log.push(`🐲 ${defCard.name}の連撃！`);
      r = strike(defCard.name, defStOf(), defAb, defMagic, defNoCrit, defCritRate, attCard.name, attAb, attHp);
      attHp = r.remain;
      defDealt += r.dmg;
      defHp = applyBounce(r.bounced, defCard.name, defHp);
      defHp = reflectBack(attReflect, r.dmg, defCard.name, attCard.name, defHp);
      defAbsorb(r.dmg);
    }
  };
  // 相手の手番中に反射ダメージで自分が倒れることがある（物理反射/ミラーシールド）ため、
  // 反撃側は「自分も相手も生存」のときだけ手番を得る。
  // 遠隔（侵略側）＝防衛側は反撃できない。建造物（防衛側）＝反撃しない。
  const defCanCounter = !attRanged && !defStruct;
  if (defFirst) {
    log.push(`🛡 ${defCard.name}の先制攻撃！`);
    defTurn();
    if (attHp > 0 && defHp > 0) attTurn();
  } else {
    attTurn();
    if (defHp > 0 && attHp > 0 && defCanCounter) defTurn();
  }

  const attackerWins = defHp <= 0;
  if (attackerWins) {
    log.push(`💥 ${defCard.name}は倒された！ ${attCard.name}が土地を奪取！`);
  } else if (attHp <= 0) {
    log.push(`💥 ${attCard.name}は倒された… 侵略失敗！`);
  } else {
    log.push(`⚖ 両者生存。侵略失敗！ ${attCard.name}は撤退した`);
  }
  // 吸奪武器（drainMagic・v17）: 打消し後の有効アイテムなら、与えたダメージ×倍率の魔力を相手から強奪する。
  const attDrain = (attItemEff && attItemEff.drainMagic && attDealt > 0) ? attDealt * attItemEff.drainMagic : 0;
  const defDrain = (defItemEff && defItemEff.drainMagic && defDealt > 0) ? defDealt * defItemEff.drainMagic : 0;
  if (attDrain) log.push(`💰 ${attItemEff.name}の吸奪！ 与えたダメージ${attDealt}×${attItemEff.drainMagic}＝${attDrain}Gを強奪！`);
  if (defDrain) log.push(`💰 ${defItemEff.name}の吸奪！ 与えたダメージ${defDealt}×${defItemEff.drainMagic}＝${defDrain}Gを強奪！`);
  return {
    attackerWins, log, attHp, defHp, attExtra, defExtra, attDrain, defDrain,
    // 転生（rebirth・v19）: 倒されたとき捨札ではなく手札に戻る（アイテム由来の付与も含めた実効判定）
    attRebirth: attAb.has("rebirth"),
    defRebirth: defAb.has("rebirth"),
    // 捕縛の実効判定（チェインネット等アイテム由来の捕縛も含める・v19）
    defCapture: defAb.has("capture"),
  };
}

// 戦闘後にクリーチャーへ持ち越す実HP（最大値でキャップ、生存中は最低1）。
// maxHp には成長分を含めた実最大HP（maxHpOf）を渡すこと（v19）
function woundedHp(finalHp, extra, maxHp) {
  return Math.max(1, Math.min(maxHp, finalHp - extra));
}
