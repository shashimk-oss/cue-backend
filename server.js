require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { clerkClient } = require("@clerk/clerk-sdk-node");
const fetch = require("node-fetch");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const crypto = require("crypto");
const { Pool } = require("pg");
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json({ limit: "10mb" }));
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  try {
    await pool.query("CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at BIGINT NOT NULL)");
    console.log("Database ready");
  } catch (err) { console.log("DB init error:", err.message); }
}
initDB();

async function generateToken(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("INSERT INTO tokens (token, user_id, created_at) VALUES ($1, $2, $3)", [token, userId, Date.now()]);
  return token;
}

async function getUserIdFromToken(token) {
  try {
    const result = await pool.query("SELECT user_id, created_at FROM tokens WHERE token = $1", [token]);
    if (!result.rows.length) return null;
    const { user_id, created_at } = result.rows[0];
    if (Date.now() - parseInt(created_at) > 30 * 24 * 60 * 60 * 1000) {
      await pool.query("DELETE FROM tokens WHERE token = $1", [token]);
      return null;
    }
    return user_id;
  } catch { return null; }
}

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  const token = authHeader.split(" ")[1];
  const userId = await getUserIdFromToken(token);
  if (!userId) return res.status(401).json({ error: "NOT_AUTHENTICATED" });
  req.auth = { userId };
  next();
};

app.get("/health", (req, res) => res.json({ status: "ok", service: "cue-backend" }));

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });
    const existing = await clerkClient.users.getUserList({ emailAddress: [email] });
    const list = existing.data || existing;
    if (list.length > 0) return res.status(400).json({ error: "An account with this email already exists. Please sign in." });
    const user = await clerkClient.users.createUser({ emailAddress: [email], password });
    const token = await generateToken(user.id);
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
    const list = users.data || users;
    if (!list.length) return res.status(401).json({ error: "No account found with this email" });
    const user = list[0];
    try {
      await clerkClient.users.verifyPassword({ userId: user.id, password });
    } catch (e) {
      console.error("Password verify error:", e.message);
      return res.status(401).json({ error: "Incorrect password" });
    }
    const token = await generateToken(user.id);
    res.json({ token, userId: user.id });
  } catch (err) {
    console.error("Signin error:", err.message);
    res.status(401).json({ error: "Sign in failed" });
  }
});

const resetCodes = new Map();

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const users = await clerkClient.users.getUserList({ emailAddress: [email] });
    const list = users.data || users;
    if (!list.length) return res.json({ success: true, message: "If an account exists, a reset code has been sent." });
    const user = list[0];
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    resetCodes.set(email, { code, userId: user.id, expiresAt: Date.now() + 10 * 60 * 1000 });
    await resend.emails.send({
      from: "Cue <onboarding@resend.dev>",
      to: email,
      subject: "Your Cue password reset code",
      html: "<div style='font-family:sans-serif;max-width:400px;margin:0 auto;padding:40px 20px;'><h2 style='color:#111827;'>Reset your Cue password</h2><p style='color:#6b7280;'>Your reset code is:</p><div style='background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center;margin:24px 0;'><div style='font-size:36px;font-weight:800;letter-spacing:0.2em;color:#4f46e5;'>" + code + "</div></div><p style='color:#9ca3af;font-size:13px;'>Expires in 10 minutes. Ignore if you did not request this.</p></div>"
    });
    res.json({ success: true, message: "Reset code sent to your email." });
  } catch (err) {
    console.error("Forgot password error:", err.message);
    res.status(500).json({ error: "Failed to send reset code. Try again." });
  }
});

app.post("/api/auth/verify-reset-code", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Email and code required" });
    const entry = resetCodes.get(email);
    if (!entry) return res.status(400).json({ error: "No reset code found. Request a new one." });
    if (Date.now() > entry.expiresAt) { resetCodes.delete(email); return res.status(400).json({ error: "Code expired. Request a new one." }); }
    if (entry.code !== code.trim()) return res.status(400).json({ error: "Incorrect code. Try again." });
    res.json({ success: true, userId: entry.userId });
  } catch (err) {
    res.status(500).json({ error: "Verification failed" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: "All fields required" });
    const entry = resetCodes.get(email);
    if (!entry || entry.code !== code.trim() || Date.now() > entry.expiresAt) return res.status(400).json({ error: "Invalid or expired code." });
    if (newPassword.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    await clerkClient.users.updateUser(entry.userId, { password: newPassword });
    resetCodes.delete(email);
    res.json({ success: true, message: "Password reset successfully." });
  } catch (err) {
    console.error("Reset password error:", err.message);
    res.status(500).json({ error: "Failed to reset password. Try again." });
  }
});

