require("dotenv").config();
const express = require("express");
const app2 = null; // placeholder
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { clerkClient } = require("@clerk/clerk-sdk-node");
const fetch = require("node-fetch");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

// ── Simple token store (in-memory for now) ────────────────────────────────
// In production this would be Redis or a DB
const tokenStore = new Map();

function generateToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  tokenStore.set(token, { userId, createdAt: Date.now() });
  return token;
}

function getUserIdFromToken(token) {
  const entry = tokenStore.get(token);
  if (!entry) return null;
  // Expire after 30 days
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

// ── Health check ──────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "cue-backend", users: tokenStore.size });
});

// ── Auth endpoints ────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    // Check if user exists
    const existing = await clerkClient.users.getUserList({ emailAddress: [email] });
    if (existing.data && existing.data.length > 0) {
      return res.status(400).json({ error: "An account with this email already exists. Please sign in." });
    }

    // Create user
    const user = await clerkClient.users.createUser({
      emailAddress: [email],
      password
    });

    const token = generateToken(user.id);
    res.json({ token, userId: user.id });
  } catch (err) {
    console.error("Signup error:", err);
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

    // Verify password
    try {
      await clerkClient.users.verifyPassword({ userId: user.id, password });
    } catch {
      return res.status(401).json({ error: "Incorrect password" });
    }

    const token = generateToken(user.id);
    res.json({ token, userId: user.id });
  } catch (err) {
    console.error("Signin error:", err);
    res.status(401).json({ error: "Sign in failed" });
  }
});

// ── User status ───────────────────────────────────────────────────────────
async function getUserMeta(userId) {
  try {
    const user = await clerkClient.users.getUser(userId);
    const meta = user.privateMetadata || {};
    const today = new Date().toISOString().split("T")[0];
    return {
      isPro: meta.isPro === true,
      usageDate: meta.usageDate || null,
      usageCount: meta.usageCount || 0,
      today
    };
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
    res.json({
      isPro: meta.isPro,
      dailyCount,
      dailyLimit: meta.isPro ? null : FREE_LIMIT,
      remaining: meta.isPro ? null : Math.max(0, FREE_LIMIT - dailyCount)
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get user status" });
  }
});

// ── Analyze prompt ────────────────────────────────────────────────────────
app.post("/api/analyze", requireAuth, async (req, res) => {
  try {
    const { prompt, contextHistory, questionRound } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    const meta = await getUserMeta(req.auth.userId);
    const today = meta.today;
    const dailyCount = meta.usageDate === today ? meta.usageCount : 0;
    const FREE_LIMIT = 10;

    if (!meta.isPro && dailyCount >= FREE_LIMIT) {
      return res.status(402).json({
        error: "LIMIT_REACHED",
        message: "You have used all 10 free suggestions today. Upgrade to Pro for unlimited access.",
        upgradeUrl: process.env.STRIPE_PAYMENT_LINK || ""
      });
    }

    const result = await analyzePrompt(prompt, contextHistory || [], questionRound || 0);
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
  } catch (err) {
    res.status(500).json({ error: "File extraction failed" });
  }
});

// ── Stripe checkout ───────────────────────────────────────────────────────
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

// ── Stripe webhook ────────────────────────────────────────────────────────
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

// ── Anthropic helpers ─────────────────────────────────────────────────────
async function callAnthropic(messages, system, maxTokens = 2048) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens, system, messages })
  });
  if (!response.ok) throw new Error(`Anthropic error ${response.status}`);
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function extractFileContext(fileData, fileType) {
  const isImage = fileType.startsWith("image/");
  const messageContent = isImage
    ? [{ type: "image", source: { type: "base64", media_type: fileType, data: fileData } }, { type: "text", text: "Extract all relevant information: name, role, company, skills, achievements with numbers, experience, education. Return a concise structured summary." }]
    : [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: fileData } }, { type: "text", text: "Extract all relevant information: name, role, company, skills, achievements with numbers, experience, education. Return a concise structured summary." }];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: messageContent }] })
  });
  const data = await response.json();
  return { extracted: data.content?.[0]?.text || "" };
}

async function analyzePrompt(prompt, contextHistory, questionRound) {
  if (prompt.trim().length < 10) return { type: "null", suggestion: null };
  const forceGenerate = questionRound >= 2;

  const systemPrompt = `<task_context>
You are an expert prompt engineer helping users build high-quality structured prompts for any task. Work in two phases:
PHASE 1: Ask up to 2 targeted questions to gather context you cannot infer
PHASE 2: Build a complete structured prompt following Anthropic's best practice format
</task_context>

<two_question_sequence>
QUESTION 1: Ask about audience and purpose — who is this for and what outcome is needed. One short conversational question.
QUESTION 2: Ask about the user's background, experience, and relevant context. Mention they can attach a file.
Never skip question 2. Never assume the user's identity.
</two_question_sequence>

<structured_prompt_format>
Every suggestion must follow these 7 sections:
1. TASK CONTEXT — Role and high-level task using actual user details
2. TONE CONTEXT — How the AI should communicate
3. BACKGROUND DATA — All user context with XML tags, real details only
4. DETAILED TASK INSTRUCTIONS — Numbered step-by-step breakdown
5. EXAMPLES — One strong and one weak example
6. OUTPUT FORMAT — Exact format, length, structure
7. REMINDER — Most critical instruction repeated
</structured_prompt_format>

<strict_rules>
- Never use placeholder brackets like [name] or [company]
- Never assume the user's role — only use what they told you
- After 2 questions, always generate
- Output must be ready to use immediately
${forceGenerate ? "OVERRIDE: Generate the full structured prompt now using all context gathered." : ""}
</strict_rules>

<output_format>
Return ONLY valid JSON:
Question 1: {"type":"question","questionNumber":1,"question":"...","allowFile":false,"improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}
Question 2: {"type":"question","questionNumber":2,"question":"...","allowFile":true,"improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}
Suggestion: {"type":"suggestion","questionNumber":null,"question":null,"allowFile":false,"improved":"full 7-section prompt","reason":"one sentence","originalScore":0-100,"improvedScore":0-100}
Already good: {"type":"null","questionNumber":null,"question":null,"allowFile":false,"improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}
</output_format>`;

  let userMessage = `<original_prompt>${prompt}</original_prompt>\n`;
  if (contextHistory.length > 0) {
    userMessage += `\n<context_gathered>\n`;
    contextHistory.forEach((t, i) => { userMessage += `Q${i+1}: ${t.question}\nA${i+1}: ${t.answer}\n\n`; });
    userMessage += `</context_gathered>\n\n`;
    userMessage += forceGenerate
      ? "Build the complete 7-section structured prompt now. No more questions."
      : `Ask question ${contextHistory.length + 1}.`;
  } else {
    userMessage += `\nCheck if the prompt has both audience/purpose AND user background. If not, ask question 1.`;
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
