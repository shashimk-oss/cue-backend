// background.js — Cue
const BACKEND_URL = "https://cue-backend-production-4585.up.railway.app";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_PROMPT") {
    analyzePrompt(message.prompt, message.contextHistory || [], message.questionRound || 0)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "EXTRACT_FILE") {
    extractFile(message.fileData, message.fileType, message.fileName)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "GET_USER_STATUS") {
    getUserStatus().then(sendResponse).catch(() => sendResponse({ error: "Failed" }));
    return true;
  }

  if (message.type === "CREATE_CHECKOUT") {
    createCheckout().then(sendResponse).catch(() => sendResponse({ error: "Failed" }));
    return true;
  }

  if (message.type === "GET_TOKEN") {
    chrome.storage.local.get("clerkToken", (data) => {
      sendResponse({ token: data.clerkToken || null });
    });
    return true;
  }

  if (message.type === "SET_TOKEN") {
    chrome.storage.local.set({ clerkToken: message.token }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "CLEAR_TOKEN") {
    chrome.storage.local.remove("clerkToken", () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function getToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get("clerkToken", (data) => {
      resolve(data.clerkToken || null);
    });
  });
}

async function callBackend(path, method = "GET", body = null) {
  const token = await getToken();
  if (!token) throw new Error("NOT_AUTHENTICATED");

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    }
  };

  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${BACKEND_URL}${path}`, options);
  const data = await response.json();

  if (response.status === 401) throw new Error("NOT_AUTHENTICATED");
  if (response.status === 402) throw new Error(JSON.stringify(data));
  if (!response.ok) throw new Error(data.error || `Server error ${response.status}`);

  return data;
}

async function getUserStatus() {
  return callBackend("/api/user/status");
}

async function extractFile(fileData, fileType, fileName) {
  return callBackend("/api/extract-file", "POST", { fileData, fileType, fileName });
}

async function createCheckout() {
  return callBackend("/api/create-checkout", "POST");
}

// ── Detect task type from prompt ──────────────────────────────────────────
function detectTaskType(prompt) {
  const p = prompt.toLowerCase();

  const designKeywords = ["layout", "design", "screen", "ui", "ux", "mobile", "component", "button", "color", "font", "spacing", "padding", "margin", "responsive", "figma", "wireframe", "redesign", "style", "css", "theme", "icon", "modal", "navbar", "sidebar", "card", "flex", "grid", "animation", "dark mode", "light mode"];
  const codeKeywords = ["fix", "bug", "error", "function", "code", "build", "create app", "implement", "api", "database", "deploy", "refactor", "debug", "feature", "endpoint", "component", "class", "method", "variable", "import", "export", "async", "await", "replit", "github"];
  const analysisKeywords = ["analyze", "analyse", "research", "compare", "summarize", "report", "data", "insights", "explain", "breakdown", "review", "evaluate", "assess"];
  const writingKeywords = ["write", "draft", "email", "letter", "post", "article", "blog", "message", "cover letter", "proposal", "essay", "copy", "content", "announcement"];

  const designScore = designKeywords.filter(k => p.includes(k)).length;
  const codeScore = codeKeywords.filter(k => p.includes(k)).length;
  const analysisScore = analysisKeywords.filter(k => p.includes(k)).length;
  const writingScore = writingKeywords.filter(k => p.includes(k)).length;

  const max = Math.max(designScore, codeScore, analysisScore, writingScore);
  if (max === 0) return "general";
  if (designScore === max) return "design";
  if (codeScore === max) return "code";
  if (analysisScore === max) return "analysis";
  if (writingScore === max) return "writing";
  return "general";
}

async function analyzePrompt(prompt, contextHistory, questionRound) {
  if (prompt.trim().length < 10) return { type: "null", suggestion: null };

  // Detect task type for adaptive questioning
  const taskType = detectTaskType(prompt);
  const forceGenerate = questionRound >= 2;

  try {
    return await callBackend("/api/analyze", "POST", {
      prompt,
      contextHistory,
      questionRound,
      taskType
    });
  } catch (err) {
    if (err.message === "NOT_AUTHENTICATED") {
      return { error: "NOT_AUTHENTICATED" };
    }
    if (err.message.includes("LIMIT_REACHED")) {
      try {
        const data = JSON.parse(err.message);
        return { error: "LIMIT_REACHED", upgradeUrl: data.upgradeUrl };
      } catch {
        return { error: "LIMIT_REACHED" };
      }
    }
    throw err;
  }
}
