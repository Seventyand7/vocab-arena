/* ============================================================
   Firestore 資料存取層
   users/{uid}/vocab/{wordId}
   users/{uid}/settings/geminiKey
   ============================================================ */

import {
  getDb, collection, doc, getDoc, getDocs, setDoc, addDoc,
  deleteDoc, writeBatch, Timestamp,
} from "./firebase.js";
import { DEFAULT_MODEL, ALLOWED_MODELS } from "./config.js";

let uid = null;
/** 本機快取：整個單字庫。個人用量級（幾百到幾千字）一次載入最單純。 */
let words = [];

export function setUid(nextUid) {
  uid = nextUid;
  words = [];
}

export const getWords = () => words;
export const getWordById = (id) => words.find((w) => w.id === id) || null;

const vocabCol = () => collection(getDb(), "users", uid, "vocab");
const settingsDoc = (name) => doc(getDb(), "users", uid, "settings", name);

/* ---------------- 正規化 ---------------- */

/** Firestore Timestamp / Date / 數字 都轉成 Date，取不到就給 fallback。 */
function toDate(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function normalize(id, data) {
  const now = new Date();
  const m = data.milestonesDone || {};
  return {
    id,
    original: data.original || "",
    translation: data.translation || "",
    partOfSpeech: data.partOfSpeech || "",
    example: data.example || "",
    exampleZh: data.exampleZh || "",
    masteryLevel: Number.isFinite(data.masteryLevel) ? data.masteryLevel : 0,
    nextReviewAt: toDate(data.nextReviewAt, now),
    createdAt: toDate(data.createdAt, now),
    milestonesDone: { d1: !!m.d1, d3: !!m.d3, d7: !!m.d7 },
  };
}

/* ---------------- 單字 ---------------- */

export async function loadWords() {
  const snap = await getDocs(vocabCol());
  words = snap.docs.map((d) => normalize(d.id, d.data()));
  words.sort((a, b) => b.createdAt - a.createdAt);
  return words;
}

/** 新單字：masteryLevel 0、nextReviewAt 現在、里程碑全 false。 */
export async function addWord(entry) {
  const now = new Date();
  const payload = {
    original: entry.original,
    translation: entry.translation,
    partOfSpeech: entry.partOfSpeech,
    example: entry.example,
    exampleZh: entry.exampleZh,
    masteryLevel: 0,
    nextReviewAt: Timestamp.fromDate(now),
    createdAt: Timestamp.fromDate(now),
    milestonesDone: { d1: false, d3: false, d7: false },
  };
  const ref = await addDoc(vocabCol(), payload);
  const local = normalize(ref.id, payload);
  words.unshift(local);
  return local;
}

export async function deleteWord(id) {
  await deleteDoc(doc(getDb(), "users", uid, "vocab", id));
  words = words.filter((w) => w.id !== id);
}

/**
 * 寫回一批單字的複習進度。
 * updates: [{ id, masteryLevel, nextReviewAt: Date, milestonesDone }]
 * 先更新本機快取，再用一個 batch 寫進 Firestore。
 */
export async function saveProgress(updates) {
  if (!updates.length) return;

  for (const u of updates) {
    const w = getWordById(u.id);
    if (!w) continue;
    if (u.masteryLevel !== undefined) w.masteryLevel = u.masteryLevel;
    if (u.nextReviewAt) w.nextReviewAt = u.nextReviewAt;
    if (u.milestonesDone) w.milestonesDone = { ...w.milestonesDone, ...u.milestonesDone };
  }

  // Firestore 單一 batch 上限 500 筆寫入，這裡切塊保險起見。
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(getDb());
    for (const u of updates.slice(i, i + 400)) {
      const w = getWordById(u.id);
      if (!w) continue;
      batch.set(
        doc(getDb(), "users", uid, "vocab", u.id),
        {
          masteryLevel: w.masteryLevel,
          nextReviewAt: Timestamp.fromDate(w.nextReviewAt),
          milestonesDone: w.milestonesDone,
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

/* ---------------- 設定（Gemini key） ---------------- */

export async function loadSettings() {
  const snap = await getDoc(settingsDoc("geminiKey"));
  const data = snap.exists() ? snap.data() : {};
  const model = ALLOWED_MODELS.includes(data.model) ? data.model : DEFAULT_MODEL;
  return { apiKey: data.apiKey || "", model };
}

export async function saveSettings({ apiKey, model }) {
  await setDoc(
    settingsDoc("geminiKey"),
    {
      apiKey: apiKey || "",
      model: ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL,
      updatedAt: Timestamp.fromDate(new Date()),
    },
    { merge: true }
  );
}
