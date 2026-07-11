// ============================================================
// profile.js — プレイヤープロファイル（5人が別々に遊べる）
// コレクション・デッキ・ステージ進行度をプレイヤーごとに分けて保存する。
// 最初に読み込まれる必要がある（stages.js / collection.js が profileStorageKey を使う）
// ============================================================
"use strict";

const PROFILE_KEY = "mana-circuit-profiles"; // プロファイル一覧はプレイヤー共通で1つ
const PROFILE_COUNT = 5;

function defaultProfiles() {
  return {
    current: 0,
    names: Array.from({ length: PROFILE_COUNT }, (_, i) => `プレイヤー${i + 1}`),
  };
}

function loadProfiles() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (p && typeof p === "object" && Array.isArray(p.names)) {
      const def = defaultProfiles();
      // 欠けがあっても安全に補完
      for (let i = 0; i < PROFILE_COUNT; i++) {
        if (typeof p.names[i] !== "string" || !p.names[i].trim()) p.names[i] = def.names[i];
      }
      p.names = p.names.slice(0, PROFILE_COUNT);
      p.current = Math.min(Math.max(0, p.current | 0), PROFILE_COUNT - 1);
      return p;
    }
  } catch (e) { /* 壊れていたら初期化 */ }
  return defaultProfiles();
}

function saveProfiles(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* プライベートモード等 */ }
}

function currentProfile() { return loadProfiles().current; }
function currentProfileName() { const p = loadProfiles(); return p.names[p.current]; }
function profileName(i) { return loadProfiles().names[i]; }

function setCurrentProfile(i) {
  const p = loadProfiles();
  p.current = Math.min(Math.max(0, i | 0), PROFILE_COUNT - 1);
  saveProfiles(p);
}

function renameProfile(i, name) {
  const p = loadProfiles();
  const nm = String(name || "").trim().slice(0, 12);
  if (!nm) return;
  p.names[i] = nm;
  saveProfiles(p);
}

// プレイヤーごとの保存キー。プレイヤー1（index 0）は従来キーをそのまま使う
// ＝これまでのコレクション・進行度は自動的にプレイヤー1のデータになる（後方互換）
function profileStorageKey(base) {
  const i = currentProfile();
  return i === 0 ? base : `${base}-p${i + 1}`;
}
