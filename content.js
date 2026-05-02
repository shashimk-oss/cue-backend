// content.js — Prompt Coach
(function () {
  "use strict";

  let currentSuggestion = null;
  let currentQuestion = null;
  let currentQuestionNumber = null;
  let currentAllowFile = false;
  let currentFileLabel = null;
  let currentReason = null;
  let currentOriginalScore = null;
  let currentImprovedScore = null;
  let currentOriginalText = null;
  let currentResponseType = null;
  let contextHistory = [];
  let questionRound = 0;

  let debounceTimer = null;
  let card = null;
  let dotTrigger = null;
  let activeTextarea = null;
  let lastAnalyzedText = "";
  let isLoading = false;
  let cardDismissed = false;

  const SELECTORS = [
    'div[contenteditable="true"][data-placeholder]',
    'textarea[placeholder]',
    "#prompt-textarea",
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]'
  ];

  init();

  function init() {
    createCard();
    observeDOM();
    attachToExistingInputs();
  }

  function observeDOM() {
    const observer = new MutationObserver(() => attachToExistingInputs());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function attachToExistingInputs() {
    SELECTORS.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.dataset.pcAttached) return;
        el.dataset.pcAttached = "true";
        attachListeners(el);
      });
    });
  }

  function attachListeners(el) {
    el.addEventListener("input", () => handleInput(el));
    el.addEventListener("keyup", () => handleInput(el));
    el.addEventListener("compositionend", () => handleInput(el));
    const mo = new MutationObserver(() => handleInput(el));
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("focus", () => { activeTextarea = el; });
    el.addEventListener("blur", (e) => {
      if (card && card.contains(e.relatedTarget)) return;
      setTimeout(() => { if (!card?.matches(":hover")) hideCard(); }, 200);
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { hideCard(); cardDismissed = true; }
      if (e.key !== "Escape") cardDismissed = false;
    });
  }

  function handleInput(el) {
    activeTextarea = el;
    const text = getTextContent(el);

    if (text !== currentOriginalText && contextHistory.length > 0) {
      contextHistory = [];
      questionRound = 0;
      cardDismissed = false;
    }

    hideCard();
    removeDotTrigger();
    clearTimeout(debounceTimer);

    if (text.trim().length < 10) {
      currentSuggestion = null;
      currentQuestion = null;
      return;
    }

    debounceTimer = setTimeout(() => {
      if (!cardDismissed || text !== lastAnalyzedText) {
        runAnalysis(el, text);
      }
    }, 1800);
  }

  function getTextContent(el) {
    if (el.tagName === "TEXTAREA") return el.value;
    return el.innerText || el.textContent || "";
  }

  function runAnalysis(el, text) {
    if (isLoading) return;
    isLoading = true;
    lastAnalyzedText = text;
    currentOriginalText = text;
    showDotTrigger(el, true);

    chrome.runtime.sendMessage(
      { type: "ANALYZE_PROMPT", prompt: text, contextHistory, questionRound },
      (response) => {
        isLoading = false;
        if (chrome.runtime.lastError) { removeDotTrigger(); return; }
        if (response?.error === "NO_API_KEY") { showNoKeyCard(el); return; }

        currentResponseType = response?.type || "null";
        currentQuestion = response?.question || null;
        currentQuestionNumber = response?.questionNumber || null;
        currentAllowFile = response?.allowFile || false;
        currentFileLabel = response?.fileLabel || null;
        currentSuggestion = response?.suggestion || null;
        currentReason = response?.reason || null;
        currentOriginalScore = response?.originalScore || null;
        currentImprovedScore = response?.improvedScore || null;

        if (currentResponseType === "question" || currentResponseType === "suggestion") {
          showDotTrigger(el, false);
          setTimeout(() => showCard(el), 150);
        } else {
          removeDotTrigger();
        }
      }
    );
  }

  function showDotTrigger(el, loading) {
    removeDotTrigger();
    const container = getPositioningContainer(el);
    if (!container) return;

    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    dotTrigger = document.createElement("div");

    if (loading) {
      dotTrigger.className = "cue-underline cue-underline-loading";
      dotTrigger.title = "Prompt Coach is analyzing…";
    } else {
      dotTrigger.className = "cue-underline cue-underline-ready";
      dotTrigger.title = "Prompt Coach suggestion ready — hover to view";

      // Show card on hover over the textarea itself
      el._pcMouseEnter = () => showCard(el);
      el._pcMouseLeave = (e) => {
        // Only hide if not moving to the card
        setTimeout(() => {
          if (!card?.matches(":hover")) hideCard();
        }, 150);
      };
      el.addEventListener("mouseenter", el._pcMouseEnter);
      el.addEventListener("mouseleave", el._pcMouseLeave);
    }

    container.appendChild(dotTrigger);
  }

  function removeDotTrigger() {
    if (dotTrigger) {
      dotTrigger.remove();
      dotTrigger = null;
    }
    // Clean up textarea hover listeners
    if (activeTextarea) {
      if (activeTextarea._pcMouseEnter) {
        activeTextarea.removeEventListener("mouseenter", activeTextarea._pcMouseEnter);
        activeTextarea._pcMouseEnter = null;
      }
      if (activeTextarea._pcMouseLeave) {
        activeTextarea.removeEventListener("mouseleave", activeTextarea._pcMouseLeave);
        activeTextarea._pcMouseLeave = null;
      }
    }
  }

  function getPositioningContainer(el) {
    let node = el.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!node) break;
      const style = getComputedStyle(node);
      if (node.offsetHeight > 40 && (style.position === "relative" || style.position === "absolute" || style.display === "flex")) return node;
      node = node.parentElement;
    }
    return el.parentElement;
  }

  // ── Card ──────────────────────────────────────────────────────────────────

  function createCard() {
    card = document.createElement("div");
    card.id = "cue-card";
    card.innerHTML = `
      <div class="cue-header">
        <svg class="cue-logo" width="20" height="20" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="9" fill="#4f46e5"/><circle cx="16" cy="16" r="5" fill="none" stroke="white" stroke-width="2.5"/><line x1="16" y1="7" x2="16" y2="10" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="16" y1="22" x2="16" y2="25" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="7" y1="16" x2="10" y2="16" stroke="white" stroke-width="2.5" stroke-linecap="round"/><line x1="22" y1="16" x2="25" y2="16" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>
        <span class="cue-title">Cue</span>
        <span class="cue-header-right" id="cue-header-right"></span>
      </div>

      <!-- Question mode -->
      <div class="cue-question-mode" id="cue-question-mode" style="display:none">
        <div class="cue-progress" id="cue-progress"></div>
        <p class="cue-question-text" id="cue-question-text"></p>
        <div class="cue-question-input-wrap">
          <input type="text" class="cue-question-input" id="cue-question-input" placeholder="Your answer…" />
          <button class="cue-question-submit" id="cue-question-submit">→</button>
        </div>
        <!-- File upload — only shown on Q2 -->
        <div class="cue-file-upload" id="cue-file-upload" style="display:none">
          <label class="cue-file-label" id="cue-file-label" for="cue-file-input">
            <span class="cue-file-icon">📎</span>
            <span id="cue-file-name">Attach resume, CV, or bio</span>
          </label>
          <input type="file" id="cue-file-input" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" style="display:none" />
          <button class="cue-file-clear" id="cue-file-clear" style="display:none">✕</button>
        </div>
        <button class="cue-skip-btn" id="cue-skip-btn" style="display:none">Skip — generate with what I've given</button>
      </div>

      <!-- Suggestion mode -->
      <div class="cue-suggestion-mode" id="cue-suggestion-mode" style="display:none">
        <div class="cue-scores" id="cue-scores" style="display:none">
          <div class="cue-score-item">
            <span class="cue-score-label">Before</span>
            <div class="cue-score-bar-wrap"><div class="cue-score-bar cue-score-before" id="cue-score-before-bar"></div></div>
            <span class="pc-score-num" id="cue-score-before-num">—</span>
          </div>
          <div class="cue-score-item">
            <span class="cue-score-label">After</span>
            <div class="cue-score-bar-wrap"><div class="cue-score-bar cue-score-after" id="cue-score-after-bar"></div></div>
            <span class="pc-score-num" id="cue-score-after-num">—</span>
          </div>
        </div>
        <div class="cue-body" id="cue-body-text"></div>
        <div class="cue-actions">
          <button class="cue-btn cue-btn-accept" id="pc-accept-btn">Apply suggestion</button>
          <button class="cue-btn cue-btn-save" id="pc-save-btn">Save</button>
          <button class="cue-btn cue-btn-dismiss" id="pc-dismiss-btn">Dismiss</button>
        </div>
      </div>
    `;
    document.body.appendChild(card);

    // File upload handling
    const fileInput = document.getElementById("cue-file-input");
    const fileLabel = document.getElementById("cue-file-label");
    const fileName = document.getElementById("cue-file-name");
    const fileClear = document.getElementById("cue-file-clear");

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      fileName.textContent = `Processing ${file.name}…`;
      fileLabel.style.opacity = "0.6";

      try {
        const base64 = await fileToBase64(file);
        chrome.runtime.sendMessage(
          { type: "EXTRACT_FILE", fileData: base64, fileType: file.type, fileName: file.name },
          (response) => {
            if (response?.extracted) {
              fileName.textContent = `✓ ${file.name}`;
              fileLabel.style.opacity = "1";
              fileClear.style.display = "flex";
              // Store extracted content to be used as answer
              fileInput.dataset.extractedContent = response.extracted;
            } else {
              fileName.textContent = "Failed to read file — try again";
              fileLabel.style.opacity = "1";
            }
          }
        );
      } catch (err) {
        fileName.textContent = "Error reading file";
        fileLabel.style.opacity = "1";
      }
    });

    fileClear.addEventListener("click", () => {
      fileInput.value = "";
      fileInput.dataset.extractedContent = "";
      fileName.textContent = "Attach resume, CV, or bio";
      fileClear.style.display = "none";
    });

    // Question submit
    document.getElementById("cue-question-submit").addEventListener("click", () => submitAnswer(false));
    document.getElementById("cue-question-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAnswer(false);
    });
    document.getElementById("cue-skip-btn").addEventListener("click", () => submitAnswer(true));

    // Suggestion actions
    document.getElementById("pc-accept-btn").addEventListener("click", () => {
      if (activeTextarea && currentSuggestion) {
        applyToTextarea(activeTextarea, currentSuggestion);
        hideCard();
        removeDotTrigger();
        cardDismissed = true;
        lastAnalyzedText = currentSuggestion;
        contextHistory = [];
        questionRound = 0;
      }
    });

    document.getElementById("pc-save-btn").addEventListener("click", () => {
      saveToHistory();
      const btn = document.getElementById("pc-save-btn");
      btn.textContent = "Saved ✓";
      btn.disabled = true;
      setTimeout(() => { btn.textContent = "Save"; btn.disabled = false; }, 2000);
    });

    document.getElementById("pc-dismiss-btn").addEventListener("click", () => {
      hideCard();
      cardDismissed = true;
      contextHistory = [];
      questionRound = 0;
    });

    document.addEventListener("mousedown", (e) => {
      if (!card.contains(e.target) && e.target !== dotTrigger) hideCard();
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function submitAnswer(skip) {
    const input = document.getElementById("cue-question-input");
    const fileInput = document.getElementById("cue-file-input");
    const extractedContent = fileInput.dataset.extractedContent;

    let answer;
    if (skip) {
      answer = "skip";
    } else if (extractedContent) {
      // Use file content as the answer, optionally combined with typed text
      const typed = input.value.trim();
      answer = typed
        ? `${typed}\n\nExtracted from uploaded file:\n${extractedContent}`
        : `Extracted from uploaded file:\n${extractedContent}`;
    } else {
      answer = input.value.trim();
      if (!answer) return;
    }

    // Save Q&A
    contextHistory.push({ question: currentQuestion, answer });
    questionRound++;

    // Reset file input
    fileInput.value = "";
    fileInput.dataset.extractedContent = "";
    document.getElementById("cue-file-name").textContent = "Attach resume, CV, or bio";
    document.getElementById("cue-file-clear").style.display = "none";

    // Show loading
    input.disabled = true;
    input.value = "";
    document.getElementById("cue-question-submit").disabled = true;
    document.getElementById("cue-question-submit").textContent = "…";
    document.getElementById("cue-skip-btn").style.display = "none";
    document.getElementById("cue-file-upload").style.display = "none";

    // Hard cap at 2 questions
    if (questionRound >= 2) {
      isLoading = true;
      chrome.runtime.sendMessage(
        { type: "ANALYZE_PROMPT", prompt: currentOriginalText, contextHistory, questionRound: 99 },
        (response) => {
          isLoading = false;
          if (!response?.suggestion) { hideCard(); return; }
          currentResponseType = "suggestion";
          currentSuggestion = response.suggestion;
          currentReason = response.reason;
          currentOriginalScore = response.originalScore;
          currentImprovedScore = response.improvedScore;
          renderCard();
        }
      );
      return;
    }

    isLoading = true;
    chrome.runtime.sendMessage(
      { type: "ANALYZE_PROMPT", prompt: currentOriginalText, contextHistory, questionRound },
      (response) => {
        isLoading = false;
        if (chrome.runtime.lastError || !response) { hideCard(); return; }

        currentResponseType = response.type || "null";
        currentQuestion = response.question || null;
        currentQuestionNumber = response.questionNumber || null;
        currentAllowFile = response.allowFile || false;
        currentSuggestion = response.suggestion || null;
        currentReason = response.reason || null;
        currentOriginalScore = response.originalScore || null;
        currentImprovedScore = response.improvedScore || null;

        renderCard();
      }
    );
  }

  function showCard(el) {
    if (!currentResponseType || currentResponseType === "null") return;
    renderCard();
    positionCard(el);
    card.classList.add("visible");
  }

  function renderCard() {
    const questionMode = document.getElementById("cue-question-mode");
    const suggestionMode = document.getElementById("cue-suggestion-mode");
    const headerRight = document.getElementById("cue-header-right");

    if (currentResponseType === "question" && currentQuestion) {
      questionMode.style.display = "block";
      suggestionMode.style.display = "none";

      document.getElementById("cue-progress").textContent =
        `Question ${currentQuestionNumber || questionRound + 1} of 2`;
      document.getElementById("cue-question-text").textContent = currentQuestion;

      const qInput = document.getElementById("cue-question-input");
      qInput.value = "";
      qInput.disabled = false;
      qInput.placeholder = currentAllowFile ? "Type your answer, or attach a file below…" : "Your answer…";

      document.getElementById("cue-question-submit").disabled = false;
      document.getElementById("cue-question-submit").textContent = "→";

      // Show file upload only on Q2
      const fileUpload = document.getElementById("cue-file-upload");
      fileUpload.style.display = currentAllowFile ? "flex" : "none";

      // Show skip after Q1
      const skipBtn = document.getElementById("cue-skip-btn");
      skipBtn.style.display = questionRound >= 1 ? "block" : "none";

      headerRight.textContent = "Building your prompt";

    } else if (currentResponseType === "suggestion" && currentSuggestion) {
      questionMode.style.display = "none";
      suggestionMode.style.display = "block";

      document.getElementById("cue-body-text").textContent = currentSuggestion;
      headerRight.textContent = currentReason || "";

      const scoresEl = document.getElementById("cue-scores");
      if (currentOriginalScore && currentImprovedScore) {
        scoresEl.style.display = "flex";
        document.getElementById("cue-score-before-num").textContent = currentOriginalScore;
        document.getElementById("cue-score-after-num").textContent = currentImprovedScore;
        setTimeout(() => {
          document.getElementById("cue-score-before-bar").style.width = currentOriginalScore + "%";
          document.getElementById("cue-score-after-bar").style.width = currentImprovedScore + "%";
        }, 50);
      } else {
        scoresEl.style.display = "none";
      }
    }

    card.classList.add("visible");
  }

  function hideCard() { if (card) card.classList.remove("visible"); }
  function toggleCard(el) {
    if (card.classList.contains("visible")) hideCard();
    else showCard(el);
  }

  function positionCard(el) {
    // Position relative to the textarea, not the dot
    const ref = activeTextarea || el;
    if (!ref) return;
    const rect = ref.getBoundingClientRect();
    const cardWidth = 420;
    const cardHeight = 300;

    // Try above first, fall back to below
    let top = rect.top - cardHeight - 12;
    if (top < 10) top = rect.bottom + 12;

    // Align to right edge of textarea
    let left = rect.right - cardWidth;
    if (left < 10) left = 10;
    if (left + cardWidth > window.innerWidth - 10) left = window.innerWidth - cardWidth - 10;

    card.style.top = `${top + window.scrollY}px`;
    card.style.left = `${left}px`;
  }

  function showNoKeyCard(el) {
    currentResponseType = "suggestion";
    currentSuggestion = "Please add your Anthropic API key in the Prompt Coach popup to enable suggestions.";
    currentReason = "Setup required";
    currentOriginalScore = null;
    currentImprovedScore = null;
    showDotTrigger(el, false);
  }


  function applyToTextarea(el, text) {
    if (el.tagName === "TEXTAREA") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (el.isContentEditable) {
      el.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }
})();
