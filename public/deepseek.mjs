// public/deepseek.mjs — browser-side DeepSeek client.
//
// Mirrors the AI behaviour of server.mjs so the static deployment works
// without a Node.js backend. The user's API key, base URL, and model are
// stored in localStorage and never leave the browser except as a Bearer
// token in requests to api.deepseek.com (or whatever DeepSeek-compatible
// endpoint is configured).
//
// Each "run*" function returns a normalised result shaped the same way the
// matching server endpoint would return it. Callers should treat errors as
// a flat `{ error: "..." }` object (mimicking the server's 5xx responses)
// so the existing UI toasts continue to work.

import { roundHalfBand, averageBand } from "./core.mjs";

export const CONFIG_STORAGE_KEY = "bandcraft:deepseek-config:v1";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_MODEL = "deepseek-chat";

export const DAILY_RUBRIC_SOURCE = "Daily IELTS Mini Practice Rubric v0.2";
export const FORMAL_RUBRIC_SOURCE = "IELTS public Writing band descriptors + 雅思正式写作评分系统.md v0.1";
export const RUBRIC_RETRIEVED_DATE = "2026-09-17";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function getStoredConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return { apiKey: "", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL };
    const parsed = JSON.parse(raw);
    const apiKey = String(parsed?.apiKey || "").trim();
    const baseUrl = String(parsed?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "") || DEFAULT_BASE_URL;
    const model = String(parsed?.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    return { apiKey, baseUrl, model };
  } catch {
    return { apiKey: "", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL };
  }
}

