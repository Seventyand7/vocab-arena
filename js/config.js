/* ============================================================
   Firebase client config
   ------------------------------------------------------------
   這裡的值「不是機密」。Firebase 官方設計就是讓 web config 公開在
   前端，資料安全完全靠 Firestore Security Rules（見 firestore.rules）。
   所以這個檔案可以正常提交進 git、部署到 public repo。

   ⚠️ 不要把 Gemini API key 放進這裡或任何程式碼檔案。
      Gemini key 由使用者登入後在「設定」頁輸入，存到
      users/{uid}/settings/geminiKey。

   使用方式：把 Firebase Console →「專案設定 → 你的應用程式」
   給你的 firebaseConfig 值填進下面即可。
   ============================================================ */

export const firebaseConfig = {
  apiKey: "AIzaSyAOE7nDGMutVIHt_CxhbadKDvpWf7ERDzk",
  authDomain: "vocab-arena-c5c41.firebaseapp.com",
  projectId: "vocab-arena-c5c41",
  storageBucket: "vocab-arena-c5c41.firebasestorage.app",
  messagingSenderId: "213537942084",
  appId: "1:213537942084:web:e0c53204ff708123eeea11"
};

/** config 還沒填的話，app 會改走 setup 畫面（暫存在 localStorage）。 */
export function isConfigPlaceholder(cfg) {
  return !cfg || !cfg.apiKey || String(cfg.apiKey).includes("REPLACE_ME");
}

/* ---------------- Gemini ---------------- */

/** 翻譯是輕量任務，預設用最便宜的 Flash-Lite 等級模型。 */
export const DEFAULT_MODEL = "gemini-2.5-flash-lite";
export const ALLOWED_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
];

/* ---------------- 排程參數 ---------------- */

/** masteryLevel 0–5 對應的複習間隔（天）。 */
export const INTERVALS_DAYS = [1, 2, 4, 7, 14, 30];
export const MAX_LEVEL = 5;

/** 建立後第 N 天必定出現一次的里程碑。 */
export const MILESTONES = [
  { key: "d1", days: 1 },
  { key: "d3", days: 3 },
  { key: "d7", days: 7 },
];

/** 一輪單字卡最多幾張。 */
export const FLASHCARD_SESSION_SIZE = 12;
/** 一輪配對測驗的組數，以及降級時的最低組數。 */
export const MATCH_PAIRS = 6;
export const MATCH_MIN_PAIRS = 2;
