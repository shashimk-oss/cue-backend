require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { ClerkExpressRequireAuth, clerkClient } = require("@clerk/clerk-sdk-node");
const fetch = require("node-fetch");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(cors({
  origin: [
    "chrome-extension://*",
    /^chrome-extension:\/\/.*/
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Rate limit — 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." }
});
app.use(limiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "cue-backend" });
});

// ── Auth middleware ───────────────────────────────────────────────────────────
const requireAuth = ClerkExpressRequireAuth({});

// ── Auth endpoints ───────────────────────────────────────────────────────────

// Sign up with email/password
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    // Create user in Clerk
    const user = await clerkClient.users.createUser({
      emailAddress: [email],
      password
    });

    // Generate a session token
    const token = await clerkClient.sessions.createSession({ userId: user.id });

    res.json({ token: token.id, userId: user.id });
  } catch (err) {
    const msg = err.errors?.[0]?.message || err.message || "Signup failed";
    res.status(400).json({ error: msg });
  }
});

// Sign in with email/password
app.post("/api/auth/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    // Verify with Clerk
    const signIn = await clerkClient.signInTokens.createSignInToken({
      userId: (await clerkClient.users.getUserList({ emailAddress: [email] }))[0]?.id
    });

    res.json({ token: signIn.token });
  } catch (err) {
    res.status(401).json({ error: "Invalid email or password" });
  }
});

// ── Get user tier and usage ───────────────────────────────────────────────────
async function getUserUsage(userId) {
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

async function incrementUsage(userId, currentUsage) {
  const today = currentUsage.today;
  const newCount = currentUsage.usageDate === today
    ? currentUsage.usageCount + 1
    : 1;

  await clerkClient.users.updateUserMetadata(userId, {
    privateMetadata: {
      ...currentUsage,
      usageDate: today,
      usageCount: newCount
    }
  });

  return newCount;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Check user status
app.get("/api/user/status", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const usage = await getUserUsage(userId);
    const today = usage.today;

    const dailyCount = usage.usageDate === today ? usage.usageCount : 0;
    const FREE_LIMIT = 10;

    res.json({
      isPro: usage.isPro,
      dailyCount,
      dailyLimit: usage.isPro ? null : FREE_LIMIT,
      remaining: usage.isPro ? null : Math.max(0, FREE_LIMIT - dailyCount)
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get user status" });
  }
});

// Analyze prompt — main endpoint
app.post("/api/analyze", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const { prompt, contextHistory, questionRound } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Check usage limits
    const usage = await getUserUsage(userId);
    const today = usage.today;
    const dailyCount = usage.usageDate === today ? usage.usageCount : 0;
    const FREE_LIMIT = 10;

    if (!usage.isPro && dailyCount >= FREE_LIMIT) {
      return res.status(402).json({
        error: "LIMIT_REACHED",
        message: "You've used all 10 free suggestions today. Upgrade to Pro for unlimited access.",
        upgradeUrl: process.env.STRIPE_PAYMENT_LINK
      });
    }

    // Call Anthropic
    const result = await analyzePrompt(prompt, contextHistory || [], questionRound || 0);

    // Increment usage
    await incrementUsage(userId, { ...usage, usageDate: today, usageCount: dailyCount });

    res.json(result);
  } catch (err) {
    console.error("Analyze error:", err);
    res.status(500).json({ error: "Analysis failed" });
  }
});

// Extract file context
app.post("/api/extract-file", requireAuth, async (req, res) => {
  try {
    const { fileData, fileType, fileName } = req.body;
    if (!fileData || !fileType) return res.status(400).json({ error: "File data required" });

    const result = await extractFileContext(fileData, fileType, fileName);
    res.json(result);
  } catch (err) {
    console.error("Extract error:", err);
    res.status(500).json({ error: "File extraction failed" });
  }
});

