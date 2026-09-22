import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { averageBand, roundHalfBand } from "./public/core.mjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(rootDir, "public");

loadEnvFile(resolve(rootDir, ".env.local"));

const PORT = Number(process.env.PORT) || 4173;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DAILY_RUBRIC_SOURCE = "Daily IELTS Mini Practice Rubric v0.2";
const FORMAL_RUBRIC_SOURCE = "IELTS public Writing band descriptors + 雅思正式写作评分系统.md v0.1";
const RUBRIC_RETRIEVED_DATE = "2026-09-17";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      return sendJson(response, 200, {
        status: "ok",
        aiConfigured: Boolean(DEEPSEEK_API_KEY),
        databaseConfigured: Boolean(
          process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
        ),
      });
    }

    if (url.pathname === "/api/status") {
      return sendJson(response, 200, {
        configured: Boolean(DEEPSEEK_API_KEY),
        model: DEEPSEEK_MODEL,
        baseUrl: DEEPSEEK_BASE_URL,
      });
    }

    if (url.pathname === "/api/prompts" && request.method === "GET") {
      const markdown = await readFile(join(rootDir, "data", "prompts.md"), "utf8");
      response.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return response.end(markdown);
    }

    if (url.pathname === "/api/match" && request.method === "POST") {
      return handleMatch(request, response);
    }

    if (url.pathname === "/api/evaluate" && request.method === "POST") {
      return handleEvaluate(request, response);
    }

    if (url.pathname === "/api/learning-extension" && request.method === "POST") {
      return handleLearningExtension(request, response);
    }

    if (url.pathname === "/api/revision-check" && request.method === "POST") {
      return handleRevisionCheck(request, response);
    }

    if (url.pathname === "/api/corpus/evaluate" && request.method === "POST") {
      return handleCorpusEvaluate(request, response);
    }

    if (url.pathname === "/api/corpus/check" && request.method === "POST") {
      return handleCorpusCheck(request, response);
    }

    if (url.pathname === "/api/corpus/usage-check" && request.method === "POST") {
      return handleCorpusUsageCheck(request, response);
    }

    if (url.pathname === "/api/corpus/random-prompt" && request.method === "POST") {
      return handleCorpusRandomPrompt(request, response);
    }

    if (url.pathname === "/api/corpus/retrieval" && request.method === "POST") {
      return handleCorpusRetrieval(request, response);
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(response, 404, { error: "接口不存在。" });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: error.message || "服务器发生未知错误。" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Bandcraft running on 0.0.0.0:${PORT}`);
  if (!DEEPSEEK_API_KEY) {
    console.log("DeepSeek is not configured. Add DEEPSEEK_API_KEY to .env.local.");
  }
});

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(publicDir, `.${normalize(requested)}`);

  if (!filePath.startsWith(publicDir)) {
    return sendJson(response, 403, { error: "禁止访问该路径。" });
  }

  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error("Not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    const fallback = await readFile(join(publicDir, "index.html"));
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[".html"],
      "Cache-Control": "no-store",
    });
    response.end(fallback);
  }
}

async function handleMatch(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置，前端将使用本地匹配规则。",
      code: "AI_NOT_CONFIGURED",
    });
  }

  const body = await readJsonBody(request);
  const materials = Array.isArray(body.materials) ? body.materials : [];
  const prompts = Array.isArray(body.prompts) ? body.prompts : [];

  if (!materials.length || !prompts.length) {
    return sendJson(response, 400, { error: "匹配需要每日素材和题库。" });
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
    {
      role: "system",
      content: [
        "You choose one IELTS writing prompt for daily language practice.",
        "Prefer natural topic, function, register, and collocation compatibility.",
        "Do not force unrelated material into a prompt.",
        "For Task 1, only choose Task 1 when the material can describe data, processes, maps, comparisons, or trends.",
        "Return JSON only with this shape:",
        '{"promptId":"","reason":"","confidence":0.0,"unmatchedMaterialIds":[]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({ materials, prompts: compactPrompts }),
    },
  ]);

  const parsed = parseJsonContent(content);
  const selected = prompts.find((prompt) => prompt.id === parsed.promptId);
  if (!selected) {
    return sendJson(response, 502, { error: "模型没有返回有效题目。" });
  }

  return sendJson(response, 200, {
    prompt: selected,
    reason: String(parsed.reason || "根据主题和写作功能进行匹配。"),
    confidence: clamp(Number(parsed.confidence) || 0.6, 0, 1),
    unmatchedMaterialIds: Array.isArray(parsed.unmatchedMaterialIds)
      ? parsed.unmatchedMaterialIds
      : [],
  });
}

async function handleEvaluate(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置。请先在本机 .env.local 中设置 DEEPSEEK_API_KEY，并重新启动服务。",
      code: "AI_NOT_CONFIGURED",
    });
  }

  const body = await readJsonBody(request);
  const mode = body.mode === "formal" ? "formal" : "simple";
  const responseText = String(body.responseText || "").trim();

  if (!responseText) {
    return sendJson(response, 400, { error: "作文内容为空。" });
  }

  const systemPrompt = mode === "formal" ? formalEvaluatorPrompt() : dailyEvaluatorPrompt();
  const content = await callDeepSeek([
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: JSON.stringify({
        mode,
        taskType: body.taskType === "task1" ? "task1" : "task2",
        prompt: body.prompt || "",
        responseText,
        materials: Array.isArray(body.materials) ? body.materials : [],
        wordCount: Number(body.wordCount) || 0,
        durationSeconds: Number(body.durationSeconds) || 0,
      }),
    },
  ]);

  const parsed = parseJsonContent(content);
  const normalized = mode === "formal"
    ? normalizeFormalEvaluation(parsed, body.taskType, DEEPSEEK_MODEL)
    : normalizeSimpleEvaluation(parsed, DEEPSEEK_MODEL);

  return sendJson(response, 200, normalized);
}

async function handleLearningExtension(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置，暂时无法生成进阶学习内容。",
      code: "AI_NOT_CONFIGURED",
    });
  }

  const body = await readJsonBody(request);
  const responseText = String(body.responseText || "").trim();
  const prompt = String(body.prompt || "").trim();
  if (!responseText || !prompt) {
    return sendJson(response, 400, { error: "生成进阶学习需要题目和原文。" });
  }

  const content = await callDeepSeek([
    { role: "system", content: learningExtensionPrompt() },
    {
      role: "user",
      content: JSON.stringify({
        mode: body.mode === "formal" ? "formal" : "simple",
        taskType: body.taskType === "task1" ? "task1" : "task2",
        prompt,
        responseText,
        materials: Array.isArray(body.materials) ? body.materials : [],
        evaluation: body.evaluation || {},
      }),
    },
  ]);

  const parsed = parseJsonContent(content);
  return sendJson(response, 200, normalizeLearningExtension(parsed, body.taskType, DEEPSEEK_MODEL));
}

async function handleRevisionCheck(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置，暂时无法检查修改稿。",
      code: "AI_NOT_CONFIGURED",
    });
  }

  const body = await readJsonBody(request);
  const originalText = String(body.originalText || "").trim();
  const currentText = String(body.currentText || "").trim();
  if (!originalText || !currentText) {
    return sendJson(response, 400, { error: "重新批改需要原稿和修改稿。" });
  }

  const content = await callDeepSeek([
    { role: "system", content: revisionCheckPrompt() },
    {
      role: "user",
      content: JSON.stringify({
        mode: body.mode === "formal" ? "formal" : "simple",
        taskType: body.taskType === "task1" ? "task1" : "task2",
        prompt: body.prompt || "",
        originalText,
        currentText,
        targetFixes: Array.isArray(body.targetFixes) ? body.targetFixes : [],
        minimalRewrite: body.minimalRewrite || "",
      }),
    },
  ]);

  const parsed = parseJsonContent(content);
  return sendJson(response, 200, normalizeRevisionFeedback(parsed, DEEPSEEK_MODEL));
}

async function handleCorpusEvaluate(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置，暂时无法评价第一次表达。",
      code: "AI_NOT_CONFIGURED",
    });
  }

  const body = await readJsonBody(request);
  const chineseIntent = String(body.chineseIntent || "").trim();
  const targetExpression = String(body.targetExpression || "").trim();
  const firstAttempt = String(body.firstAttempt || "").trim();
  if (!chineseIntent || !firstAttempt) {
    return sendJson(response, 400, { error: "请填写中文含义和第一次英文表达。" });
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
  ]);

  return sendJson(response, 200, normalizeCorpusEvaluation(parseJsonContent(content), DEEPSEEK_MODEL));
}

async function handleCorpusCheck(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置，暂时无法检查语料练习。",
      code: "AI_NOT_CONFIGURED",
    });
  }

  const body = await readJsonBody(request);
  const phase = body.phase === "reused" ? "reused" : "controlled";
  const answer = String(body.answer || "").trim();
  if (!answer) return sendJson(response, 400, { error: "练习内容为空。" });

  const content = await callDeepSeek([
    { role: "system", content: corpusCheckPrompt(phase) },
    {
      role: "user",
      content: JSON.stringify({
        phase,
        item: normalizeCorpusItemForPrompt(body.item),
        answer,
        frameworkRevealed: Boolean(body.frameworkRevealed),
      }),
    },
  ]);

  return sendJson(response, 200, normalizeCorpusCheck(parseJsonContent(content), phase, body.frameworkRevealed, DEEPSEEK_MODEL));
}

async function handleCorpusUsageCheck(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置，暂时无法检查真实使用记录。",
      code: "AI_NOT_CONFIGURED",
    });
  }

  const body = await readJsonBody(request);
  const realText = String(body.realText || "").trim();
  if (!realText) return sendJson(response, 400, { error: "真实使用内容为空。" });

  const content = await callDeepSeek([
    { role: "system", content: corpusUsagePrompt() },
    {
      role: "user",
      content: JSON.stringify({
        item: normalizeCorpusItemForPrompt(body.item),
        realText,
        context: String(body.context || "").trim(),
        notesUsed: Boolean(body.notesUsed),
      }),
    },
  ]);

  return sendJson(response, 200, normalizeCorpusUsage(parseJsonContent(content), body.notesUsed, DEEPSEEK_MODEL));
}

async function handleCorpusRandomPrompt(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置，暂时无法生成随机中文语境。",
      code: "AI_NOT_CONFIGURED",
    });
  }

  const body = await readJsonBody(request);
  const item = normalizeCorpusItemForPrompt(body.item);
  if (!item.chineseIntent || !item.abstractFramework) {
    return sendJson(response, 400, { error: "生成语境需要中文原意和已确认框架。" });
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
  ]);
  const parsed = parseJsonContent(content);
  const chinesePrompt = cleanChineseCorpusPrompt(parsed.chinesePrompt);
  if (!chinesePrompt) {
    throw new Error("模型没有生成有效的纯中文语境。");
  }
  return sendJson(response, 200, {
    type: "corpus-random-prompt",
    chinesePrompt,
    modelVersion: DEEPSEEK_MODEL,
    generatedAt: new Date().toISOString(),
  });
}

async function handleCorpusRetrieval(request, response) {
  if (!DEEPSEEK_API_KEY) {
    return sendJson(response, 503, {
      error: "DeepSeek 未配置，暂时无法检查复习题。",
      code: "AI_NOT_CONFIGURED",
    });
  }
  const body = await readJsonBody(request);
  const answer = String(body.answer || "").trim();
  const questionType = String(body.questionType || "translation");
  if (!answer) return sendJson(response, 400, { error: "复习答案为空。" });

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
  ]);
  return sendJson(response, 200, normalizeCorpusRetrieval(parseJsonContent(content), DEEPSEEK_MODEL));
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

function corpusEvaluatePrompt() {
  return [
    "You are an IELTS vocabulary and collocation coach.",
    "The learner provides a Chinese meaning, an optional target English expression, and a first English attempt.",
    "Evaluate whether the first attempt expresses the Chinese meaning clearly and whether it sounds natural.",
    "For naturalness, assign an integer score from 0 to 10.",
    "Naturalness scoring guide: 0-2 does not read as valid English, 3-4 awkward or hard to follow, 5-6 understandable but noticeably non-native, 7-8 natural with minor issues, 9-10 natural native-like control suitable for clear IELTS writing.",
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
      naturalness: { status: "complete|partial|missing", score: 0, level: "", comment: "" },
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
    naturalness: normalizeNaturalness(input.naturalness),
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

function normalizeNaturalness(value = {}) {
  const statuses = new Set(["complete", "partial", "missing"]);
  const status = statuses.has(value?.status) ? value.status : "missing";
  const fallbackScore = status === "complete" ? 8 : status === "partial" ? 5 : 2;
  const rawScore = Number(value?.score);
  const score = clamp(Number.isFinite(rawScore) ? Math.round(rawScore) : fallbackScore, 0, 10);
  const defaultLevel = score >= 9
    ? "Native-like"
    : score >= 7
      ? "Natural"
      : score >= 5
        ? "Understandable but uneven"
        : score >= 3
          ? "Awkward"
          : "Unclear";
  return {
    status,
    score,
    level: defaultLevel,
    comment: String(value?.comment || ""),
  };
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
      grammarNaturalness: { status: "complete|partial|missing", score: 0, level: "", comment: "" },
      targetUsage: { status: "accurate|grammar_issue|semantic_issue|not_used", comment: "" },
      remainingIssues: [{ original: "", problem: "", suggestedRevision: "" }],
      suggestedRevision: "",
      nextChinesePrompt: "",
      modelVersion: "",
    }),
  ].join("\n");
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
    grammarNaturalness: normalizeNaturalness(input.grammarNaturalness),
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
    "For every needed correction, provide original, corrected, and a short reason.",
    "Give a complete naturalVersion of the learner's answer.",
    "Give concise feedback and one suggested revision if needed.",
    "Return JSON only with this shape:",
    JSON.stringify({
      type: "corpus-retrieval",
      passed: false,
      feedback: "",
      suggestedRevision: "",
      corrections: [{ original: "", corrected: "", reason: "" }],
      naturalVersion: "",
      naturalness: {
        score: 0,
        level: "",
        comment: "",
      },
      modelVersion: "",
    }),
  ].join("\n");
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
    corrections: Array.isArray(input.corrections)
      ? input.corrections.map((item) => ({
        original: String(item.original || ""),
        corrected: String(item.corrected || ""),
        reason: String(item.reason || ""),
      })).filter((item) => item.original || item.corrected)
      : [],
    naturalVersion: String(input.naturalVersion || ""),
    naturalness: {
      score,
      level,
      comment: String(input.naturalness?.comment || ""),
    },
    modelVersion: String(modelVersion),
    checkedAt: new Date().toISOString(),
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

function normalizeTopErrors(items = []) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 3).map((item) => ({
    original: String(item.original || ""),
    problem: String(item.problem || ""),
    requiredPattern: String(item.requiredPattern || ""),
    minimalFix: String(item.minimalFix || ""),
  })).filter((item) => item.original || item.problem || item.requiredPattern);
}

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

function normalizeCriterion(criterion = {}, fallbackName) {
  return {
    name: String(criterion.name || fallbackName),
    estimatedBand: roundHalfBand(clamp(Number(criterion.estimatedBand) || 0, 0, 9)),
    evidence: asStringArray(criterion.evidence),
    limitation: String(criterion.limitation || ""),
  };
}

function formatBandRange(low, high, estimate) {
  if (low === high) return `${estimate.toFixed(1)}`;
  return `${roundHalfBand(low).toFixed(1)}-${roundHalfBand(high).toFixed(1)}`;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function clampScore(value) {
  return clamp(Number(value) || 0, 0, 2);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function callDeepSeek(messages) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `DeepSeek request failed with ${response.status}.`;
    throw new Error(message);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型没有返回内容。");
  return content;
}

function parseJsonContent(content) {
  const text = String(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("模型返回的内容不是有效 JSON。");
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("请求内容过大。");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求 JSON 格式无效。");
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": MIME_TYPES[".json"],
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
