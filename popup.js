// popup.js — Cue

const BACKEND_URL = "https://cue-backend-production-4585.up.railway.app";
const CLERK_FRONTEND_API = "https://clerk.cue.app"; // update after Railway deploy

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

// Boot
chrome.storage.local.get("clerkToken", async (data) => {
  if (data.clerkToken) {
    showScreen("screen-home");
    loadUserStatus();
  } else {
    showScreen("screen-welcome");
  }
});

// ── Tab switching ──────────────────────────────────────────────────────────
let currentTab = "signup";

function switchTab(tab) {
  currentTab = tab;
  document.getElementById("tab-signup").classList.toggle("active", tab === "signup");
  document.getElementById("tab-signin").classList.toggle("active", tab === "signin");
  const btn = document.getElementById("auth-submit-btn");
  btn.textContent = tab === "signup" ? "Create free account" : "Sign in";
}

// ── Auth ──────────────────────────────────────────────────────────────────
async function handleAuth() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value.trim();
  const statusEl = document.getElementById("auth-status");
  const btn = document.getElementById("auth-submit-btn");

  if (!email || !password) {
    showStatus(statusEl, "error", "Please enter email and password");
    return;
  }

  btn.disabled = true;
  btn.textContent = currentTab === "signup" ? "Creating account…" : "Signing in…";
  showStatus(statusEl, "loading", currentTab === "signup" ? "Creating your account…" : "Signing in…");

  try {
    const endpoint = currentTab === "signup"
      ? `${BACKEND_URL}/api/auth/signup`
      : `${BACKEND_URL}/api/auth/signin`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Authentication failed");
    }

    if (data.token) {
      chrome.storage.local.set({ clerkToken: data.token }, () => {
        showScreen("screen-home");
        loadUserStatus();
      });
    } else {
      throw new Error("No token received");
    }
  } catch (err) {
    showStatus(statusEl, "error", err.message || "Something went wrong");
    btn.disabled = false;
    btn.textContent = currentTab === "signup" ? "Create free account" : "Sign in";
  }
}

async function authWithGoogle() {
  // Open Clerk hosted auth page in a new tab
  chrome.tabs.create({
    url: `${BACKEND_URL}/auth/google?source=extension`
  });
}

// ── User status ────────────────────────────────────────────────────────────
async function loadUserStatus() {
  try {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`${BACKEND_URL}/api/user/status`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (res.status === 401) {
      chrome.storage.local.remove("clerkToken");
      showScreen("screen-welcome");
      return;
    }

    const data = await res.json();

    if (data.isPro) {
      document.getElementById("usage-card").style.display = "none";
      document.getElementById("pro-badge").style.display = "flex";
      document.getElementById("upgrade-row").style.display = "none";
    } else {
      const count = data.dailyCount || 0;
      const limit = data.dailyLimit || 10;
      const pct = Math.min(100, (count / limit) * 100);

      document.getElementById("usage-count").textContent = `${count} / ${limit}`;
      document.getElementById("usage-bar").style.width = `${pct}%`;

      // Change bar color when close to limit
      if (pct >= 80) {
        document.getElementById("usage-bar").style.background = "#ef4444";
      }

      if (count >= limit) {
        document.getElementById("usage-upgrade").style.display = "block";
        document.getElementById("upgrade-row").style.display = "flex";
      } else if (count >= limit * 0.7) {
        document.getElementById("usage-upgrade").style.display = "block";
      }
    }
  } catch (err) {
    console.error("Failed to load user status:", err);
  }
}

async function handleUpgrade() {
  try {
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/api/create-checkout`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.url) chrome.tabs.create({ url: data.url });
  } catch {
    chrome.tabs.create({ url: "https://cueapp.co/upgrade" });
  }
}

async function handleForgotPassword() {
  const email = document.getElementById("forgot-email").value.trim();
  const statusEl = document.getElementById("forgot-status");
  const btn = document.getElementById("forgot-submit-btn");
  if (!email) { showStatus(statusEl, "error", "Please enter your email"); return; }
  btn.disabled = true;
  btn.textContent = "Sending...";
  showStatus(statusEl, "loading", "Sending reset link...");
  try {
    const res = await fetch(BACKEND_URL + "/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    showStatus(statusEl, "success", data.message || "Reset link sent — check your inbox.");
    btn.textContent = "Sent!";
  } catch {
    showStatus(statusEl, "error", "Something went wrong. Try again.");
    btn.disabled = false;
    btn.textContent = "Send reset link";
  }
}

function handleSignOut() {
  chrome.storage.local.remove("clerkToken", () => {
    showScreen("screen-welcome");
  });
}

function getToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get("clerkToken", (d) => resolve(d.clerkToken || null));
  });
}

function showStatus(el, type, msg) {
  el.className = "status-msg " + type;
  el.textContent = msg;
}

// Enter key on password field
document.getElementById("auth-password")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleAuth();
});