async function getUserMeta(userId) {
  try {
    const user = await clerkClient.users.getUser(userId);
    const meta = user.privateMetadata || {};
    const today = new Date().toISOString().split("T")[0];
    return { isPro: meta.isPro === true, usageDate: meta.usageDate || null, usageCount: meta.usageCount || 0, today };
  } catch { return { isPro: false, usageDate: null, usageCount: 0, today: new Date().toISOString().split("T")[0] }; }
}

async function incrementUsage(userId, meta) {
  const today = meta.today;
  const newCount = meta.usageDate === today ? meta.usageCount + 1 : 1;
  await clerkClient.users.updateUserMetadata(userId, { privateMetadata: { ...meta, usageDate: today, usageCount: newCount } });
  return newCount;
}

app.get("/api/user/status", requireAuth, async (req, res) => {
  try {
    const meta = await getUserMeta(req.auth.userId);
    const today = meta.today;
    const dailyCount = meta.usageDate === today ? meta.usageCount : 0;
    const FREE_LIMIT = 10;
    res.json({ isPro: meta.isPro, dailyCount, dailyLimit: meta.isPro ? null : FREE_LIMIT, remaining: meta.isPro ? null : Math.max(0, FREE_LIMIT - dailyCount) });
  } catch { res.status(500).json({ error: "Failed to get user status" }); }
});

app.post("/api/analyze", requireAuth, async (req, res) => {
  try {
    const { prompt, contextHistory, questionRound, domain, primary_intent, secondary_intents, intent_confidence } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });
    const meta = await getUserMeta(req.auth.userId);
    const today = meta.today;
    const dailyCount = meta.usageDate === today ? meta.usageCount : 0;
    const FREE_LIMIT = 10;
    if (!meta.isPro && dailyCount >= FREE_LIMIT) {
      return res.status(402).json({ error: "LIMIT_REACHED", message: "You have used all 10 free suggestions today.", upgradeUrl: process.env.STRIPE_PAYMENT_LINK || "" });
    }
    const result = await analyzePrompt(prompt, contextHistory || [], questionRound || 0, domain || "general", primary_intent || null, secondary_intents || [], intent_confidence || 0.5);
    if (result.type === "suggestion") await incrementUsage(req.auth.userId, { ...meta, usageDate: today, usageCount: dailyCount });
    res.json(result);
  } catch (err) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});

app.post("/api/extract-file", requireAuth, async (req, res) => {
  try {
    const { fileData, fileType } = req.body;
    if (!fileData || !fileType) return res.status(400).json({ error: "File data required" });
    const result = await extractFileContext(fileData, fileType);
    res.json(result);
  } catch { res.status(500).json({ error: "File extraction failed" }); }
});

app.post("/api/create-checkout", requireAuth, async (req, res) => {
  try {
    const user = await clerkClient.users.getUser(req.auth.userId);
    const email = user.emailAddresses[0]?.emailAddress;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], mode: "subscription", customer_email: email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: process.env.APP_URL + "/success", cancel_url: process.env.APP_URL + "/cancel",
      metadata: { userId: req.auth.userId }
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: "Failed to create checkout" }); }
});

app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || ""); }
  catch { return res.status(400).json({ error: "Webhook failed" }); }
  if (event.type === "checkout.session.completed") {
    const userId = event.data.object.metadata?.userId;
    if (userId) await clerkClient.users.updateUserMetadata(userId, { privateMetadata: { isPro: true } });
  }
  res.json({ received: true });
});

async function callAnthropic(messages, system, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: maxTokens || 2048, system, messages })
  });
  if (!response.ok) throw new Error("Anthropic error " + response.status);
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function extractFileContext(fileData, fileType) {
  const isImage = fileType.startsWith("image/");
  const messageContent = isImage
    ? [{ type: "image", source: { type: "base64", media_type: fileType, data: fileData } }, { type: "text", text: "Describe what you see in detail. If it's a UI screen, describe layout, components, colors, issues. Be specific." }]
    : [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: fileData } }, { type: "text", text: "Extract all relevant information: name, role, company, skills, achievements, experience, education." }];
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: messageContent }] })
  });
  const data = await response.json();
  return { extracted: data.content?.[0]?.text || "" };
}

// ── Intent-aware templates ────────────────────────────────────────────────

