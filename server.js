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

async function analyzePrompt(prompt, contextHistory, questionRound, taskType) {
  if (prompt.trim().length < 10) return { type: "null", suggestion: null };
  const forceGenerate = questionRound >= 2;
  const strategies = {
    design: { q1: "What specific issue are you trying to fix or improve with this design?", q1file: true, q1label: "Attach a screenshot of the current screen", q2: "What should the result look like? Describe the desired outcome.", q2file: true, q2label: "Attach a reference design", context: "UI/design/layout task" },
    code: { q1: "What is the current behaviour and what should it do instead?", q1file: true, q1label: "Attach a screenshot of the error", q2: "What is the tech stack and any relevant constraints?", q2file: false, q2label: "", context: "coding/development task" },
    writing: { q1: "Who are you writing to and what outcome do you need?", q1file: false, q1label: "", q2: "What is your background and the key points to include?", q2file: true, q2label: "Attach resume, brief, or reference doc", context: "writing task" },
    analysis: { q1: "What specific question are you trying to answer?", q1file: true, q1label: "Attach relevant data or documents", q2: "What context or constraints should I know about?", q2file: true, q2label: "Attach supporting documents", context: "analysis/research task" },
    general: { q1: "Who is this for and what outcome do you need?", q1file: false, q1label: "", q2: "What is your relevant background or context?", q2file: true, q2label: "Attach a relevant file", context: "general task" }
  };
  const s = strategies[taskType] || strategies.general;
  const systemPrompt = `You are an expert prompt engineer. Task type: ${taskType.toUpperCase()} (${s.context}).
Ask up to 2 targeted questions then build a 7-section structured prompt.
Q1: ${s.q1} ${s.q1file ? "(file upload: " + s.q1label + ")" : ""}
Q2: ${s.q2} ${s.q2file ? "(file upload: " + s.q2label + ")" : ""}
Skip questions if prompt already has enough context.
${forceGenerate ? "OVERRIDE: Generate the full structured prompt NOW." : ""}
Return ONLY valid JSON:
Question: {"type":"question","questionNumber":1or2,"question":"...","allowFile":true/false,"fileLabel":"...","improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}
Suggestion: {"type":"suggestion","questionNumber":null,"question":null,"allowFile":false,"fileLabel":"","improved":"full 7-section prompt","reason":"one sentence","originalScore":0-100,"improvedScore":0-100}
No match: {"type":"null","questionNumber":null,"question":null,"allowFile":false,"fileLabel":"","improved":null,"reason":null,"originalScore":0-100,"improvedScore":null}`;
  let userMsg = "<original_prompt>" + prompt + "</original_prompt>\n<task_type>" + taskType + "</task_type>\n";
  if (contextHistory.length > 0) {
    userMsg += "\n<context_gathered>\n";
    contextHistory.forEach((t, i) => { userMsg += "Q" + (i+1) + ": " + t.question + "\nA" + (i+1) + ": " + t.answer + "\n\n"; });
    userMsg += "</context_gathered>\n\n";
    userMsg += forceGenerate ? "Build the complete 7-section prompt now." : "Ask question " + (contextHistory.length + 1) + ".";
  } else { userMsg += "\nCheck if prompt needs more context. If so ask Q1."; }
  const text = await callAnthropic([{ role: "user", content: userMsg }], systemPrompt, 2048);
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return { type: parsed.type || "null", questionNumber: parsed.questionNumber || null, question: parsed.question || null, allowFile: parsed.allowFile || false, fileLabel: parsed.fileLabel || null, suggestion: parsed.improved || null, reason: parsed.reason || null, originalScore: parsed.originalScore || null, improvedScore: parsed.improvedScore || null };
  } catch { return { type: "null", suggestion: null }; }
}

app.listen(PORT, () => console.log("Cue backend running on port " + PORT));
