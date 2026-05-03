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

// ── Adaptive prompt intelligence engine ───────────────────────────────────

const CORE_INTENTS = [
  "create", "transform", "analyze", "research", "summarize", "extract",
  "classify", "compare", "plan", "critique", "optimize", "explain",
  "generate_code", "debug", "ideate", "decide"
];

const FALLBACK_QUESTIONS = {
  create: "Who is this for, and what should the finished result help them do?",
  transform: "What should change, what should stay, and who is the result for?",
  analyze: "What question should the analysis answer, and what angles matter most?",
  research: "What exactly should be researched, and what sources or limits should guide it?",
  summarize: "What source should be summarized, and what should the summary emphasize?",
  extract: "What information should be pulled out, and what format should it be returned in?",
  classify: "What items need categorizing, and what categories or criteria should be used?",
  compare: "What options should be compared, and what criteria matter most?",
  plan: "What is the goal, timeframe, and biggest constraint?",
  critique: "What should be reviewed, and what kind of feedback would be most useful?",
  optimize: "What outcome should improve, and what trade-offs should be respected?",
  explain: "Who is the explanation for, and how deep should it go?",
  generate_code: "What should the code do, and what tech stack or platform should it use?",
  debug: "What is happening now, what should happen instead, and what error or code can you share?",
  ideate: "What problem are you solving, who is it for, and what constraints should ideas respect?",
  decide: "What options are you choosing between, and what criteria should decide the winner?",
  unknown: "What outcome do you want, who is it for, and what constraints should Cue respect?"
};

const FALLBACK_FILE_LABELS = {
  create: "Attach a reference, brief, or example",
  transform: "Attach the original content",
  analyze: "Attach data, notes, or source material",
  research: "Attach relevant documents or source material",
  summarize: "Attach the document to summarize",
  extract: "Attach the source document",
  classify: "Attach the items to classify",
  compare: "Attach options, requirements, or notes",
  plan: "Attach requirements, notes, or constraints",
  critique: "Attach the work to review",
  optimize: "Attach the current version or metrics",
  explain: "Attach related material",
  generate_code: "Attach existing code, specs, or wireframes",
  debug: "Attach code, logs, screenshots, or error output",
  ideate: "Attach a brief, notes, or examples",
  decide: "Attach options, notes, or requirements",
  unknown: "Attach helpful context"
};

function normalizeCoreIntent(intent) {
  if (!intent || typeof intent !== "string") return "unknown";
  const normalized = intent.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return CORE_INTENTS.includes(normalized) ? normalized : "unknown";
}

function buildFallbackResponse(prompt, browserIntent, questionRound) {
  const text = prompt.toLowerCase();
  let intent = normalizeCoreIntent(browserIntent);

  if (intent === "unknown") {
    if (/\b(fix|bug|error|crash|broken|debug|traceback|stack)\b/.test(text)) intent = "debug";
    else if (/\b(code|implement|app|component|api|script|function|website|webpage)\b/.test(text)) intent = "generate_code";
    else if (/\b(compare|versus|vs\.?|better|choose|recommend)\b/.test(text)) intent = "compare";
    else if (/\b(plan|roadmap|schedule|strategy|outline)\b/.test(text)) intent = "plan";
    else if (/\b(analyze|insight|evaluate|assess)\b/.test(text)) intent = "analyze";
    else if (/\b(explain|teach|what is|how does|why does)\b/.test(text)) intent = "explain";
    else intent = "create";
  }

  return {
    type: "question",
    questionNumber: Math.min((questionRound || 0) + 1, 2),
    question: FALLBACK_QUESTIONS[intent] || FALLBACK_QUESTIONS.unknown,
    allowFile: ["transform", "analyze", "summarize", "extract", "classify", "critique", "optimize", "generate_code", "debug"].includes(intent),
    fileLabel: FALLBACK_FILE_LABELS[intent] || FALLBACK_FILE_LABELS.unknown,
    suggestion: null,
    reason: null,
    originalScore: null,
    improvedScore: null,
  };
}