const INTENT_QUESTIONS = {
  create:        { q1: "Who is the audience and what outcome should this achieve?",            q1file: false, q1label: "",                               q2: "What tone and format do you want?",                                             q2file: true,  q2label: "Attach a reference or brief" },
  transform:     { q1: "What specifically needs changing — tone, structure, or content?",      q1file: true,  q1label: "Attach the original",            q2: "Who is the intended reader and what should the result feel like?",              q2file: false, q2label: "" },
  analyze:       { q1: "What specific question are you trying to answer?",                     q1file: true,  q1label: "Attach data or documents",       q2: "What output format do you need — bullets, table, or narrative?",               q2file: false, q2label: "" },
  research:      { q1: "What specific question or hypothesis are you trying to validate?",     q1file: false, q1label: "",                               q2: "What sources or constraints should I focus on?",                               q2file: true,  q2label: "Attach relevant documents" },
  summarize:     { q1: "What is the most important thing the summary needs to capture?",       q1file: true,  q1label: "Attach the document to summarize", q2: "How long should it be and for what audience?",                               q2file: false, q2label: "" },
  extract:       { q1: "What specific information do you need extracted?",                     q1file: true,  q1label: "Attach the source document",     q2: "What format should the extracted data be in?",                                 q2file: false, q2label: "" },
  classify:      { q1: "What categories or criteria should be used?",                          q1file: true,  q1label: "Attach items to classify",       q2: "What should the output structure look like?",                                  q2file: false, q2label: "" },
  compare:       { q1: "What criteria matter most for this comparison?",                       q1file: false, q1label: "",                               q2: "What decision or outcome does this comparison support?",                        q2file: false, q2label: "" },
  plan:          { q1: "What is the timeframe and what are the key constraints?",              q1file: false, q1label: "",                               q2: "How detailed should this be — high-level milestones or step-by-step?",         q2file: false, q2label: "" },
  critique:      { q1: "What aspects should the critique focus on?",                           q1file: true,  q1label: "Attach the work to critique",    q2: "Who is the intended audience for this feedback?",                              q2file: false, q2label: "" },
  optimize:      { q1: "What specific metric or outcome do you want to improve?",              q1file: true,  q1label: "Attach the current version",     q2: "What constraints or trade-offs should be respected?",                          q2file: false, q2label: "" },
  explain:       { q1: "What is the background level of the audience — beginner or expert?",   q1file: false, q1label: "",                               q2: "What aspect is most confusing or needs the most depth?",                       q2file: true,  q2label: "Attach related material" },
  generate_code: { q1: "What is the tech stack and what exactly should this code do?",         q1file: true,  q1label: "Attach existing code or spec",   q2: "Are there constraints — performance, style, or dependencies?",                 q2file: false, q2label: "" },
  debug:         { q1: "What is the current behaviour and what should it do instead?",         q1file: true,  q1label: "Attach a screenshot of the error", q2: "What is the tech stack and any relevant error messages?",                   q2file: false, q2label: "" },
  ideate:        { q1: "What problem are you solving and who is it for?",                      q1file: false, q1label: "",                               q2: "Are there any constraints or directions to avoid?",                            q2file: false, q2label: "" },
  decide:        { q1: "What are the options and what criteria matter most?",                  q1file: false, q1label: "",                               q2: "What trade-offs are you most concerned about?",                                q2file: false, q2label: "" },
};

const INTENT_PROMPT_TEMPLATES = {
  create:        "Role → Task → Audience → Tone → Format → Constraints → Success criteria",
  transform:     "Role → Original content → Transformation goal → Audience → Tone → Format → What to preserve",
  analyze:       "Role → Data/context → Analysis dimensions → Key question → Output format → Constraints → Deliverable",
  research:      "Role → Research question → Scope → Sources → Methodology → Output format → Deliverable",
  summarize:     "Role → Source material → Key focus → Audience → Length → Format → What to omit",
  extract:       "Role → Source material → What to extract → Format → Output structure → Edge cases → Deliverable",
  classify:      "Role → Items → Categories → Criteria → Output format → Edge cases → Deliverable",
  compare:       "Role → Items to compare → Criteria → Weights → Output format → Recommendation requirement → Deliverable",
  plan:          "Role → Goal → Timeframe → Constraints → Level of detail → Format → Success criteria",
  critique:      "Role → Work to critique → Focus areas → Audience → Tone → Format → Actionability",
  optimize:      "Role → Current state → Target metric → Constraints → Trade-offs → Output format → Success criteria",
  explain:       "Role → Concept → Audience level → Depth → Analogies → Format → Examples",
  generate_code: "Role → Task → Tech stack → Requirements → Constraints → Style → Output format",
  debug:         "Role → Code/system → Current behaviour → Expected behaviour → Error messages → Tech stack → Fix requirements",
  ideate:        "Role → Problem → Audience → Constraints → Quantity → Format → Evaluation criteria",
  decide:        "Role → Options → Criteria → Weights → Constraints → Format → Recommendation requirement",
};

