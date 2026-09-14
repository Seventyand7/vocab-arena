/* ============================================================
   Gemini API（Google Generative Language API）
   ------------------------------------------------------------
   API key 一律由呼叫端從 Firestore 讀出後傳進來，
   絕不寫死在程式碼裡。
   ============================================================ */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    translation: { type: "STRING", description: "繁體中文翻譯，簡潔為主" },
    partOfSpeech: {
      type: "STRING",
      description: "詞性，如 名詞／動詞／形容詞／副詞／介系詞／片語",
    },
    example: { type: "STRING", description: "一句簡短的英文例句" },
    exampleZh: { type: "STRING", description: "該例句的繁體中文翻譯" },
  },
  required: ["translation", "partOfSpeech", "example", "exampleZh"],
};

function buildPrompt(input) {
  return [
    "你是一個英文學習助手，服務對象是台灣的中文母語學習者。",
    `請分析這個英文單字或片語：「${input}」`,
    "",
    "規則：",
    "1. translation：給繁體中文翻譯。若有多個常見意思，用「、」分隔，最多三個，不要長篇解釋。",
    "2. partOfSpeech：",
    "   - 如果是「單一單字」，填該字最常見的詞性，例如：名詞、動詞、形容詞、副詞、介系詞、連接詞、代名詞。",
    "   - 如果是「片語、慣用語、動詞片語或多字組合」，一律直接填「片語」，不要硬套成名詞或動詞。",
    "3. example：一句簡短自然的英文例句（約 6–14 字），必須實際用到這個單字或片語。",
    "4. exampleZh：該例句的繁體中文翻譯。",
    "",
    "全部使用繁體中文（例句本身除外）。只輸出 JSON。",
  ].join("\n");
}

function friendlyError(status, message) {
  if (status === 400 && /API key not valid/i.test(message)) {
    return "API key 無效，請到設定頁確認金鑰是否正確。";
  }
  if (status === 403) {
    return "API key 被拒絕（403）。請確認金鑰已啟用 Generative Language API，且沒有設定會擋住本網站的來源限制。";
  }
  if (status === 429) {
    return "超過使用額度或請求太頻繁（429），請稍後再試。";
  }
  if (status === 404) {
    return "找不到這個模型（404）。請到設定頁換一個模型再試。";
  }
  return message || `Gemini API 錯誤（HTTP ${status}）`;
}

async function callGemini(model, apiKey, body) {
  const res = await fetch(
    `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    let message = "";
    try {
      const errJson = await res.json();
      message = errJson?.error?.message || "";
    } catch (_) {
      message = await res.text().catch(() => "");
    }
    const error = new Error(friendlyError(res.status, message));
    error.status = res.status;
    error.raw = message;
    throw error;
  }

  return res.json();
}

/**
 * 翻譯一個英文單字或片語。
 * @returns {Promise<{original,translation,partOfSpeech,example,exampleZh}>}
 */
export async function translateWord(input, apiKey, model) {
  const original = String(input || "").trim();
  if (!original) throw new Error("請先輸入單字或片語。");
  if (!apiKey) throw new Error("尚未設定 Gemini API key，請到「設定」頁輸入。");

  const baseBody = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(original) }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 800,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  // 2.5 系列預設會思考，翻譯單字用不到，關掉可以省 token。
  const body = model.startsWith("gemini-2.5")
    ? { ...baseBody, generationConfig: { ...baseBody.generationConfig, thinkingConfig: { thinkingBudget: 0 } } }
    : baseBody;

  let data;
  try {
    data = await callGemini(model, apiKey, body);
  } catch (err) {
    // 某些模型版本不吃 thinkingConfig，拿掉重試一次。
    if (err.status === 400 && body !== baseBody && /thinking/i.test(err.raw || "")) {
      data = await callGemini(model, apiKey, baseBody);
    } else {
      throw err;
    }
  }

  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) throw new Error(`內容被 Gemini 安全機制擋下（${blocked}），請換一個字試試。`);

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  if (!text.trim()) throw new Error("Gemini 沒有回傳內容，請再試一次。");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    // 萬一模型加了 ```json 圍欄，抓出第一個 JSON 物件再解析
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini 回傳格式無法解析，請再試一次。");
    parsed = JSON.parse(match[0]);
  }

  const clean = (v) => String(v ?? "").trim();
  const result = {
    original,
    translation: clean(parsed.translation),
    partOfSpeech: clean(parsed.partOfSpeech) || "片語",
    example: clean(parsed.example),
    exampleZh: clean(parsed.exampleZh),
  };

  if (!result.translation) throw new Error("Gemini 沒有給出翻譯，請再試一次。");

  // 保底：明顯是多字組合卻沒標成片語時，直接修正。
  if (/\s/.test(original) && !/片語|慣用語/.test(result.partOfSpeech)) {
    result.partOfSpeech = "片語";
  }

  return result;
}

/** 設定頁的「測試連線」：用最小的請求確認金鑰可用。 */
export async function testApiKey(apiKey, model) {
  await callGemini(model, apiKey, {
    contents: [{ role: "user", parts: [{ text: "ping" }] }],
    generationConfig: { maxOutputTokens: 5, temperature: 0 },
  });
  return true;
}
