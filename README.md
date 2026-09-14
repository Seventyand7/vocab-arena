# VOCAB QUEST · 單字練習

個人使用的英文單字學習工具。輸入單字後由 Gemini 自動產生中文翻譯、詞性與例句，再用單字卡和翻牌配對兩種方式複習；資料存在 Firebase Firestore，登入同一個 Google 帳號就能跨裝置同步。

## 使用前要準備兩件事

**1. 登入 Google 帳號**

打開網站後按「使用 Google 帳號登入」。登入後才能存取任何單字資料。

**2. 輸入自己的 Gemini API key**

到 [Google AI Studio](https://aistudio.google.com/apikey) 免費建立一組 API key，登入本站後在「設定」頁貼上並儲存即可。

> 金鑰存在你自己的 Firestore 文件 `users/<你的 uid>/settings/geminiKey`，受 Security Rules 保護、只有你自己讀得到。**它不會寫進程式碼，也不會被提交進 git。**

## 三個介面

| 介面 | 做什麼 |
| --- | --- |
| **新增單字** | 輸入英文單字或片語 → 按「翻譯」→ 檢查 Gemini 給的翻譯／詞性／例句 → 滿意再按「確認加入單字庫」才會存檔 |
| **單字卡** | 卡片正面英文、翻面看中文與例句，再按「記得」或「不熟」評分 |
| **翻牌配對** | 每輪 6 組單字共 12 張牌，把英文卡和對應的中文卡配成一對 |

另外有「單字庫」可以瀏覽／搜尋／刪除單字，「設定」可以管理 API key 與模型。

## 複習排程規則

兩個複習介面共用同一套排程。決定「哪些單字該出現」時，同時套用兩種條件：

1. **時效性強制出現** — 每個單字建立後的第 **1 / 3 / 7 天**，必定各被排進候選池一次（不論當下熟悉度多高）。出現過後才記錄該里程碑已完成。
2. **正確率排程** — 熟悉度 0–5 對應複習間隔 **1 / 2 / 4 / 7 / 14 / 30 天**。`nextReviewAt` 過期就進候選池。

候選池的優先順序是：里程碑到期 → 正確率到期 → **加權隨機補足**（熟悉度越低權重越高，答錯過的字更容易被抽到）。若整個單字庫湊不滿一輪，會自動縮減該輪組數，真的太少時會直接提示單字量不足。

熟悉度的增減：

| 情境 | 變化 | 為什麼 |
| --- | --- | --- |
| 單字卡「記得」 | +1（上限 5） | |
| 單字卡「不熟」 | **直接歸零** | 使用者主動承認不會，是明確訊號，用最嚴格的懲罰 |
| 配對成功 | +1（上限 5） | |
| 配對失敗 | 兩張牌所屬的單字各 **−2**（下限 0） | 翻錯可能只是手滑，不代表真的不熟，所以比「不熟」溫和 |

## 自己架一份

### 1. 建立 Firebase 專案

1. 到 [Firebase Console](https://console.firebase.google.com/) 建立專案。
2. **Authentication** → Sign-in method → 啟用 **Google**。
3. **Firestore Database** → 建立資料庫。
4. Authentication → Settings → **Authorized domains** 加入你的 GitHub Pages 網域（例如 `your-name.github.io`）。

### 2. 填入 Firebase client config

把 Firebase Console →「專案設定 → 你的應用程式」給的 `firebaseConfig` 填進 [`js/config.js`](js/config.js)。

> 這段 config **不是機密**。Firebase 官方設計就是讓它公開在前端，資料安全完全靠 Security Rules，所以可以正常提交進 public repository，不需要刻意隱藏。這跟 Gemini API key 是兩回事 —— Gemini key 絕對不能進程式碼。

（如果還沒填，網站會先跳出一個 SETUP 畫面讓你暫時貼上 config 試跑，那份只會存在瀏覽器的 localStorage。）

### 3. 部署 Security Rules

把 [`firestore.rules`](firestore.rules) 的內容貼到 Firebase Console → Firestore Database → 規則 → 發布。

規則確保每個使用者**只能讀寫自己 uid 底下的資料**，未登入或非本人的請求一律拒絕。這一步沒做的話資料等於沒有保護，務必完成。

### 4. 部署到 GitHub Pages

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<repo 名稱>.git
git push -u origin main
```

然後到 repository 的 **Settings → Pages**，Source 選 `Deploy from a branch`，branch 選 `main` / `(root)`，儲存後等一兩分鐘即可。

## 資料結構

```
users/{uid}/vocab/{wordId}
  original       string    英文單字或片語
  translation    string    中文翻譯
  partOfSpeech   string    詞性（片語就填「片語」）
  example        string    英文例句
  exampleZh      string    例句中文翻譯
  masteryLevel   number    熟悉度 0–5
  nextReviewAt   timestamp 下次排程複習時間
  createdAt      timestamp 建立時間
  milestonesDone map       { d1: bool, d3: bool, d7: bool }

users/{uid}/settings/geminiKey
  apiKey         string    使用者自己的 Gemini API key
  model          string    使用的模型
```

## 技術

純前端，沒有建置流程 —— HTML / CSS / 原生 ES modules 直接跑。

- Firebase Authentication（Google 登入）＋ Firestore，透過 CDN 載入 modular SDK
- Gemini API：預設 `gemini-2.5-flash-lite`（翻譯單字這種輕量任務用最便宜的等級就夠，設定頁可切換）
- 字體：Press Start 2P（數字與標題）＋ Noto Sans TC（內文）

## 檔案

```
index.html          單頁結構
css/styles.css      深色電玩風格樣式與動畫
js/config.js        Firebase config、模型與排程參數
js/firebase.js      Firebase 初始化與登入
js/store.js         Firestore 讀寫
js/gemini.js        Gemini API 呼叫
js/scheduler.js     排程與熟悉度規則
js/flashcards.js    單字卡
js/match.js         翻牌配對
js/ui.js            共用 UI 小工具
js/app.js           主程式
firestore.rules     Security Rules
```
