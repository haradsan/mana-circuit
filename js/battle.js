// ============================================================
// battle.js — 侵略バトルの解決（アイテム・属性相性・会心対応）
// ============================================================
"use strict";

const CRIT_RATE       = 0.10; // 会心の一撃（ダメージ1.5倍）の基本確率
const CRIT_RATE_LUCKY = 0.25; // 豪運持ちの会心確率

// attCard: 侵略側カード / tile: 防衛側の土地 / attItem, defItem: 装備アイテム(null可)
// opts.rng: true なら会心の一撃あり（実戦用）。false（既定）は決定論的（AIのシミュ用）
// opts.g: 指定すると土地の援護（隣接自軍領地による防衛ST補正）を計算に含める
// 返り値: { attackerWins, log, attHp, defHp, attExtra, defExtra }
//   attHp/defHp = 決着時の残りHP（実HP）。attExtra/defExtra = ベースHP以外の加算分（HP残量の逆算用）
// ※状態は変更しない（AIのシミュレーションにも使う）
function resolveBattle(attCard, tile, attItem = null, defItem = null, opts = {}) {
  const rng = !!opts.rng;
  const defCard = CARD_BY_ID[tile.creature.cardId];
  const defBaseHp = tile.creature.hp ?? defCard.hp; // 戦闘後HP残量（前回の傷を引き継ぐ）
  const log = [];

  // アイテム打消し（ディスペルワード）: 相手がnullifyアイテムを装備していたら、こちらのアイテム効果は無効化される
  const attNull = !!(attItem && attItem.nullify);
  const defNull = !!(defItem && defItem.nullify);
  const attItemEff = defNull ? null : attItem; // 実際に効果を発揮する侵略側アイテム
  const defItemEff = attNull ? null : defItem; // 実際に効果を発揮する防衛側アイテム
  if (attNull && defItem) log.push(`🚫 ${attItem.name}が${defCard.name}の${defItem.name}を打ち消した！`);
  if (defNull && attItem) log.push(`🚫 ${defItem.name}が${attCard.name}の${attItem.name}を打ち消した！`);

  // アイテムが付与する能力（アサシンダガーの先制など）も合算（打消し後の有効アイテムで判定）
  const abilities = (c, item) => new Set([...(c.ab || []), ...((item && item.grant) || [])]);
  const attAb = abilities(attCard, attItemEff);
  const defAb = abilities(defCard, defItemEff);
  const attReflect = (attItemEff && attItemEff.reflect) || 0; // 受けた攻撃を反射する割合
  const defReflect = (defItemEff && defItemEff.reflect) || 0;

  let attSt = attCard.st + (attItemEff ? attItemEff.st : 0) + (attAb.has("assault") ? 20 : 0) + RULES.invaderSt;
  let defSt = defCard.st + (defItemEff ? defItemEff.st : 0);
  const advAtt = hasElemAdvantage(attCard.element, defCard.element);
  const advDef = hasElemAdvantage(defCard.element, attCard.element);
  if (advAtt) attSt += ELEM_ADV_ST;
  if (advDef) defSt += ELEM_ADV_ST;
  const support = opts.g ? landSupportSt(opts.g, tile) : 0; // 隣接自軍領地の援護
  if (support > 0) defSt += support;

  const defBonus = attAb.has("pierce") ? 0 : landHpBonus(tile, defCard);
  const guardBonus = defAb.has("guard") ? 20 : 0;
  const attExtra = attItemEff ? attItemEff.hp : 0;
  const defExtra = (defItemEff ? defItemEff.hp : 0) + defBonus + guardBonus;
  let attHp = attCard.hp + attExtra;
  let defHp = defBaseHp + defExtra;

  if (defBaseHp < defCard.hp) log.push(`🩹 ${defCard.name}は前の戦いの傷でHP${defBaseHp}から`);
  if (attItem) log.push(`⚔ ${attCard.name}は${attItem.name}を装備！`);
  if (defItem) log.push(`🛡 ${defCard.name}は${defItem.name}を装備！`);
  if (attAb.has("assault")) log.push(`⚔ ${attCard.name}の強襲！ ST+20`);
  if (RULES.invaderSt > 0) log.push(`🏟 闘技場の熱気！ 侵略側ST+${RULES.invaderSt}`);
  if (support > 0) log.push(`🏰 ${defCard.name}は隣接する味方領地の援護！ ST+${support}`);
  if (advAtt) log.push(`${ELEMENTS[attCard.element].icon} 属性の優位！ ${attCard.name}のST+${ELEM_ADV_ST}`);
  if (advDef) log.push(`${ELEMENTS[defCard.element].icon} 属性の優位！ ${defCard.name}のST+${ELEM_ADV_ST}`);
  if (attAb.has("pierce") && landHpBonus(tile, defCard) > 0) {
    log.push(`⚔ ${attCard.name}の貫通！ 土地ボーナス無効`);
  } else if (defBonus > 0) {
    log.push(`🛡 ${defCard.name}は土地の加護でHP+${defBonus}`);
  }
  if (guardBonus > 0) log.push(`🛡 ${defCard.name}の守護！ HP+${guardBonus}`);

  // 攻撃順: 通常は侵略側が先。防衛側だけが先制持ちなら防衛側が先
  const defFirst = defAb.has("first") && !attAb.has("first");

  // ▼ バフの計算式を明示する（会心以外は決定論＝この数式どおりに殴り合う）。
  //   「会心が出ていないのに計算に合わず負ける」の正体は、土地の加護・援護・守護・先制など
  //   “見えていなかった加算”。ここで実効ST/HPと必要手数を式で残すことで勝敗を検証できるようにする。
  //   これらの行は playBattleLines 経由でバトル画面とステージログの両方に出る。
  const bd = (total, base, parts) => {
    const terms = parts.filter(([, v]) => v).map(([lbl, v]) => `${v > 0 ? "+" : ""}${v}(${lbl})`);
    return terms.length ? `${total} ＝ ${base} ${terms.join(" ")}` : `${total}`;
  };
  log.push(`📊【式】侵略 ${attCard.name}: ST ${bd(attSt, attCard.st, [["装備", attItemEff ? attItemEff.st : 0], ["強襲", attAb.has("assault") ? 20 : 0], ["属性", advAtt ? ELEM_ADV_ST : 0], ["闘技場", RULES.invaderSt]])} ／ HP ${bd(attHp, attCard.hp, [["装備", attExtra]])}`);
  log.push(`📊【式】防衛 ${defCard.name}: ST ${bd(defSt, defCard.st, [["装備", defItemEff ? defItemEff.st : 0], ["属性", advDef ? ELEM_ADV_ST : 0], ["援護", support]])} ／ HP ${bd(defHp, defBaseHp, [["装備", defItemEff ? defItemEff.hp : 0], ["土地の加護", defBonus], ["守護", guardBonus]])}`);
  // 侵略は「一撃で相手の実効HPを削り切れば占領」。届かなければ守られる（会心なら1.5倍で覆ることも）。
  // ここを式で明示することで「基礎HPだけ見て勝てるはずが、土地の加護・守護で実効HPが上がり届かず負けた」を検証できる。
  // 連撃（double）持ちは1手番で2回攻撃するため、一撃の到達判定はST×2で見る
  const attTotal = attAb.has("double") ? attSt * 2 : attSt;
  const canOneShot = attTotal >= defHp;
  const critReach = !canOneShot && Math.floor(attSt * 1.5) * (attAb.has("double") ? 2 : 1) >= defHp;
  log.push(`📊【式】決着: 侵略の一撃 ST${attSt}${attAb.has("double") ? `×2(連撃)＝${attTotal}` : ""} ${canOneShot ? "≥" : "<"} 防衛の実効HP${defHp} → ${canOneShot ? "撃破して占領" : `守られる（あと${defHp - attTotal}届かない${critReach ? "／💫会心が出れば届く" : ""}）`}${defFirst ? "　※防衛が先制（侵略側HPが低いと反撃で討死）" : ""}`);

  // 一撃を計算（会心込み）。{ remain: 対象の残HP, dmg: 与えたダメージ } を返す
  const strike = (name, st, ab, targetName, targetHp) => {
    let dmg = st;
    if (rng && Math.random() < (ab.has("lucky") ? CRIT_RATE_LUCKY : CRIT_RATE)) {
      dmg = Math.floor(st * 1.5);
      log.push(`💫 ${name}の会心の一撃！！`);
    }
    const remain = targetHp - dmg;
    log.push(`${name}の攻撃！ ${targetName}に${dmg}ダメージ（残りHP ${Math.max(0, remain)}）`);
    return { remain, dmg };
  };
  // 反射（ミラーシールド）: 攻撃を受けた側が、受けたダメージの一部を攻撃側へ跳ね返す
  const reflectBack = (targetReflect, dmg, attackerName, reflectorName, attackerHp) => {
    if (targetReflect <= 0 || dmg <= 0) return attackerHp;
    const rf = Math.floor(dmg * targetReflect);
    if (rf <= 0) return attackerHp;
    log.push(`🪞 ${reflectorName}のミラーシールド！ ${attackerName}に${rf}ダメージ反射`);
    return attackerHp - rf;
  };

  // 侵略側の手番（1回）。連撃持ちなら相手が生き残っている限りもう1撃（合計2撃）
  const attTurn = () => {
    let r = strike(attCard.name, attSt, attAb, defCard.name, defHp);
    defHp = r.remain;
    attHp = reflectBack(defReflect, r.dmg, attCard.name, defCard.name, attHp); // 防衛側が反射
    if (defHp > 0 && attHp > 0 && attAb.has("double")) {
      log.push(`🐲 ${attCard.name}の連撃！`);
      r = strike(attCard.name, attSt, attAb, defCard.name, defHp);
      defHp = r.remain;
      attHp = reflectBack(defReflect, r.dmg, attCard.name, defCard.name, attHp);
    }
  };
  // 防衛側の手番（1回）。連撃持ちなら同様に2撃目
  const defTurn = () => {
    let r = strike(defCard.name, defSt, defAb, attCard.name, attHp);
    attHp = r.remain;
    defHp = reflectBack(attReflect, r.dmg, defCard.name, attCard.name, defHp); // 侵略側が反射
    if (attHp > 0 && defHp > 0 && defAb.has("double")) {
      log.push(`🐲 ${defCard.name}の連撃！`);
      r = strike(defCard.name, defSt, defAb, attCard.name, attHp);
      attHp = r.remain;
      defHp = reflectBack(attReflect, r.dmg, defCard.name, attCard.name, defHp);
    }
  };
  if (defFirst) {
    log.push(`🛡 ${defCard.name}の先制攻撃！`);
    defTurn();
    if (attHp > 0) attTurn();
  } else {
    attTurn();
    if (defHp > 0) defTurn();
  }

  const attackerWins = defHp <= 0;
  if (attackerWins) {
    log.push(`💥 ${defCard.name}は倒された！ ${attCard.name}が土地を奪取！`);
  } else if (attHp <= 0) {
    log.push(`💥 ${attCard.name}は倒された… 侵略失敗！`);
  } else {
    log.push(`⚖ 両者生存。侵略失敗！ ${attCard.name}は撤退した`);
  }
  return { attackerWins, log, attHp, defHp, attExtra, defExtra };
}

// 戦闘後にクリーチャーへ持ち越す実HP（ベース最大値でキャップ、生存中は最低1）
function woundedHp(finalHp, extra, maxHp) {
  return Math.max(1, Math.min(maxHp, finalHp - extra));
}