const DOMAIN_MODIFIERS = {
  email:    "Include a subject line. Keep language professional yet appropriately warm.",
  coding:   "Include language and framework context. Prefer working, runnable examples.",
  research: "Distinguish facts from inference. Note where sources should be cited.",
  sales:    "Frame around customer value and outcomes. Be specific about ROI.",
  general:  "",
};

async function analyzePrompt(prompt, contextHistory, questionRound, domain, primary_intent, secondary_intents, intent_confidence) {
  if (prompt.trim().length < 10) return { type: "null", suggestion: null };

  const forceGenerate = questionRound >= 2;
  const lowConfidence = !primary_intent || intent_confidence < 0.4;

  // Fall back to a general template when confidence is too low
  const intent = lowConfidence ? null : primary_intent;
  const q = intent ? INTENT_QUESTIONS[intent] : INTENT_QUESTIONS.create;
  const template = intent ? INTENT_PROMPT_TEMPLATES[intent] : INTENT_PROMPT_TEMPLATES.create;
  const domainMod = DOMAIN_MODIFIERS[domain] || "";

  // Build secondary intent note for multi-intent prompts
  const secondaryNote = secondary_intents?.length
    ? `Secondary intents detected: ${secondary_intents.join(", ")}. If complementary, merge into one prompt. If conflicting, note stepwise execution in the reason field.`
    : "";

  const intentLine = intent
    ? `Primary intent: ${intent.toUpperCase()}\nPrompt template to follow: ${template}`
    : `Intent unclear — determine the best intent from the prompt and pick appropriate questions.`;

  const systemPrompt = `You are an expert prompt engineer specialising in structured prompt construction.
Domain: ${(domain || "general").toUpperCase()}
${intentLine}
${domainMod ? `Domain modifier: ${domainMod}` : ""}
${secondaryNote}

Ask up to 2 targeted questions to gather missing context, then build a 7-section structured prompt.
Q1: ${q.q1}${q.q1file ? ` (allow file upload: ${q.q1label})` : ""}
Q2: ${q.q2}${q.q2file ? ` (allow file upload: ${q.q2label})` : ""}

Skip questions if the prompt already contains enough context to build a great structured prompt.
${forceGenerate ? "OVERRIDE: The user has answered enough questions. Generate the full structured prompt NOW." : ""}

Return ONLY valid JSON — no markdown, no explanation:
Question: {"type":"question","questionNumber":1,"question":"...","allowFile":true/false,"fileLabel":"...","improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}
Suggestion: {"type":"suggestion","questionNumber":null,"question":null,"allowFile":false,"fileLabel":"","improved":"full structured prompt","reason":"one sentence why this is better","originalScore":0-100,"improvedScore":0-100}
No match: {"type":"null","questionNumber":null,"question":null,"allowFile":false,"fileLabel":"","improved":null,"reason":null,"originalScore":null,"improvedScore":null}`;

  let userMsg = `<original_prompt>${prompt}</original_prompt>\n<domain>${domain || "general"}</domain>\n<intent>${intent || "unknown"}</intent>\n`;
  if (contextHistory.length > 0) {
    userMsg += "\n<context_gathered>\n";
    contextHistory.forEach((t, i) => { userMsg += `Q${i+1}: ${t.question}\nA${i+1}: ${t.answer}\n\n`; });
    userMsg += "</context_gathered>\n\n";
    userMsg += forceGenerate ? "Build the complete structured prompt now." : `Ask question ${contextHistory.length + 1}.`;
  } else {
    userMsg += "\nCheck if the prompt needs more context. If so, ask Q1. If it already has enough context, generate the structured prompt directly.";
  }

  const text = await callAnthropic([{ role: "user", content: userMsg }], systemPrompt, 2048);
  const parsed = extractJSON(text);
  if (!parsed) return { type: "null", suggestion: null };
  return {
    type: parsed.type || "null",
    questionNumber: parsed.questionNumber || null,
    question: parsed.question || null,
    allowFile: parsed.allowFile || false,
    fileLabel: parsed.fileLabel || null,
    suggestion: parsed.improved || null,
    reason: parsed.reason || null,
    originalScore: parsed.originalScore || null,
    improvedScore: parsed.improvedScore || null,
  };
}

function extractJSON(text) {
  // Try whole response first (ideal case)
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch {}
  // Find first { ... } block in case model added surrounding text
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

app.listen(PORT, () => console.log("Cue backend running on port " + PORT));
