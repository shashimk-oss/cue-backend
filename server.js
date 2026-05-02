require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { clerkClient } = require("@clerk/clerk-sdk-node");
const fetch = require("node-fetch");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

// ── Token store ───────────────────────────────────────────────────────────
const tokenStore = new Map();

function generateToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  tokenStore.set(token, { userId, createdAt: Date.now() });
  return token;
}

function getUserIdFromToken(token) {
  const entry = tokenStore.get(token);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > 30 * 24 * 60 * 60 * 1000) {
    tokenStore.delete(token);
    return null;
  }
  return entry.userId;
}

// ── Auth middleware ───────────────────────────────────────────────────────
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  }
  const token = authHeader.split(" ")[1];
  const userId = getUserIdFromToken(token);
  if (!userId) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  req.auth = { userId };
  next();
};

// ── Health ────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "cue-backend", users: tokenStore.size });
});

// ── Auth ──────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const existing = await clerkClient.users.getUserList({ emailAddress: [email] });
    if (existing.data && existing.data.length > 0) {
      return res.status(400).json({ error: "An account with this email already exists. Please sign in." });
    }

    const user = await clerkClient.users.createUser({ emailAddress: [email], password });
    const token = generateToken(user.id);
    res.json({ token, userId: user.id });
  } catch (err) {
    const msg = err.errors?.[0]?.longMessage || err.errors?.[0]?.message || err.message || "Signup failed";
    res.status(400).json({ error: msg });
  }
});

app.post("/api/auth/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const users = await clerkClient.users.getUserList({ emailAddress: [email] });
    const userList = users.data || users;
    if (!userList.length) return res.status(401).json({ error: "No account found with this email" });

    const user = userList[0];
    try {
      await clerkClient.users.verifyPassword({ userId: user.id, password });
    } catch {
      return res.status(401).json({ error: "Incorrect password" });
    }

    const token = generateToken(user.id);
    res.json({ token, userId: user.id });
  } catch (err) {
    res.status(401).json({ error: "Sign in failed" });
  }
});

// ── User status ───────────────────────────────────────────────────────────
async function getUserMeta(userId) {
  try {
    const user = await clerkClient.users.getUser(userId);
    const meta = user.privateMetadata || {};
    const today = new Date().toISOString().split("T")[0];
    return { isPro: meta.isPro === true, usageDate: meta.usageDate || null, usageCount: meta.usageCount || 0, today };
  } catch {
    return { isPro: false, usageDate: null, usageCount: 0, today: new Date().toISOString().split("T")[0] };
  }
}

async function incrementUsage(userId, meta) {
  const today = meta.today;
  const newCount = meta.usageDate === today ? meta.usageCount + 1 : 1;
  await clerkClient.users.updateUserMetadata(userId, {
    privateMetadata: { ...meta, usageDate: today, usageCount: newCount }
  });
  return newCount;
}

app.get("/api/user/status", requireAuth, async (req, res) => {
  try {
    const meta = await getUserMeta(req.auth.userId);
    const today = meta.today;
    const dailyCount = meta.usageDate === today ? meta.usageCount : 0;
    const FREE_LIMIT = 10;
    res.json({ isPro: meta.isPro, dailyCount, dailyLimit: meta.isPro ? null : FREE_LIMIT, remaining: meta.isPro ? null : Math.max(0, FREE_LIMIT - dailyCount) });
  } catch {
    res.status(500).json({ error: "Failed to get user status" });
  }
});

// ── Analyze ───────────────────────────────────────────────────────────────
app.post("/api/analyze", requireAuth, async (req, res) => {
  try {
    const { prompt, contextHistory, questionRound, taskType } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const meta = await getUserMeta(req.auth.userId);
    const today = meta.today;
    const dailyCount = meta.usageDate === today ? meta.usageCount : 0;
    const FREE_LIMIT = 10;

    if (!meta.isPro && dailyCount >= FREE_LIMIT) {
      return res.status(402).json({ error: "LIMIT_REACHED", message: "You have used all 10 free suggestions today.", upgradeUrl: process.env.STRIPE_PAYMENT_LINK || "" });
    }

    const result = await analyzePrompt(prompt, contextHistory || [], questionRound || 0, taskType || "general");
    await incrementUsage(req.auth.userId, { ...meta, usageDate: today, usageCount: dailyCount });
    res.json(result);
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: "Analysis failed" });
  }
});

