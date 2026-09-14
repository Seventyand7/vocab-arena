/* ============================================================
   排程邏輯（單字卡與翻牌配對共用）

   候選池由兩種條件「疊加」組成：
   1. 時效性強制出現：建立後第 1 / 3 / 7 天必定各排進候選池一次，
      不論當時 masteryLevel 多高；出現後才把 milestonesDone 標 true。
   2. 正確率排程：nextReviewAt 過期的單字進入候選池。

   優先順序：里程碑 → 到期 → 加權隨機補足（熟悉度越低權重越高）。
   ============================================================ */

import { INTERVALS_DAYS, MAX_LEVEL, MILESTONES } from "./config.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 依 masteryLevel 算出下次複習時間。 */
export function computeNextReview(level, now = new Date()) {
  const idx = Math.min(Math.max(level, 0), MAX_LEVEL);
  return new Date(now.getTime() + INTERVALS_DAYS[idx] * DAY_MS);
}

/** 這個單字目前有哪些「已到期但還沒出現過」的里程碑。 */
export function dueMilestones(word, now = new Date()) {
  const created = word.createdAt?.getTime?.() ?? 0;
  return MILESTONES.filter(
    (m) => !word.milestonesDone?.[m.key] && now.getTime() >= created + m.days * DAY_MS
  ).map((m) => m.key);
}

/** 正確率排程是否到期。 */
export function isDue(word, now = new Date()) {
  return (word.nextReviewAt?.getTime?.() ?? 0) <= now.getTime();
}

/** 熟悉度越低，被加權隨機抽中的機率越高（level 0 → 36，level 5 → 1）。 */
function weightOf(word) {
  const lv = Math.min(Math.max(word.masteryLevel ?? 0, 0), MAX_LEVEL);
  return (MAX_LEVEL + 1 - lv) ** 2;
}

/** 不放回的加權隨機抽樣。 */
function weightedSample(pool, count) {
  const remaining = [...pool];
  const picked = [];
  while (picked.length < count && remaining.length) {
    const total = remaining.reduce((sum, w) => sum + weightOf(w), 0);
    let roll = Math.random() * total;
    let idx = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= weightOf(remaining[i]);
      if (roll <= 0) { idx = i; break; }
    }
    picked.push(remaining.splice(idx, 1)[0]);
  }
  return picked;
}

/** Fisher–Yates 洗牌（回傳新陣列）。 */
export function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 組出這一輪的候選池。
 * @returns {{ items: Array<{word, milestones: string[], reason: 'milestone'|'due'|'filler'}>, counts }}
 */
export function buildPool(words, size, now = new Date()) {
  const milestoneMap = new Map();
  const forced = [];
  const due = [];
  const rest = [];

  for (const w of words) {
    const ms = dueMilestones(w, now);
    if (ms.length) {
      milestoneMap.set(w.id, ms);
      forced.push(w);
    } else if (isDue(w, now)) {
      due.push(w);
    } else {
      rest.push(w);
    }
  }

  // 里程碑：拖最久的先出現
  forced.sort((a, b) => {
    const oldest = (w) => Math.min(...milestoneMap.get(w.id).map(
      (k) => (w.createdAt?.getTime?.() ?? 0) + MILESTONES.find((m) => m.key === k).days * DAY_MS
    ));
    return oldest(a) - oldest(b);
  });
  // 到期：逾期最久的先出現
  due.sort((a, b) => (a.nextReviewAt?.getTime?.() ?? 0) - (b.nextReviewAt?.getTime?.() ?? 0));

  const items = [];
  const pushAll = (list, reason) => {
    for (const w of list) {
      if (items.length >= size) break;
      items.push({ word: w, milestones: milestoneMap.get(w.id) || [], reason });
    }
  };

  pushAll(forced, "milestone");
  pushAll(due, "due");

  const counts = {
    milestone: Math.min(forced.length, size),
    due: items.length - Math.min(forced.length, size),
    filler: 0,
    scheduled: items.length,
  };

  // 不足的部分，從沒到期的單字加權隨機補足
  if (items.length < size && rest.length) {
    const fill = weightedSample(rest, size - items.length);
    counts.filler = fill.length;
    pushAll(fill, "filler");
  }

  return { items, counts };
}

/* ---------------- 評分規則 ---------------- */

const clamp = (n) => Math.min(Math.max(n, 0), MAX_LEVEL);

function applyDelta(word, nextLevel, now) {
  const level = clamp(nextLevel);
  return { id: word.id, masteryLevel: level, nextReviewAt: computeNextReview(level, now) };
}

/** 單字卡「記得」→ +1（上限 5）。 */
export const gradeKnown = (word, now = new Date()) =>
  applyDelta(word, (word.masteryLevel ?? 0) + 1, now);

/** 單字卡「不熟」→ 直接歸零（使用者主動承認，用最嚴格的懲罰）。 */
export const gradeForgot = (word, now = new Date()) => applyDelta(word, 0, now);

/** 配對成功 → +1（上限 5）。 */
export const matchHit = (word, now = new Date()) =>
  applyDelta(word, (word.masteryLevel ?? 0) + 1, now);

/** 配對失敗 → −2（下限 0）。可能只是手滑點錯，所以比「不熟」溫和。 */
export const matchMiss = (word, now = new Date()) =>
  applyDelta(word, (word.masteryLevel ?? 0) - 2, now);

/** 把這輪實際出現過的里程碑標成已完成。 */
export function milestonePatch(keys) {
  if (!keys?.length) return null;
  return keys.reduce((acc, k) => ({ ...acc, [k]: true }), {});
}

/** 目前有多少單字「該複習了」（給頂部 DUE 統計用）。 */
export function countDue(words, now = new Date()) {
  return words.filter((w) => dueMilestones(w, now).length > 0 || isDue(w, now)).length;
}