// Create Stripe checkout session
app.post("/api/create-checkout", requireAuth, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const user = await clerkClient.users.getUser(userId);
    const email = user.emailAddresses[0]?.emailAddress;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: email,
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/cancel`,
      metadata: { userId }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Stripe webhook — handle subscription events
app.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: "Webhook signature failed" });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    if (userId) {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: { isPro: true, stripeCustomerId: session.customer }
      });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const customers = await stripe.customers.list({ limit: 1 });
    // Find user by stripeCustomerId and downgrade
    // In production you'd look this up from your DB
    console.log("Subscription cancelled for customer:", sub.customer);
  }

  res.json({ received: true });
});

// ── Anthropic helpers ─────────────────────────────────────────────────────────

async function callAnthropic(messages, system, maxTokens = 2048) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: maxTokens,
      system,
      messages
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

async function extractFileContext(fileData, fileType, fileName) {
  const isImage = fileType.startsWith("image/");

  const messageContent = isImage ? [
    { type: "image", source: { type: "base64", media_type: fileType, data: fileData } },
    { type: "text", text: "Extract all relevant information from this document that would help personalize a prompt. Include: name, role, company, skills, specific achievements with numbers, experience, education, and any other concrete details. Return a concise structured summary. No commentary." }
  ] : [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileData } },
    { type: "text", text: "Extract all relevant information from this document that would help personalize a prompt. Include: name, role, company, skills, specific achievements with numbers, experience, education, and any other concrete details. Return a concise structured summary. No commentary." }
  ];

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: messageContent }]
    })
  });

  if (!response.ok) throw new Error("File extraction failed");
  const data = await response.json();
  return { extracted: data.content?.[0]?.text || "" };
}

async function analyzePrompt(prompt, contextHistory, questionRound) {
  if (prompt.trim().length < 10) return { type: "null", suggestion: null };

  const forceGenerate = questionRound >= 2;

  const systemPrompt = `<task_context>
You are an expert prompt engineer. Your job is to help users build high-quality, fully structured prompts for any task — writing, coding, analysis, research, creative work, summarization, or anything else. You work in two phases.

PHASE 1: Gather the two pieces of context you cannot infer (max 2 questions)
PHASE 2: Build a complete structured prompt following Anthropic's best practice format
</task_context>

<two_question_sequence>
You always ask exactly these two questions in order, adapted to the task type:

QUESTION 1 — Audience and purpose
What you need: who is this for, what outcome does it need to achieve, any relevant constraints.
Keep it to one short conversational question. Combine audience + purpose naturally.

QUESTION 2 — User context and background
What you need: who the user is, their relevant experience, specific details, credentials, or constraints they bring to this task.
Always mention they can attach a file (resume, doc, code, brief) instead of typing.

Never skip question 2. Never assume who the user is. Always ask for their background before generating.
</two_question_sequence>

<when_to_skip_questions>
Skip question 1 if the prompt already clearly states the audience, purpose, and constraints.
Skip question 2 if the prompt already clearly states the user's background, credentials, and relevant context.
Skip both and generate immediately if the prompt contains all necessary context.
</when_to_skip_questions>

<structured_prompt_format>
Every suggestion must follow Anthropic's 7-section structure:

1. TASK CONTEXT — Role + high-level task using actual details from user's answers
2. TONE CONTEXT — How the AI should communicate, specific to the task
3. BACKGROUND DATA — All user-provided context with XML tags, real details only, no placeholders
4. DETAILED TASK INSTRUCTIONS — Step-by-step breakdown, numbered, specific order
5. EXAMPLES — One strong example and one weak example with checkmarks
6. OUTPUT FORMAT — Exact format, length, structure
7. REMINDER — Most critical instruction repeated
</structured_prompt_format>

<strict_rules>
- Never use placeholder brackets: [name], [company], [your achievement] etc.
- Never assume the user's role or background — only use what they told you
- After 2 questions, always generate — no more questions
- The output must work as a complete ready-to-use prompt
${forceGenerate ? "OVERRIDE: You have reached max questions. Generate the full structured prompt NOW using all context gathered." : ""}
</strict_rules>

<output_format>
Return ONLY valid JSON. No markdown fences, no text outside JSON.

When asking question 1:
{"type": "question", "questionNumber": 1, "question": "...", "allowFile": false, "improved": null, "reason": null, "originalScore": 0-100, "improvedScore": null}

When asking question 2:
{"type": "question", "questionNumber": 2, "question": "...", "allowFile": true, "improved": null, "reason": null, "originalScore": 0-100, "improvedScore": null}

When generating:
{"type": "suggestion", "questionNumber": null, "question": null, "allowFile": false, "improved": "full 7-section structured prompt", "reason": "one sentence on most important improvement", "originalScore": 0-100, "improvedScore": 0-100}

When already excellent:
{"type": "null", "questionNumber": null, "question": null, "allowFile": false, "improved": null, "reason": null, "originalScore": 0-100, "improvedScore": null}
</output_format>`;

  let userMessage = `<original_prompt>${prompt}</original_prompt>\n`;

  if (contextHistory.length > 0) {
    userMessage += `\n<context_gathered>\n`;
    contextHistory.forEach((turn, i) => {
      userMessage += `Q${i + 1}: ${turn.question}\nA${i + 1}: ${turn.answer}\n\n`;
    });
    userMessage += `</context_gathered>\n\n`;

    if (forceGenerate) {
      userMessage += `Build the complete 7-section structured prompt now using all context. No more questions.`;
    } else {
      userMessage += `Ask question ${contextHistory.length + 1} following the two-question sequence.`;
    }
  } else {
    userMessage += `\nAnalyze this prompt. Check if it already has audience/purpose AND user background. If not, ask question 1.`;
  }

  const text = await callAnthropic(
    [{ role: "user", content: userMessage }],
    systemPrompt,
    2048
  );

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

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Cue backend running on port ${PORT}`);
});