// ── Extract file ──────────────────────────────────────────────────────────
app.post("/api/extract-file", requireAuth, async (req, res) => {
  try {
    const { fileData, fileType } = req.body;
    if (!fileData || !fileType) return res.status(400).json({ error: "File data required" });
    const result = await extractFileContext(fileData, fileType);
    res.json(result);
  } catch {
    res.status(500).json({ error: "File extraction failed" });
  }
});

// ── Stripe ────────────────────────────────────────────────────────────────
app.post("/api/create-checkout", requireAuth, async (req, res) => {
  try {
    const user = await clerkClient.users.getUser(req.auth.userId);
    const email = user.emailAddresses[0]?.emailAddress;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.APP_URL}/success`,
      cancel_url: `${process.env.APP_URL}/cancel`,
      metadata: { userId: req.auth.userId }
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: "Failed to create checkout" });
  }
});

app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || "");
  } catch {
    return res.status(400).json({ error: "Webhook failed" });
  }
  if (event.type === "checkout.session.completed") {
    const userId = event.data.object.metadata?.userId;
    if (userId) await clerkClient.users.updateUserMetadata(userId, { privateMetadata: { isPro: true } });
  }
  res.json({ received: true });
});

// ── Anthropic ─────────────────────────────────────────────────────────────
async function callAnthropic(messages, system, maxTokens = 2048) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system, messages })
  });
  if (!response.ok) throw new Error(`Anthropic error ${response.status}`);
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function extractFileContext(fileData, fileType) {
  const isImage = fileType.startsWith("image/");
  const messageContent = isImage
    ? [{ type: "image", source: { type: "base64", media_type: fileType, data: fileData } }, { type: "text", text: "Describe what you see in this image in detail. If it's a UI/app screen, describe the layout, components, colors, issues, and structure. If it's a document, extract all relevant information. Be specific and thorough." }]
    : [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: fileData } }, { type: "text", text: "Extract all relevant information: name, role, company, skills, achievements with numbers, experience, education. Return a concise structured summary." }];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: messageContent }] })
  });
  const data = await response.json();
  return { extracted: data.content?.[0]?.text || "" };
}

// ── Task-adaptive prompt analysis ────────────────────────────────────────
async function analyzePrompt(prompt, contextHistory, questionRound, taskType) {
  if (prompt.trim().length < 10) return { type: "null", suggestion: null };
  const forceGenerate = questionRound >= 2;

  // Task-specific question strategies
  const taskStrategies = {
    design: {
      q1: "What specific issue are you trying to fix or improve? (e.g. layout broken on mobile, colors feel off, component needs redesign)",
      q1file: true,
      q1filelabel: "You can also attach a screenshot of the current screen",
      q2: "What should the result look like? Describe the desired outcome or attach a reference image.",
      q2file: true,
      q2filelabel: "Attach a reference design or screenshot",
      context: "This is a UI/design/layout task. The user is working on screens, components, or visual design."
    },
    code: {
      q1: "What exactly is the current behaviour and what should it do instead?",
      q1file: true,
      q1filelabel: "Attach a screenshot of the error or current state",
      q2: "What's the tech stack and any relevant constraints I should know about?",
      q2file: false,
      q2filelabel: "",
      context: "This is a coding/development task. The user is building, fixing, or improving code."
    },
    writing: {
      q1: "Who are you writing to and what outcome do you need?",
      q1file: false,
      q1filelabel: "",
      q2: "What's your background and the key points to include? You can attach a file.",
      q2file: true,
      q2filelabel: "Attach resume, CV, brief, or reference doc",
      context: "This is a writing task."
    },
    analysis: {
      q1: "What specific question are you trying to answer and what will you do with the result?",
      q1file: true,
      q1filelabel: "Attach relevant data, documents, or screenshots",
      q2: "What context or constraints should I know about?",
      q2file: true,
      q2filelabel: "Attach supporting documents",
      context: "This is an analysis or research task."
    },
    general: {
      q1: "Who is this for and what outcome do you need?",
      q1file: false,
      q1filelabel: "",
      q2: "What's your relevant background or context? You can attach a file.",
      q2file: true,
      q2filelabel: "Attach a relevant file or document",
      context: "This is a general task."
    }
  };

  const strategy = taskStrategies[taskType] || taskStrategies.general;

  const systemPrompt = `<task_context>
You are an expert prompt engineer. Your job is to help users build high-quality structured prompts for any task. You adapt your questions based on the task type detected.

Task type detected: ${taskType.toUpperCase()}
${strategy.context}

You work in two phases:
PHASE 1: Ask up to 2 targeted questions specific to this task type
PHASE 2: Build a complete structured prompt following Anthropic's 7-section format
</task_context>

<task_adaptive_questions>
For ${taskType.toUpperCase()} tasks:

QUESTION 1: ${strategy.q1}
${strategy.q1file ? `File upload available: ${strategy.q1filelabel}` : "No file upload for Q1"}

QUESTION 2: ${strategy.q2}
${strategy.q2file ? `File upload available: ${strategy.q2filelabel}` : "No file upload for Q2"}

Always adapt your language to the task type. For design tasks ask about screens and layouts. For code tasks ask about behaviour and stack. For writing ask about audience and purpose.
</task_adaptive_questions>

<when_to_skip_questions>
Skip Q1 if the prompt already clearly describes the specific issue or goal.
Skip Q2 if the prompt already has enough context to generate a precise, actionable suggestion.
Skip both and generate immediately if you have everything needed.
</when_to_skip_questions>

<structured_prompt_format>
Every suggestion must follow these 7 sections adapted to the task type:

1. TASK CONTEXT — Role and task using actual details. Never assume identity.
2. TONE CONTEXT — How the AI should communicate for this task type
3. BACKGROUND DATA — All context provided, with XML tags. Real details only, no placeholders.
4. DETAILED TASK INSTRUCTIONS — Numbered steps specific to this task type
5. EXAMPLES — One strong, one weak example relevant to this task
6. OUTPUT FORMAT — Exact format for this task type
7. REMINDER — Most critical instruction for this task type

For DESIGN tasks: instructions should cover what to examine, what to change, how to handle edge cases, responsive considerations.
For CODE tasks: instructions should cover what the current code does, what needs to change, constraints, testing.
For WRITING tasks: instructions should cover structure, tone, length, what to include/exclude.
</structured_prompt_format>

<strict_rules>
- Never use placeholder brackets
- Never assume the user's identity
- After 2 questions, always generate
- Output must be immediately usable
${forceGenerate ? "OVERRIDE: Generate the full structured prompt now." : ""}
</strict_rules>

<output_format>
Return ONLY valid JSON:

Question 1: {"type":"question","questionNumber":1,"question":"...","allowFile":${strategy.q1file},"fileLabel":"${strategy.q1filelabel}","improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}
Question 2: {"type":"question","questionNumber":2,"question":"...","allowFile":${strategy.q2file},"fileLabel":"${strategy.q2filelabel}","improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}
Suggestion: {"type":"suggestion","questionNumber":null,"question":null,"allowFile":false,"fileLabel":"","improved":"full 7-section prompt","reason":"one sentence","originalScore":0-100,"improvedScore":0-100}
Already great: {"type":"null","questionNumber":null,"question":null,"allowFile":false,"fileLabel":"","improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}
</output_format>`;

  let userMessage = `<original_prompt>${prompt}</original_prompt>\n<task_type>${taskType}</task_type>\n`;

  if (contextHistory.length > 0) {
    userMessage += `\n<context_gathered>\n`;
    contextHistory.forEach((t, i) => { userMessage += `Q${i+1}: ${t.question}\nA${i+1}: ${t.answer}\n\n`; });
    userMessage += `</context_gathered>\n\n`;
    userMessage += forceGenerate
      ? "Build the complete 7-section structured prompt now using all context. No more questions."
      : `Ask question ${contextHistory.length + 1} adapted for this ${taskType} task.`;
  } else {
    userMessage += `\nCheck if this ${taskType} prompt already has enough specific context. If not, ask the first question adapted for this task type.`;
  }

  const text = await callAnthropic([{ role: "user", content: userMessage }], systemPrompt, 2048);

  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return {
      type: parsed.type || "null",
      questionNumber: parsed.questionNumber || null,
      question: parsed.question || null,
      allowFile: parsed.allowFile || false,
      fileLabel: parsed.fileLabel || null,
      suggestion: parsed.improved || null,
      reason: parsed.reason || null,
      originalScore: parsed.originalScore || null,
      improvedScore: parsed.improvedScore || null
    };
  } catch {
    return { type: "null", suggestion: null };
  }
}

app.listen(PORT, () => console.log(`Cue backend running on port ${PORT}`));