async function analyzePrompt(prompt, contextHistory, questionRound, domain, primary_intent, secondary_intents, intent_confidence) {
  const trimmed = (prompt || "").trim();
  if (trimmed.length < 5) return { type: "null", suggestion: null };

  const forceGenerate = questionRound >= 2;
  const browserHint = {
    domain: domain || "unknown",
    primary_intent: primary_intent || "unknown",
    secondary_intents: Array.isArray(secondary_intents) ? secondary_intents : [],
    intent_confidence: typeof intent_confidence === "number" ? intent_confidence : 0
  };

  const systemPrompt = `You are Cue's adaptive prompt intelligence engine.

Your job:
1. Classify the user's raw ask without being limited by predefined verbs, domains, industries, writing styles, or task shapes.
2. Infer:
   - open_domain: the real subject area in natural language, e.g. "mobile app product design", "enterprise sales email", "React debugging", "medical literature review".
   - core_intent: one of ${CORE_INTENTS.join(", ")}. This is a routing label only.
   - specific_action: the user's actual operation in plain language, with no taxonomy limit.
   - deliverable: what the user wants produced.
   - missing_context: the highest-impact missing information.
3. Ask a personalized question when important context is missing.
4. Generate a structured prompt when enough context exists.

Prompt construction standard:
- Build prompts using Claude-style best practices: clear and direct instructions, enough context, a domain-appropriate role, explicit constraints, and a precise output format.
- Prefer compact execution prompts over long strategy documents. The prompt should help the downstream model complete the user's task, not teach the user how to do the task unless the user asked for a plan, rubric, critique, or strategy.
- Use this default structure when generating improved prompts:
  <role>One sentence naming the expert role the model should play.</role>
  <task>One direct instruction describing exactly what to produce or do.</task>
  <context>Only the user-provided facts and relevant constraints. Do not invent specifics.</context>
  <instructions>Numbered or bulleted steps only when sequence or completeness matters.</instructions>
  <constraints>Tone, length, style, exclusions, tools, sources, or implementation constraints.</constraints>
  <output_format>Exactly what the response should contain, in the order it should appear.</output_format>
- Adapt or omit sections when they add no value. For simple writing tasks, 4-6 concise labeled sections is usually enough.
- Use XML-style tags when the prompt mixes instructions, source material, examples, or variable inputs. Otherwise use clean labeled sections.
- Put long source material or extracted file context before the task instructions when source material exists.
- Include examples only when they materially improve consistency, tone, or format. Do not add examples just to look thorough.
- Tell the downstream model what to do, not just what to avoid. Use positive requirements.
- Match the prompt style to the desired output. If the user wants a ready-to-send email, the generated prompt should request only subject line and email body, not a long email-writing framework.
- For coding or tool-use tasks, explicitly state whether the model should implement, debug, explain, plan, or review. If action is desired, make the action explicit.
- For analysis or decision tasks, specify criteria, evidence/source handling, output shape, and recommendation requirement.
- For creative/design tasks, specify audience, goal, constraints, visual/style direction, and deliverable format without forcing generic aesthetics.
- For career/outreach/email tasks, include recipient, role/context, sender background/proof, purpose, tone, CTA, and output format. Keep the final prompt concise and ready-to-execute.
- The improved prompt should reduce wasted tokens: remove redundant context, avoid broad meta-instructions, and keep only details that improve the output.

Important behavior:
- The browser-provided classifier is only a weak hint. Override it whenever the raw ask suggests something better.
- Never depend only on keyword matching. Interpret noun-first asks like "a mobile app for barbers" as real tasks.
- Never return null for a valid AI prompt request, no matter how short.
- Do not show file upload unless a file would materially improve the result.
- If upload helps, the fileLabel must be specific to the ask. Never use generic resume/CV language unless the prompt is actually about a resume, CV, hiring, recruiting, or career material.
- For job outreach, career emails, role applications, recruiting, hiring, cover letters, or professional background questions, file upload usually helps. Allow upload and use a label like "Attach resume, LinkedIn summary, deal sheet, or role notes".
- Questions must sound like they were written for the user's exact ask, not pulled from a canned template.
- The generated prompt must be structured but not bloated. It should be no longer than necessary for reliable execution.
- For compound tasks, merge complementary intents into one structured prompt. If tasks truly conflict, make the prompt stepwise.
- After two answered questions, generate the structured prompt.

Return ONLY valid JSON:
{
  "type": "question" | "suggestion" | "null",
  "classification": {
    "open_domain": "natural language domain",
    "core_intent": "one of the core intents",
    "specific_action": "open-ended action",
    "secondary_actions": ["0-2 open-ended actions"],
    "confidence": 0.0-1.0
  },
  "questionNumber": 1 or 2 or null,
  "question": "personalized question or null",
  "allowFile": true or false,
  "fileLabel": "specific upload label or empty string",
  "improved": "concise Claude-optimized structured prompt or null",
  "reason": "short reason or null",
  "originalScore": 0-100 or null,
  "improvedScore": 0-100 or null
}`;

  let userMsg = `<original_prompt>${trimmed}</original_prompt>\n`;
  userMsg += `<browser_hint>${JSON.stringify(browserHint)}</browser_hint>\n`;
  userMsg += `<question_round>${questionRound || 0}</question_round>\n`;

  if (contextHistory.length > 0) {
    userMsg += "\n<context_gathered>\n";
    contextHistory.forEach((t, i) => {
      userMsg += `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer}\n\n`;
    });
    userMsg += "</context_gathered>\n";
  }

  userMsg += forceGenerate
    ? "\nGenerate the best concise, executable structured prompt now using the original ask and gathered context. Do not create a strategy guide, rubric, or teaching document unless the user explicitly asked for one."
    : "\nIf one high-impact context gap remains, ask exactly one personalized question. If enough context exists, generate the structured prompt now.";

  const text = await callAnthropic([{ role: "user", content: userMsg }], systemPrompt, 2048);
  const parsed = extractJSON(text);

  if (!parsed || parsed.type === "null") {
    return buildFallbackResponse(trimmed, browserHint.primary_intent, questionRound);
  }

  const type = parsed.type === "suggestion" ? "suggestion" : "question";
  const normalizedIntent = normalizeCoreIntent(parsed.classification?.core_intent || browserHint.primary_intent);
  const fallback = buildFallbackResponse(trimmed, normalizedIntent, questionRound);
  const questionNumber = type === "question"
    ? (parsed.questionNumber || Math.min((questionRound || 0) + 1, 2))
    : null;

  return {
    type,
    questionNumber,
    question: type === "question" ? (parsed.question || fallback.question) : null,
    allowFile: Boolean(parsed.allowFile),
    fileLabel: parsed.allowFile ? (parsed.fileLabel || fallback.fileLabel) : "",
    suggestion: type === "suggestion" ? (parsed.improved || null) : null,
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