export function saveStoredConfig(partial) {
  const current = getStoredConfig();
  const next = {
    apiKey: String(partial?.apiKey ?? current.apiKey).trim(),
    baseUrl: String(partial?.baseUrl ?? current.baseUrl).trim().replace(/\/+$/, "") || DEFAULT_BASE_URL,
    model: String(partial?.model ?? current.model).trim() || DEFAULT_MODEL,
  };
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearStoredConfig() {
  localStorage.removeItem(CONFIG_STORAGE_KEY);
}

export function isConfigured(config = getStoredConfig()) {
  return Boolean(config?.apiKey);
}

// ---------------------------------------------------------------------------
// One-click activation
// ---------------------------------------------------------------------------
// The deployed site is a public static bundle, so the API key is deliberately
// NOT baked into the shipped JavaScript. Instead the key travels in the URL
// fragment (a fragment is never sent to the server), gets moved into
// localStorage on first load, and is then scrubbed from the address bar.
//
// Format: https://<host>/#bc_key=sk-...&bc_model=deepseek-chat&bc_base=https://api.deepseek.com
// The query string form (?bc_key=...) is accepted too, for convenience.

export const ACTIVATION_PARAM_KEY = "bc_key";
export const ACTIVATION_PARAM_BASE = "bc_base";
export const ACTIVATION_PARAM_MODEL = "bc_model";
export const ACTIVATION_PARAMS = [ACTIVATION_PARAM_KEY, ACTIVATION_PARAM_BASE, ACTIVATION_PARAM_MODEL];

function decodeChunk(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readActivationParams() {
  const sources = [
    String(location.hash || "").replace(/^#/, ""),
    String(location.search || "").replace(/^\?/, ""),
  ];
  const found = {};
  for (const source of sources) {
    if (!source) continue;
    for (const chunk of source.split("&")) {
      if (!chunk) continue;
      const index = chunk.indexOf("=");
      if (index <= 0) continue;
      const name = decodeChunk(chunk.slice(0, index)).trim();
      if (!ACTIVATION_PARAMS.includes(name)) continue;
      found[name] = decodeChunk(chunk.slice(index + 1)).trim();
    }
  }
  return found;
}

export function stripActivationParams() {
  if (typeof history === "undefined" || typeof location === "undefined") return;
  const url = new URL(location.href);
  let changed = false;
  for (const name of ACTIVATION_PARAMS) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (url.hash) {
    const kept = url.hash
      .replace(/^#/, "")
      .split("&")
      .filter((chunk) => !ACTIVATION_PARAMS.includes(decodeChunk(chunk.split("=")[0] || "").trim()))
      .join("&");
    const nextHash = kept ? `#${kept}` : "";
    if (nextHash !== url.hash) {
      url.hash = nextHash;
      changed = true;
    }
  }
  if (changed) history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function applyConfigFromUrl() {
  const params = readActivationParams();
  const apiKey = String(params[ACTIVATION_PARAM_KEY] || "").trim();
  if (!apiKey) return null;
  const previous = getStoredConfig();
  const next = saveStoredConfig({
    apiKey,
    baseUrl: params[ACTIVATION_PARAM_BASE] || previous.baseUrl,
    model: params[ACTIVATION_PARAM_MODEL] || previous.model,
  });
  stripActivationParams();
  return {
    ...next,
    changed: next.apiKey !== previous.apiKey || next.baseUrl !== previous.baseUrl || next.model !== previous.model,
  };
}

export function buildActivationUrl(options = {}) {
  const config = { ...getStoredConfig(), ...options };
  if (!config.apiKey) return "";
  const query = [
    `${ACTIVATION_PARAM_KEY}=${encodeURIComponent(config.apiKey)}`,
    `${ACTIVATION_PARAM_MODEL}=${encodeURIComponent(config.model)}`,
    `${ACTIVATION_PARAM_BASE}=${encodeURIComponent(config.baseUrl)}`,
  ].join("&");
  const url = new URL(location.href);
  url.search = "";
  url.hash = query;
  return url.toString();
}

export function maskApiKey(apiKey = "") {
  const value = String(apiKey || "");
  if (!value) return "";
  if (value.length <= 10) return "****";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Low-level DeepSeek call
// ---------------------------------------------------------------------------

async function callDeepSeek(messages, config = getStoredConfig()) {
  if (!config?.apiKey) {
    const error = new Error("DeepSeek 未配置，请先在“设置 → AI 服务”中填写 DeepSeek API Key。");
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
      stream: false,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `DeepSeek request failed with ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型没有返回内容。");
  return content;
}

function parseJsonContent(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    const error = new Error("模型返回的内容不是有效 JSON。");
    error.code = "BAD_JSON";
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampScore(value) {
  return clamp(Number(value) || 0, 0, 2);
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function formatBandRange(low, high, estimate) {
  if (low === high) return `${Number(estimate).toFixed(1)}`;
  return `${roundHalfBand(low).toFixed(1)}-${roundHalfBand(high).toFixed(1)}`;
}

function normalizeCorpusItemForPrompt(item = {}) {
  return {
    chineseIntent: String(item.chineseIntent || ""),
    targetExpression: String(item.targetExpression || ""),
    standardExpression: String(item.standardExpression || ""),
    abstractFramework: String(item.abstractFramework || ""),
    currentStage: String(item.stage || "new"),
    topicTags: asStringArray(item.topicTags),
    controlledAttempt: String(item.controlledAttempt || ""),
    reusedAttempt: String(item.reusedAttempt || ""),
  };
}

function cleanChineseCorpusPrompt(value = "") {
  let text = String(value || "")
    .trim()
    .replace(/^请(?:翻译|用中文表达|写出中文意思|换一个语境)[:：]?\s*/i, "")
    .replace(/^中文[:：]\s*/i, "")
    .replace(/^["“]|["”]$/g, "")
    .trim();
  if (!text || /[A-Za-z]/.test(text)) return "";
  if (!/[\u3400-\u9fff]/.test(text)) return "";
  return text;
}

// ---------------------------------------------------------------------------
// Prompt builders (kept byte-identical to server.mjs)
// ---------------------------------------------------------------------------

function matchPrompt() {
  return [
    "You choose one IELTS writing prompt for daily language practice.",
    "Prefer natural topic, function, register, and collocation compatibility.",
    "Do not force unrelated material into a prompt.",
    "For Task 1, only choose Task 1 when the material can describe data, processes, maps, comparisons, or trends.",
    "Return JSON only with this shape:",
    '{"promptId":"","reason":"","confidence":0.0,"unmatchedMaterialIds":[]}',
  ].join("\n");
}

function dailyEvaluatorPrompt() {
  return [
    "You are a Daily IELTS Mini Practice coach.",
    "The learner target is 80-150 words. Never treat the 250-word Task 2 requirement as a deficiency for this mode.",
    "Use IELTS abilities for diagnosis, but do not assign or estimate an IELTS band.",
    "Use this 10-point Daily Practice Rubric. Each criterion is scored 0-2:",
    "Task Coverage: whether the response answers all parts of the task, including both views and a personal position when required.",
    "Idea Clarity: whether the main ideas are relevant, specific, and easy to understand.",
    "Organization: whether sentences and ideas progress with clear logical relationships.",
    "Word Choice: whether vocabulary is accurate, collocationally natural, and appropriate to the context.",
    "Sentence Control: subject-predicate completeness, agreement, sentence boundaries, verb forms, articles, plurals, and common spelling.",
    "Use 2 for completed and natural, 1 for partial or needing correction, and 0 for missing, incomprehensible, or clearly misused.",
    "Check target vocabulary and patterns separately in targetUsage. They are today's learning targets, not rubric criteria.",
    "Do not reward forced or unnatural target usage and do not directly convert it into a rubric score.",
    "Usage Tracker does not directly increase or reduce an IELTS band.",
    "Start with one concise diagnostic sentence of no more than 28 words.",
    "Compress the learner's core ideas into short 4-6 word phrases.",
    "Identify sentence-level issues with the original sentence, issue type, explanation, and a minimal correction.",
    "Choose no more than three top errors. For each error, provide the original sentence, a basic natural rewrite that any educated native speaker would understand, an advanced Band 7 IELTS rewrite, one reusable basic pattern, one reusable advanced pattern, and a clear usage condition.",
    "Prefer frequent native-speaker sentence frames and natural collocations over rare idioms or decorative advanced vocabulary.",
    "Provide an 80-150 word minimal rewrite that preserves the learner's meaning and only repairs language and logic.",
    "Do not provide a complete expanded 220-280 word IELTS rewrite in this response. That belongs to the optional learning extension.",
    "Give only one priority fix and one concrete retry task with specified sentences, structures, and a 35-50 word final response.",
    "Preserve the learner's original idea.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "simple",
      dailyPracticeScore: 0,
      rubric: {
        taskCoverage: 0,
        ideaClarity: 0,
        organization: 0,
        wordChoice: 0,
        sentenceControl: 0,
      },
      oneSentenceDiagnosis: "",
      taskCoverage: {
        bothViews: { status: "complete|partial|missing", comment: "" },
        position: { status: "complete|partial|missing", comment: "" },
        concreteReasons: { status: "complete|partial|missing", comment: "" },
        explanationOrExample: { status: "complete|partial|missing", comment: "" },
      },
      coreIdeas: ["4-6 word idea"],
      targetUsage: {
        vocabulary: [{
          materialId: "",
          label: "",
          status: "not_used|accurate|grammar_issue|semantic_issue|mechanical",
          excerpt: "",
          explanation: "",
          suggestedRevision: "",
        }],
        patterns: [{
          materialId: "",
          label: "",
          status: "not_used|accurate|grammar_issue|semantic_issue|mechanical",
          excerpt: "",
          explanation: "",
          suggestedRevision: "",
        }],
        usageRate: 0,
        accuracyRate: 0,
        naturalness: 0,
      },
      sentenceIssues: [{
        sentenceNumber: 1,
        original: "",
        issueType: "spelling|agreement|word_form|fragment|collocation|clarity",
        explanation: "",
        minimalFix: "",
      }],
      topErrors: [{
        original: "",
        problem: "",
        requiredPattern: "",
        minimalFix: "",
      }],
      teachingFixes: [{
        original: "",
        problem: "",
        basicRewrite: "",
        advancedRewrite: "",
        basicPattern: "",
        advancedPattern: "",
        usageCondition: "",
      }],
      minimalRewrite: "",
      didCorrectly: [],
      priorityFix: "",
      retryTask: {
        instructions: "",
        sentences: [{ original: "", requiredPattern: "" }],
        prompt: "",
        wordRange: "35-50",
        requiredPatterns: [],
      },
      tomorrowReuseContext: "",
      rubricVersion: "daily-v0.2",
    }),
  ].join("\n");
}

function formalEvaluatorPrompt() {
  return [
    "You are an IELTS writing evaluator.",
    "Use the public IELTS Writing band descriptors as the source of truth:",
    "https://www.ielts.org/take-a-test/your-results/ielts-scoring-in-detail",
    "For Task 1, use Task Achievement. For Task 2, use Task Response.",
    "Use Coherence and Cohesion, Lexical Resource, and Grammatical Range and Accuracy for both.",
    "Never present the result as an official score.",
    "Every score must cite specific evidence from the learner's text.",
    "Evaluate the four criteria independently and give each equal weight.",
    "For Task 1, check overview, selection and comparison of main features, data support, omissions, and unnecessary explanations.",
    "For Task 2, check all parts of the question, a clear and consistent position, developed claims, counterviews where needed, and conclusion consistency.",
    "For cohesion, check paragraph logic, real logical connectors, pronoun reference, and mechanical linking-word stacking.",
    "For lexical resource, check topic precision, collocation, repetition, word form, countability, spelling, and forced advanced language.",
    "For grammar, check subject-verb agreement, sentence boundaries, verb forms, articles, plurals, clauses, comparisons, and conditionals.",
    "Give only one priority fix.",
    "Do not reward target vocabulary if it is inaccurate or unnatural.",
    "Preserve meaning and voice. Show a minimal rewrite, not a complete expanded ghostwritten replacement.",
    "A complete expanded IELTS rewrite must only be generated by the separate optional learning extension.",
    "Do not invent evidence, task requirements, or word counts.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "formal",
      taskType: "task1_or_task2",
      wordCount: 0,
      estimatedBand: 6,
      estimatedBandRange: "5.5-6.0",
      criteria: {
        task: { name: "Task Response", estimatedBand: 6, evidence: [], limitation: "" },
        coherence: { name: "Coherence and Cohesion", estimatedBand: 6, evidence: [], limitation: "" },
        lexical: { name: "Lexical Resource", estimatedBand: 6, evidence: [], limitation: "" },
        grammar: { name: "Grammatical Range and Accuracy", estimatedBand: 6, evidence: [], limitation: "" },
      },
      targetUsage: {
        vocabulary: [{
          materialId: "",
          label: "",
          status: "not_used|accurate|grammar_issue|semantic_issue|mechanical",
          excerpt: "",
          explanation: "",
          suggestedRevision: "",
        }],
        patterns: [{
          materialId: "",
          label: "",
          status: "not_used|accurate|grammar_issue|semantic_issue|mechanical",
          excerpt: "",
          explanation: "",
          suggestedRevision: "",
        }],
        usageRate: 0,
        accuracyRate: 0,
        naturalness: 0,
      },
      priorityFix: "",
      minimalRewrite: "",
      nextRevisionTask: "",
      rubricVersion: "ielts-v0.1",
    }),
  ].join("\n");
}

function revisionCheckPrompt() {
  return [
    "You are a supportive but precise IELTS writing coach.",
    "The learner is revising their own original response and must keep improving the same draft until the basic version is correct.",
    "Basic success means clear, grammatical, natural English that an educated native speaker can understand. It does not require an entire Band 7 essay.",
    "Advanced success is Band 7-level IELTS writing, but do not demand advanced vocabulary when a simple natural phrase is better.",
    "Check whether the learner has applied the target sentence corrections.",
    "Check whether the position is clear.",
    "Check whether there is at least one reason and one result, consequence, or example.",
    "Check whether the revised sentences are complete, natural, and easy to understand.",
    "Do not rewrite the whole response and do not expand it into a full Task 2 essay.",
    "If the draft is not yet correct, provide a minimal corrected version that preserves the learner's meaning.",
    "If it is correct, praise the specific language improvement and suggest one optional advanced upgrade.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "revision-feedback",
      isCorrect: false,
      coachSummary: "",
      checks: [{
        id: "position|reason_or_result|sentence_naturalness|target_corrections",
        label: "",
        status: "complete|partial|missing",
        comment: "",
      }],
      remainingIssues: [{
        original: "",
        problem: "",
        basicRewrite: "",
        advancedRewrite: "",
        basicPattern: "",
        advancedPattern: "",
        usageCondition: "",
      }],
      nextMinimalRewrite: "",
      optionalAdvancedUpgrade: "",
      modelVersion: "",
    }),
  ].join("\n");
}

function corpusEvaluatePrompt() {
  return [
    "You are an IELTS vocabulary and collocation coach.",
    "The learner provides a Chinese meaning, an optional target English expression, and a first English attempt.",
    "Evaluate whether the first attempt expresses the Chinese meaning clearly and whether it sounds natural.",
    "Do not merely patch the learner's grammar. For every needed correction, provide original, corrected, and a short reason.",
    "Write one natural IELTS-level standard expression that preserves the intended meaning as the naturalVersion.",
    "Never add a new idea, reason, example, or opinion that the Chinese meaning does not contain.",
    "Prefer frequent, useful native-speaker sentence frames and collocations over rare or decorative language.",
    "The standard expression must be one sentence unless the Chinese meaning clearly contains multiple independent sentences.",
    "Extract an abstract reusable framework from the standard expression, using placeholders such as A, B, C, noun, verb, or adjective.",
    "Extract 2-4 useful basic chunks or collocations from the standard expression.",
    "Explain the usage condition for the framework.",
    "Create one controlled practice instruction that asks the learner to use the confirmed framework.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "corpus-evaluation",
      meaningMatch: { status: "complete|partial|missing", comment: "" },
      naturalness: { status: "complete|partial|missing", comment: "" },
      targetUsage: { status: "accurate|grammar_issue|semantic_issue|not_used", comment: "" },
      errors: [{ original: "", corrected: "", reason: "" }],
      naturalVersion: "",
      standardExpression: "",
      standardExpressionBackTranslation: "",
      baseChunks: ["", ""],
      abstractFramework: "",
      frameworkExplanation: "",
      frameworkUsageCondition: "",
      controlledPrompt: "",
      modelVersion: "",
    }),
  ].join("\n");
}

function corpusCheckPrompt(phase) {
  const phaseRule = phase === "reused"
    ? "This is the Reused test. The learner sees a new Chinese context. If frameworkRevealed is true, the answer may be correct but it cannot upgrade the stage."
    : "This is the Controlled test. The confirmed framework is visible and the learner should produce a new controlled answer.";
  return [
    "You are checking one corpus expression practice attempt.",
    phaseRule,
    "Check meaning match, grammar, natural collocation, and correct use of the target expression or abstract framework.",
    "A controlled answer passes when it is correct under the visible framework.",
    "A reused answer can upgrade only when it is correct AND frameworkRevealed is false.",
    "Failure never downgrades a stage.",
    "Give concise teacher feedback and one suggested revision without rewriting the whole learner response.",
    "When the next stage needs a test, create one natural Chinese sentence that the learner can translate using the confirmed framework.",
    "nextChinesePrompt must contain Chinese only. It must be a complete translatable sentence, not an instruction, not a label, and must not mention the abstract framework or target English expression.",
    "The Chinese sentence must naturally fit the confirmed framework without adding unrelated advanced ideas.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "corpus-check",
      passed: false,
      canUpgrade: false,
      feedback: "",
      grammarNaturalness: { status: "complete|partial|missing", comment: "" },
      targetUsage: { status: "accurate|grammar_issue|semantic_issue|not_used", comment: "" },
      remainingIssues: [{ original: "", problem: "", suggestedRevision: "" }],
      suggestedRevision: "",
      nextChinesePrompt: "",
      modelVersion: "",
    }),
  ].join("\n");
}

function corpusRandomPromptPrompt() {
  return [
    "You generate one random Chinese translation prompt for a corpus expression exercise.",
    "The Chinese sentence must be a natural, complete sentence that can be translated naturally with the confirmed abstract framework.",
    "Keep the topic related to the learner's original meaning or an adjacent everyday context.",
    "Do not mention the framework, the English target expression, or any instruction such as 'please use'.",
    "Output Chinese only. No English letters, no quotation marks, no labels, no explanation.",
    "Avoid returning the learner's original Chinese sentence when previousPrompt is provided.",
    "Return JSON only with this shape:",
    JSON.stringify({
      chinesePrompt: "",
      modelVersion: "",
    }),
  ].join("\n");
}

function corpusRetrievalPrompt() {
  return [
    "You are checking a retrieval-practice answer for a personal corpus card.",
    "The goal is to strengthen recall, not to trick the learner.",
    "Question types may be translation, framework fill, framework sentence, or meaning recall.",
    "For translation and framework sentence, check meaning, grammar, natural collocation, and correct use of the confirmed framework.",
    "For framework fill, check that the completed framework is structurally correct.",
    "For meaning recall, check whether the learner's Chinese answer captures the meaning of the standard English expression without requiring word-for-word translation.",
    "Assign naturalness 0-10 when English output exists; for Chinese meaning recall, use 10 when the meaning is accurate.",
    "Give concise feedback and one suggested revision if needed.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "corpus-retrieval",
      passed: false,
      feedback: "",
      suggestedRevision: "",
      naturalness: {
        score: 0,
        level: "",
        comment: "",
      },
      modelVersion: "",
    }),
  ].join("\n");
}

function corpusUsagePrompt() {
  return [
    "You verify whether a learner naturally used a target English expression in a real piece of output.",
    "The text may come from an email, chat, speaking note, writing, or another real context.",
    "Do not require formal IELTS style. Natural spoken or written English is acceptable.",
    "Check that the target expression or framework appears with correct meaning, grammar, and collocation.",
    "qualifiesAsRealUse is true only when naturalUse is true.",
    "Give concise feedback and one suggested revision if needed.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "corpus-usage-check",
      naturalUse: false,
      feedback: "",
      suggestedRevision: "",
      qualifiesAsRealUse: false,
      modelVersion: "",
    }),
  ].join("\n");
}

function learningExtensionPrompt() {
  return [
    "You create an optional learning extension after an IELTS writing evaluation.",
    "The learner has already received the base feedback and has explicitly requested deeper study.",
    "This is not another score. Do not assign or change an IELTS band.",
    "Create a complete improved IELTS-style version that answers the original prompt.",
    "For Task 2, target 220-280 words. For Task 1, target 170-220 words.",
    "Preserve the learner's core meaning, but develop incomplete ideas so the full version demonstrates a complete response.",
    "The full version is optional study material, not a replacement answer for the daily 80-150 word practice.",
    "Extract exactly these five writing functions: introduction, both_views, reason_development, position, conclusion.",
    "For Task 1, adapt both_views to the equivalent function of selecting and comparing main features, but keep the id both_views.",
    "For each function, quote a real excerpt from the improved version, extract a reusable pattern with placeholders, explain why it works, and add one usage note.",
    "Create a 35-50 word transfer task that makes the learner use at least three extracted structures.",
    "Do not invent evidence or claim the extension is official material.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "daily-learning-extension",
      wordCount: 0,
      improvedVersion: "",
      disclaimer: "完整 IELTS 改写示范，仅用于拓展学习，不是每日练习评分标准。",
      functions: [{
        id: "introduction",
        title: "怎样写引言",
        excerpt: "",
        universalPattern: "",
        explanation: "",
        usageNote: "",
      }, {
        id: "both_views",
        title: "怎样讨论双方观点",
        excerpt: "",
        universalPattern: "",
        explanation: "",
        usageNote: "",
      }, {
        id: "reason_development",
        title: "怎样发展一个理由",
        excerpt: "",
        universalPattern: "",
        explanation: "",
        usageNote: "",
      }, {
        id: "position",
        title: "怎样清晰表达自己的立场",
        excerpt: "",
        universalPattern: "",
        explanation: "",
        usageNote: "",
      }, {
        id: "conclusion",
        title: "怎样写结论",
        excerpt: "",
        universalPattern: "",
        explanation: "",
        usageNote: "",
      }],
      transferTask: {
        prompt: "",
        wordRange: "35-50",
        requiredPatterns: [],
        checklist: [],
      },
      rubricVersion: "learning-v0.1",
    }),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeTeachingFixes(items = [], legacyItems = []) {
  const source = Array.isArray(items) && items.length ? items : legacyItems;
  if (!Array.isArray(source)) return [];
  return source.slice(0, 3).map((item) => ({
    original: String(item.original || ""),
    problem: String(item.problem || ""),
    basicRewrite: String(item.basicRewrite || item.minimalFix || ""),
    advancedRewrite: String(item.advancedRewrite || item.minimalFix || ""),
    basicPattern: String(item.basicPattern || item.requiredPattern || ""),
    advancedPattern: String(item.advancedPattern || item.requiredPattern || ""),
    usageCondition: String(item.usageCondition || ""),
  })).filter((item) => item.original || item.problem);
}

function normalizeTopErrors(items = []) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 3).map((item) => ({
    original: String(item.original || ""),
    problem: String(item.problem || ""),
    requiredPattern: String(item.requiredPattern || ""),
    minimalFix: String(item.minimalFix || ""),
  })).filter((item) => item.original || item.problem || item.requiredPattern);
}

function normalizeSentenceIssues(items = []) {
  if (!Array.isArray(items)) return [];
  const issueTypes = new Set([
    "spelling",
    "agreement",
    "word_form",
    "fragment",
    "collocation",
    "clarity",
  ]);
  return items.map((item, index) => ({
    sentenceNumber: Math.max(1, Number(item.sentenceNumber) || index + 1),
    original: String(item.original || ""),
    issueType: issueTypes.has(item.issueType) ? item.issueType : "clarity",
    explanation: String(item.explanation || ""),
    minimalFix: String(item.minimalFix || ""),
  })).filter((item) => item.original || item.explanation);
}

function normalizeRetryTask(task = {}) {
  const sentences = Array.isArray(task.sentences)
    ? task.sentences.map((item) => ({
      original: String(item.original || ""),
      requiredPattern: String(item.requiredPattern || ""),
    })).filter((item) => item.original || item.requiredPattern)
    : [];
  return {
    instructions: String(task.instructions || ""),
    sentences,
    prompt: String(task.prompt || ""),
    wordRange: String(task.wordRange || "35-50"),
    requiredPatterns: asStringArray(task.requiredPatterns),
  };
}

function normalizeTaskCoverage(coverage = {}) {
  const normalizeCheck = (value) => {
    const status = ["complete", "partial", "missing"].includes(value?.status)
      ? value.status
      : "missing";
    return {
      status,
      comment: String(value?.comment || ""),
    };
  };

  return {
    bothViews: normalizeCheck(coverage.bothViews),
    position: normalizeCheck(coverage.position),
    concreteReasons: normalizeCheck(coverage.concreteReasons),
    explanationOrExample: normalizeCheck(coverage.explanationOrExample),
  };
}

function normalizeTargetUsage(targetUsage = {}) {
  const compactUsage = (items = []) => items.map((item) => ({
    materialId: String(item.materialId || ""),
    label: String(item.label || ""),
    status: [
      "not_used",
      "accurate",
      "grammar_issue",
      "semantic_issue",
      "mechanical",
    ].includes(item.status) ? item.status : "not_used",
    excerpt: String(item.excerpt || ""),
    explanation: String(item.explanation || ""),
    suggestedRevision: String(item.suggestedRevision || ""),
  }));

  return {
    vocabulary: compactUsage(targetUsage?.vocabulary),
    patterns: compactUsage(targetUsage?.patterns),
    usageRate: clamp(Number(targetUsage?.usageRate) || 0, 0, 1),
    accuracyRate: clamp(Number(targetUsage?.accuracyRate) || 0, 0, 1),
    naturalness: clamp(Number(targetUsage?.naturalness) || 0, 0, 1),
  };
}

function normalizeSimpleEvaluation(input = {}, modelVersion = "") {
  const rubric = input.rubric || {};
  const safeRubric = {
    taskCoverage: clampScore(rubric.taskCoverage),
    ideaClarity: clampScore(rubric.ideaClarity),
    organization: clampScore(rubric.organization),
    wordChoice: clampScore(rubric.wordChoice),
    sentenceControl: clampScore(rubric.sentenceControl),
  };
  const computedScore = Object.values(safeRubric).reduce((sum, value) => sum + value, 0);
  const minimalRewrite = String(input.minimalRewrite || input.rewritePrompt || "");
  const retryTask = normalizeRetryTask(input.retryTask);

  return {
    type: "simple",
    dailyPracticeScore: Number.isFinite(Number(input.dailyPracticeScore))
      ? clamp(Number(input.dailyPracticeScore), 0, 10)
      : computedScore,
    rubric: safeRubric,
    targetUsage: normalizeTargetUsage(input.targetUsage),
    oneSentenceDiagnosis: String(input.oneSentenceDiagnosis || ""),
    taskCoverage: normalizeTaskCoverage(input.taskCoverage),
    coreIdeas: asStringArray(input.coreIdeas).slice(0, 6),
    sentenceIssues: normalizeSentenceIssues(input.sentenceIssues),
    topErrors: normalizeTopErrors(input.topErrors),
    teachingFixes: normalizeTeachingFixes(input.teachingFixes, input.topErrors),
    minimalRewrite,
    didCorrectly: asStringArray(input.didCorrectly),
    priorityFix: String(input.priorityFix || ""),
    rewritePrompt: minimalRewrite,
    retryTask,
    tomorrowReuseContext: String(input.tomorrowReuseContext || ""),
    rubricVersion: "daily-v0.2",
    rubricSource: DAILY_RUBRIC_SOURCE,
    rubricRetrievedDate: RUBRIC_RETRIEVED_DATE,
    modelVersion: String(modelVersion),
  };
}

function normalizeCriterion(criterion = {}, fallbackName) {
  return {
    name: String(criterion.name || fallbackName),
    estimatedBand: roundHalfBand(clamp(Number(criterion.estimatedBand) || 0, 0, 9)),
    evidence: asStringArray(criterion.evidence),
    limitation: String(criterion.limitation || ""),
  };
}

function normalizeFormalEvaluation(input = {}, taskType = "task2", modelVersion = "") {
  const criteria = input.criteria || {};
  const normalizedCriteria = {
    task: normalizeCriterion(criteria.task, taskType === "task1" ? "Task Achievement" : "Task Response"),
    coherence: normalizeCriterion(criteria.coherence, "Coherence and Cohesion"),
    lexical: normalizeCriterion(criteria.lexical, "Lexical Resource"),
    grammar: normalizeCriterion(criteria.grammar, "Grammatical Range and Accuracy"),
  };
  const estimatedBand = roundHalfBand(input.estimatedBand || averageBand(normalizedCriteria));
  const bandValues = Object.values(normalizedCriteria).map((criterion) => criterion.estimatedBand);
  const lowest = Math.min(...bandValues);
  const highest = Math.max(...bandValues);

  return {
    type: "formal",
    taskType: taskType === "task1" ? "task1" : "task2",
    wordCount: Math.max(0, Number(input.wordCount) || 0),
    estimatedBand,
    estimatedBandRange: String(input.estimatedBandRange || formatBandRange(lowest, highest, estimatedBand)),
    criteria: normalizedCriteria,
    targetUsage: normalizeTargetUsage(input.targetUsage),
    priorityFix: String(input.priorityFix || ""),
    minimalRewrite: String(input.minimalRewrite || input.rewriteDemonstration || ""),
    rewriteDemonstration: String(input.minimalRewrite || input.rewriteDemonstration || ""),
    nextRevisionTask: String(input.nextRevisionTask || ""),
    rubricVersion: String(input.rubricVersion || "ielts-v0.1"),
    rubricSource: FORMAL_RUBRIC_SOURCE,
    rubricRetrievedDate: RUBRIC_RETRIEVED_DATE,
    modelVersion: String(modelVersion),
  };
}

function normalizeLearningExtension(input = {}, taskType = "task2", modelVersion = "") {
  const fallbackFunctions = [
    ["introduction", "怎样写引言"],
    ["both_views", "怎样讨论双方观点"],
    ["reason_development", "怎样发展一个理由"],
    ["position", "怎样清晰表达自己的立场"],
    ["conclusion", "怎样写结论"],
  ];
  const sourceFunctions = Array.isArray(input.functions) ? input.functions : [];
  const functions = fallbackFunctions.map(([id, title]) => {
    const item = sourceFunctions.find((candidate) => candidate?.id === id) || {};
    return {
      id,
      title: String(item.title || title),
      excerpt: String(item.excerpt || ""),
      universalPattern: String(item.universalPattern || ""),
      explanation: String(item.explanation || ""),
      usageNote: String(item.usageNote || ""),
    };
  });
  const improvedVersion = String(input.improvedVersion || "").trim();
  const task = input.transferTask || {};

  return {
    type: "daily-learning-extension",
    taskType: taskType === "task1" ? "task1" : "task2",
    wordCount: Math.max(0, Number(input.wordCount) || improvedVersion.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length || 0),
    improvedVersion,
    disclaimer: String(input.disclaimer || "完整 IELTS 改写示范，仅用于拓展学习，不是每日练习评分标准。"),
    functions,
    transferTask: {
      prompt: String(task.prompt || ""),
      wordRange: String(task.wordRange || "35-50"),
      requiredPatterns: asStringArray(task.requiredPatterns),
      checklist: asStringArray(task.checklist),
    },
    rubricVersion: String(input.rubricVersion || "learning-v0.1"),
    modelVersion: String(modelVersion),
    generatedAt: new Date().toISOString(),
  };
}

function normalizeRevisionFeedback(input = {}, modelVersion = "") {
  const checkStatuses = new Set(["complete", "partial", "missing"]);
  const checks = Array.isArray(input.checks)
    ? input.checks.map((item) => ({
      id: String(item.id || ""),
      label: String(item.label || ""),
      status: checkStatuses.has(item.status) ? item.status : "missing",
      comment: String(item.comment || ""),
    })).filter((item) => item.label)
    : [];
  const remainingIssues = normalizeTeachingFixes(input.remainingIssues || []);

  return {
    type: "revision-feedback",
    isCorrect: Boolean(input.isCorrect),
    coachSummary: String(input.coachSummary || ""),
    checks,
    remainingIssues,
    nextMinimalRewrite: String(input.nextMinimalRewrite || ""),
    optionalAdvancedUpgrade: String(input.optionalAdvancedUpgrade || ""),
    modelVersion: String(modelVersion),
    checkedAt: new Date().toISOString(),
  };
}

function normalizeCorpusEvaluation(input = {}, modelVersion = "") {
  const statuses = new Set(["complete", "partial", "missing"]);
  const usageStatuses = new Set(["accurate", "grammar_issue", "semantic_issue", "not_used"]);
  const normalizeAssessment = (value) => ({
    status: statuses.has(value?.status) ? value.status : "missing",
    comment: String(value?.comment || ""),
  });
  return {
    type: "corpus-evaluation",
    meaningMatch: normalizeAssessment(input.meaningMatch),
    naturalness: normalizeAssessment(input.naturalness),
    targetUsage: {
      status: usageStatuses.has(input.targetUsage?.status) ? input.targetUsage.status : "not_used",
      comment: String(input.targetUsage?.comment || ""),
    },
    errors: Array.isArray(input.errors)
      ? input.errors.map((item) => ({
        original: String(item.original || ""),
        corrected: String(item.corrected || item.minimalFix || ""),
        reason: String(item.reason || item.explanation || item.problem || ""),
        problem: String(item.problem || ""),
        explanation: String(item.explanation || item.reason || ""),
      })).filter((item) => item.original || item.problem)
      : [],
    naturalVersion: String(input.naturalVersion || input.standardExpression || ""),
    standardExpression: String(input.standardExpression || ""),
    standardExpressionBackTranslation: String(input.standardExpressionBackTranslation || ""),
    baseChunks: asStringArray(input.baseChunks).slice(0, 4),
    abstractFramework: String(input.abstractFramework || ""),
    frameworkExplanation: String(input.frameworkExplanation || ""),
    frameworkUsageCondition: String(input.frameworkUsageCondition || ""),
    controlledPrompt: String(input.controlledPrompt || ""),
    modelVersion: String(modelVersion),
  };
}

function normalizeCorpusCheck(input = {}, phase = "controlled", frameworkRevealed = false, modelVersion = "") {
  const statuses = new Set(["complete", "partial", "missing"]);
  const usageStatuses = new Set(["accurate", "grammar_issue", "semantic_issue", "not_used"]);
  const passed = Boolean(input.passed);
  const canUpgrade = passed
    && (phase === "controlled" || (phase === "reused" && !frameworkRevealed));
  return {
    type: "corpus-check",
    phase,
    passed,
    canUpgrade,
    feedback: String(input.feedback || ""),
    grammarNaturalness: {
      status: statuses.has(input.grammarNaturalness?.status) ? input.grammarNaturalness.status : "missing",
      comment: String(input.grammarNaturalness?.comment || ""),
    },
    targetUsage: {
      status: usageStatuses.has(input.targetUsage?.status) ? input.targetUsage.status : "not_used",
      comment: String(input.targetUsage?.comment || ""),
    },
    remainingIssues: Array.isArray(input.remainingIssues)
      ? input.remainingIssues.map((item) => ({
        original: String(item.original || ""),
        problem: String(item.problem || ""),
        suggestedRevision: String(item.suggestedRevision || ""),
      })).filter((item) => item.original || item.problem)
      : [],
    suggestedRevision: String(input.suggestedRevision || ""),
    nextChinesePrompt: cleanChineseCorpusPrompt(input.nextChinesePrompt),
    frameworkRevealed: Boolean(frameworkRevealed),
    modelVersion: String(modelVersion),
  };
}

function normalizeCorpusUsage(input = {}, notesUsed = false, modelVersion = "") {
  const naturalUse = Boolean(input.naturalUse);
  return {
    type: "corpus-usage-check",
    naturalUse,
    feedback: String(input.feedback || ""),
    suggestedRevision: String(input.suggestedRevision || ""),
    qualifiesAsRealUse: naturalUse && Boolean(input.qualifiesAsRealUse !== false),
    notesUsed: Boolean(notesUsed),
    modelVersion: String(modelVersion),
    checkedAt: new Date().toISOString(),
  };
}

function normalizeCorpusRetrieval(input = {}, modelVersion = "") {
  const score = clamp(Math.round(Number(input.naturalness?.score) || 0), 0, 10);
  const level = score >= 9
    ? "Native-like"
    : score >= 7
      ? "Natural"
      : score >= 5
        ? "Understandable but uneven"
        : score >= 3
          ? "Awkward"
          : "Unclear";
  return {
    type: "corpus-retrieval",
    passed: Boolean(input.passed),
    feedback: String(input.feedback || ""),
    suggestedRevision: String(input.suggestedRevision || ""),
    naturalness: {
      score,
      level,
      comment: String(input.naturalness?.comment || ""),
    },
    modelVersion: String(modelVersion),
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Endpoint runners
// ---------------------------------------------------------------------------

async function requireConfig() {
  const config = getStoredConfig();
  if (!config.apiKey) {
    const error = new Error("DeepSeek 未配置，请先在“设置 → AI 服务”中填写 DeepSeek API Key。");
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }
  return config;
}

async function proxyToServer(endpoint, body, options = {}) {
  if (getStoredConfig().apiKey) return null;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    const error = new Error("浏览器未配置 DeepSeek API Key，并且本地服务端不可用。");
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `本地 AI 服务请求失败（${response.status}）。`);
    error.code = payload?.code || "AI_PROXY_ERROR";
    error.status = response.status;
    throw error;
  }
  if (options.attachRaw) payload.raw = payload.raw || null;
  return payload;
}

export async function runMatch(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/match", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const materials = Array.isArray(body.materials) ? body.materials : [];
  const prompts = Array.isArray(body.prompts) ? body.prompts : [];
  if (!materials.length || !prompts.length) {
    const error = new Error("匹配需要每日素材和题库。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const compactPrompts = prompts.map((prompt) => ({
    id: prompt.id,
    taskType: prompt.taskType,
    title: prompt.title,
    topic: prompt.topic,
    taskKind: prompt.taskKind,
    tags: prompt.tags,
    promptText: prompt.promptText,
  }));
  const content = await callDeepSeek([
    { role: "system", content: matchPrompt() },
    { role: "user", content: JSON.stringify({ materials, prompts: compactPrompts }) },
  ], config);
  const parsed = parseJsonContent(content);
  const selected = prompts.find((prompt) => prompt.id === parsed.promptId);
  if (!selected) {
    const error = new Error("模型没有返回有效题目。");
    error.code = "BAD_MATCH";
    throw error;
  }
  return {
    prompt: selected,
    reason: String(parsed.reason || "根据主题和写作功能进行匹配。"),
    confidence: clamp(Number(parsed.confidence) || 0.6, 0, 1),
    unmatchedMaterialIds: Array.isArray(parsed.unmatchedMaterialIds)
      ? parsed.unmatchedMaterialIds
      : [],
    ...(options.attachRaw ? { raw: parsed } : {}),
  };
}

export async function runEvaluate(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/evaluate", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const mode = body.mode === "formal" ? "formal" : "simple";
  const responseText = String(body.responseText || "").trim();
  if (!responseText) {
    const error = new Error("作文内容为空。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const taskType = body.taskType === "task1" ? "task1" : "task2";
  const systemPrompt = mode === "formal" ? formalEvaluatorPrompt() : dailyEvaluatorPrompt();
  const content = await callDeepSeek([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: JSON.stringify({
        mode,
        taskType,
        prompt: String(body.prompt || ""),
        responseText,
        materials: Array.isArray(body.materials) ? body.materials : [],
        wordCount: Number(body.wordCount) || 0,
        durationSeconds: Number(body.durationSeconds) || 0,
      }),
    },
  ], config);
  const parsed = parseJsonContent(content);
  const normalized = mode === "formal"
    ? normalizeFormalEvaluation(parsed, taskType, config.model)
    : normalizeSimpleEvaluation(parsed, config.model);
  if (options.attachRaw) normalized.raw = parsed;
  return normalized;
}

export async function runLearningExtension(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/learning-extension", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const responseText = String(body.responseText || "").trim();
  const prompt = String(body.prompt || "").trim();
  if (!responseText || !prompt) {
    const error = new Error("生成进阶学习需要题目和原文。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const taskType = body.taskType === "task1" ? "task1" : "task2";
  const content = await callDeepSeek([
    { role: "system", content: learningExtensionPrompt() },
    {
      role: "user",
      content: JSON.stringify({
        mode: body.mode === "formal" ? "formal" : "simple",
        taskType,
        prompt,
        responseText,
        materials: Array.isArray(body.materials) ? body.materials : [],
        evaluation: body.evaluation || {},
      }),
    },
  ], config);
  const parsed = parseJsonContent(content);
  const normalized = normalizeLearningExtension(parsed, taskType, config.model);
  if (options.attachRaw) normalized.raw = parsed;
  return normalized;
}

export async function runRevisionCheck(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/revision-check", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const originalText = String(body.originalText || "").trim();
  const currentText = String(body.currentText || "").trim();
  if (!originalText || !currentText) {
    const error = new Error("重新批改需要原稿和修改稿。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const content = await callDeepSeek([
    { role: "system", content: revisionCheckPrompt() },
    {
      role: "user",
      content: JSON.stringify({
        mode: body.mode === "formal" ? "formal" : "simple",
        taskType: body.taskType === "task1" ? "task1" : "task2",
        prompt: String(body.prompt || ""),
        originalText,
        currentText,
        targetFixes: Array.isArray(body.targetFixes) ? body.targetFixes : [],
        minimalRewrite: String(body.minimalRewrite || ""),
      }),
    },
  ], config);
  const parsed = parseJsonContent(content);
  const normalized = normalizeRevisionFeedback(parsed, config.model);
  if (options.attachRaw) normalized.raw = parsed;
  return normalized;
}

export async function runCorpusEvaluate(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/corpus/evaluate", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const chineseIntent = String(body.chineseIntent || "").trim();
  const targetExpression = String(body.targetExpression || "").trim();
  const firstAttempt = String(body.firstAttempt || "").trim();
  if (!chineseIntent || !firstAttempt) {
    const error = new Error("请填写中文含义和第一次英文表达。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const content = await callDeepSeek([
    { role: "system", content: corpusEvaluatePrompt() },
    {
      role: "user",
      content: JSON.stringify({
        chineseIntent,
        targetExpression,
        topicTags: asStringArray(body.topicTags),
        firstAttempt,
      }),
    },
  ], config);
  const parsed = parseJsonContent(content);
  const normalized = normalizeCorpusEvaluation(parsed, config.model);
  if (options.attachRaw) normalized.raw = parsed;
  return normalized;
}

export async function runCorpusCheck(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/corpus/check", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const phase = body.phase === "reused" ? "reused" : "controlled";
  const answer = String(body.answer || "").trim();
  if (!answer) {
    const error = new Error("练习内容为空。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const frameworkRevealed = Boolean(body.frameworkRevealed);
  const content = await callDeepSeek([
    { role: "system", content: corpusCheckPrompt(phase) },
    {
      role: "user",
      content: JSON.stringify({
        phase,
        item: normalizeCorpusItemForPrompt(body.item),
        answer,
        frameworkRevealed,
      }),
    },
  ], config);
  const parsed = parseJsonContent(content);
  const normalized = normalizeCorpusCheck(parsed, phase, frameworkRevealed, config.model);
  if (options.attachRaw) normalized.raw = parsed;
  return normalized;
}

export async function runCorpusUsageCheck(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/corpus/usage-check", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const realText = String(body.realText || "").trim();
  if (!realText) {
    const error = new Error("真实使用内容为空。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const notesUsed = Boolean(body.notesUsed);
  const content = await callDeepSeek([
    { role: "system", content: corpusUsagePrompt() },
    {
      role: "user",
      content: JSON.stringify({
        item: normalizeCorpusItemForPrompt(body.item),
        realText,
        context: String(body.context || "").trim(),
        notesUsed,
      }),
    },
  ], config);
  const parsed = parseJsonContent(content);
  const normalized = normalizeCorpusUsage(parsed, notesUsed, config.model);
  if (options.attachRaw) normalized.raw = parsed;
  return normalized;
}

export async function runCorpusRandomPrompt(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/corpus/random-prompt", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const item = normalizeCorpusItemForPrompt(body.item);
  if (!item.chineseIntent || !item.abstractFramework) {
    const error = new Error("生成语境需要中文原意和已确认框架。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const content = await callDeepSeek([
    { role: "system", content: corpusRandomPromptPrompt() },
    {
      role: "user",
      content: JSON.stringify({
        item,
        previousPrompt: String(body.previousPrompt || "").trim(),
      }),
    },
  ], config);
  const parsed = parseJsonContent(content);
  const chinesePrompt = cleanChineseCorpusPrompt(parsed.chinesePrompt);
  if (!chinesePrompt) {
    const error = new Error("模型没有生成有效的纯中文语境。");
    error.code = "BAD_RANDOM_PROMPT";
    throw error;
  }
  const normalized = {
    type: "corpus-random-prompt",
    chinesePrompt,
    modelVersion: config.model,
    generatedAt: new Date().toISOString(),
  };
  if (options.attachRaw) normalized.raw = parsed;
  return normalized;
}

export async function runCorpusRetrieval(body = {}, options = {}) {
  const proxied = await proxyToServer("/api/corpus/retrieval", body, options);
  if (proxied) return proxied;
  const config = await requireConfig();
  const answer = String(body.answer || "").trim();
  if (!answer) {
    const error = new Error("复习答案为空。");
    error.code = "BAD_REQUEST";
    throw error;
  }
  const questionType = String(body.questionType || "translation");
  const content = await callDeepSeek([
    { role: "system", content: corpusRetrievalPrompt() },
    {
      role: "user",
      content: JSON.stringify({
        item: normalizeCorpusItemForPrompt(body.item),
        questionType,
        question: String(body.question || ""),
        answer,
      }),
    },
  ], config);
  const parsed = parseJsonContent(content);
  const normalized = normalizeCorpusRetrieval(parsed, config.model);
  if (options.attachRaw) normalized.raw = parsed;
  return normalized;
}

export const __internals = {
  callDeepSeek,
  parseJsonContent,
  matchPrompt,
  dailyEvaluatorPrompt,
  formalEvaluatorPrompt,
  revisionCheckPrompt,
  corpusEvaluatePrompt,
  corpusCheckPrompt,
  corpusRetrievalPrompt,
  corpusRandomPromptPrompt,
  corpusUsagePrompt,
  learningExtensionPrompt,
  normalizeSimpleEvaluation,
  normalizeFormalEvaluation,
  normalizeLearningExtension,
  normalizeRevisionFeedback,
  normalizeCorpusEvaluation,
  normalizeCorpusCheck,
  normalizeCorpusRetrieval,
  normalizeCorpusUsage,
  cleanChineseCorpusPrompt,
  formatBandRange,
};
