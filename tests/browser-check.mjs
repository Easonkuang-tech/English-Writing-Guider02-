import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:4173";
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

async function findChrome() {
  for (const path of chromeCandidates) {
    try {
      await readFile(path);
      return path;
    } catch {
      // Try the next browser path.
    }
  }
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to run the browser check.");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForJson(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function run() {
  const chromePath = await findChrome();
  const debugPort = await freePort();
  const userDataDir = await mkdtemp(join(tmpdir(), "bandcraft-browser-"));
  const browser = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  let socket;
  try {
    const pages = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = pages.find((item) => item.type === "page");
    if (!page?.webSocketDebuggerUrl) throw new Error("No debuggable browser page was found.");

    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const handler = pending.get(message.id);
      if (!handler) return;
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
      }
      return result.result.value;
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await send("Page.navigate", { url: `${baseUrl}/#/home` });

    await evaluate(`(async () => {
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Missing selector: " + selector);
      };
      await waitFor("#today-vocabulary");
      return true;
    })()`);

    const mobile = await evaluate(`(() => ({
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bottomNavItems: document.querySelectorAll(".bottom-nav-item").length,
      h1: document.querySelector("h1")?.textContent,
      promptCount: JSON.parse(localStorage.getItem("bandcraft:data:v1") || "{}").prompts?.length || 0
    }))()`);
    assert.equal(mobile.bottomNavItems, 5);
    assert.ok(mobile.scrollWidth <= mobile.innerWidth + 1, `Mobile overflow: ${mobile.scrollWidth} > ${mobile.innerWidth}`);
    assert.ok(mobile.promptCount === 40, `Expected 40 seeded prompts, found ${mobile.promptCount}`);

    const flow = await evaluate(`(async () => {
      const waitFor = async (selector, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Missing selector: " + selector);
      };
      const vocabulary = document.querySelector("#today-vocabulary");
      vocabulary.value = "- tangible benefits: practical advantages";
      vocabulary.dispatchEvent(new Event("input", { bubbles: true }));
      const patterns = document.querySelector("#today-patterns");
      patterns.value = "- while concession: While X..., Y...";
      patterns.dispatchEvent(new Event("input", { bubbles: true }));
      location.hash = "#/bank";
      await waitFor("[data-action='use-prompt']");
      document.querySelector("[data-action='use-prompt']").click();
      const editor = await waitFor("#response-text");
      editor.value = "Public transport can produce tangible benefits for commuters and reduce traffic in crowded cities. It also gives people without cars a reliable way to reach work and education every day.";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      const savedDraftKeys = Object.keys(localStorage).filter((key) => key.startsWith("bandcraft:draft:"));
      return {
        route: location.hash,
        wordCount: Number(document.querySelector("#word-count")?.textContent || 0),
        savedDraftKeys: savedDraftKeys.length,
        targetChips: document.querySelectorAll(".target-chip").length
      };
    })()`);
    assert.match(flow.route, /practice/);
    assert.ok(flow.wordCount >= 12);
    assert.equal(flow.savedDraftKeys, 1);
    assert.equal(flow.targetChips, 2);

    const mobileShot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile("browser-mobile.png", Buffer.from(mobileShot.data, "base64"));

    let aiFlow = null;
    let learningFlow = null;
    let corpusFlow = null;
    if (process.env.RUN_AI === "1") {
      aiFlow = await evaluate(`(async () => {
        const waitFor = async (selector, timeout = 150000) => {
          const started = Date.now();
          while (Date.now() - started < timeout) {
            const element = document.querySelector(selector);
            if (element) return element;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error("Missing selector: " + selector);
        };
        document.querySelector("[data-action='submit-response']").click();
        await waitFor(".simple-hero");
        const revision = document.querySelector('[data-input="revision-draft"]');
        revision.value = "Household internet access increased in all four countries between 2000 and 2024. Country A had the highest percentage throughout the period, while Country D began lower but grew rapidly.";
        revision.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("[data-action='submit-revision']").click();
        await waitFor(".revision-feedback");
        return {
          route: location.hash,
          score: document.querySelector(".score-dial strong")?.textContent?.trim(),
          usageItems: document.querySelectorAll(".usage-item").length,
          historyCount: JSON.parse(localStorage.getItem("bandcraft:data:v1") || "{}").attempts?.length || 0,
          rubricVersion: JSON.parse(localStorage.getItem("bandcraft:data:v1") || "{}").attempts?.[0]?.evaluation?.rubricVersion,
          hasLearningCta: Boolean(document.querySelector(".learning-cta")),
          fullRewriteVisibleBeforeClick: Boolean(document.querySelector(".improved-version")),
          teachingFixes: document.querySelectorAll(".teaching-fix-card").length,
          hasRevisionCoach: Boolean(document.querySelector(".revision-coach")),
          revisionRounds: JSON.parse(localStorage.getItem("bandcraft:data:v1") || "{}").revisionSessions?.[0]?.rounds?.length || 0,
          oldPrioritySectionRemoved: !document.body.textContent.includes("这次只改一件事")
        };
      })()`);
      assert.match(aiFlow.route, /report/);
      assert.ok(Number(aiFlow.score) >= 0);
      assert.ok(aiFlow.usageItems >= 1);
      assert.equal(aiFlow.historyCount, 1);
      assert.equal(aiFlow.rubricVersion, "daily-v0.2");
      assert.equal(aiFlow.hasLearningCta, true);
      assert.equal(aiFlow.fullRewriteVisibleBeforeClick, false);
      assert.ok(aiFlow.teachingFixes >= 1 && aiFlow.teachingFixes <= 3);
      assert.equal(aiFlow.hasRevisionCoach, true);
      assert.equal(aiFlow.revisionRounds, 1);
      assert.equal(aiFlow.oldPrioritySectionRemoved, true);
      const reportShot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile("browser-report-mobile.png", Buffer.from(reportShot.data, "base64"));

      learningFlow = await evaluate(`(async () => {
        const waitFor = async (selector, timeout = 150000) => {
          const started = Date.now();
          while (Date.now() - started < timeout) {
            const element = document.querySelector(selector);
            if (element) return element;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error("Missing selector: " + selector);
        };
        document.querySelector("[data-action='start-learning']").click();
        await waitFor(".learning-hero");
        const functionCards = document.querySelectorAll(".learning-function-card");
        const data = JSON.parse(localStorage.getItem("bandcraft:data:v1") || "{}");
        const extension = data.learningExtensions?.[0];
        const activeId = extension?.progress?.activeFunctionId;
        const activeFunction = extension?.content?.functions?.find((item) => item.id === activeId);
        const activePattern = activeFunction?.universalPattern || "";
        const firstInput = document.querySelector("[data-input='learning-answer']");
        firstInput.value = activePattern;
        firstInput.dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("[data-action='check-extraction']").click();
        await waitFor(".extraction-result");
        return {
          route: location.hash,
          functionCards: functionCards.length,
          functionTabs: document.querySelectorAll(".learning-function-tabs button").length,
          extensionCount: data.learningExtensions?.length || 0,
          activeFunctionId: extension?.progress?.activeFunctionId || "",
          correctExtraction: Boolean(document.querySelector(".extraction-result.is-correct")),
          improvedWords: extension?.content?.wordCount || 0
        };
      })()`);
      assert.match(learningFlow.route, /learn/);
      assert.equal(learningFlow.functionCards, 1);
      assert.equal(learningFlow.functionTabs, 4);
      assert.equal(learningFlow.extensionCount, 1);
      assert.ok(learningFlow.activeFunctionId);
      assert.equal(learningFlow.correctExtraction, true);
      assert.ok(learningFlow.improvedWords > 80);
      const learningShot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile("browser-learning-mobile.png", Buffer.from(learningShot.data, "base64"));

      corpusFlow = await evaluate(`(async () => {
        const waitFor = async (selector, timeout = 150000) => {
          const started = Date.now();
          while (Date.now() - started < timeout) {
            const element = document.querySelector(selector);
            if (element) return element;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error("Missing selector: " + selector);
        };
        location.hash = "#/corpus/new";
        await waitFor("#corpus-chinese");
        document.querySelector("#corpus-chinese").value = "企业应该为其环境影响对公众负责。";
        document.querySelector("#corpus-target").value = "be accountable to + noun + for + noun";
        document.querySelector("#corpus-tags").value = "environment, business";
        document.querySelector("[data-action='start-corpus-first-timer']").click();
        await waitFor("#corpus-first-attempt:not([disabled])");
        document.querySelector("#corpus-first-attempt").value = "Companies need responsible for their environmental impact.";
        document.querySelector("#corpus-first-attempt").dispatchEvent(new Event("input", { bubbles: true }));
        document.querySelector("[data-action='submit-corpus-first']").click();
        await waitFor(".standard-expression");
        const correctionPairs = document.querySelectorAll(".correction-pair").length;
        const naturalnessScore = Number(document.querySelector("[data-naturalness-score]")?.textContent?.split("/")[0] || 0);
        document.querySelector("[data-action='confirm-corpus-framework']").click();
        await waitFor("[data-corpus-answer='controlled']");
        document.querySelector("[data-corpus-answer='controlled']").value = "Companies should be accountable to the public for their environmental impact.";
        document.querySelector("[data-action='check-corpus-controlled']").click();
        await waitFor("[data-corpus-answer='reused']");
        document.querySelector("[data-corpus-answer='reused']").value = "The employee should be accountable to the team for the project result.";
        document.querySelector("[data-action='check-corpus-reused']").click();
        await waitFor(".usage-progress-row");
        const usageCases = [
          {
            text: "The supplier should be accountable to local residents for its waste management.",
            context: "email",
            notesUsed: false
          },
          {
            text: "Our manager should be accountable to the whole team for this decision.",
            context: "chat",
            notesUsed: true
          },
          {
            text: "Schools should be accountable to parents for the safety of their students.",
            context: "writing",
            notesUsed: true
          }
        ];
        const usageCount = () => {
          const current = JSON.parse(localStorage.getItem("bandcraft:data:v1") || "{}");
          return current.corpusItems?.[0]?.usageRecords?.length || 0;
        };
        const waitForUsageCount = async (expected, timeout = 150000) => {
          const started = Date.now();
          while (Date.now() - started < timeout) {
            if (usageCount() >= expected) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error("Timed out waiting for usage record " + expected);
        };
        for (let index = 0; index < usageCases.length; index += 1) {
          const item = usageCases[index];
          await waitFor("#corpus-usage-text");
          document.querySelector("#corpus-usage-text").value = item.text;
          document.querySelector("#corpus-usage-context").value = item.context;
          document.querySelector("#corpus-usage-notes").value = String(item.notesUsed);
          document.querySelector("[data-action='check-corpus-usage']").click();
          await waitForUsageCount(index + 1);
        }
        await waitFor("[data-action='upgrade-corpus-stage']");
        document.querySelector("[data-action='upgrade-corpus-stage']").click();
        await waitFor(".corpus-stage-badge.stage-spontaneous");
        await waitFor("#corpus-custom-name");
        document.querySelector("#corpus-custom-name").value = "Accountability 框架";
        document.querySelector("[data-action='save-corpus-name']").click();
        await waitFor(".corpus-name-row");
        const data = JSON.parse(localStorage.getItem("bandcraft:data:v1") || "{}");
        const item = data.corpusItems?.[0];
        return {
          route: location.hash,
          stage: item?.stage,
          naturalnessScore,
          correctionPairs,
          customName: item?.customName || "",
          attempts: data.corpusAttempts?.length || 0,
          usageRecords: item?.usageRecords?.length || 0,
          framework: item?.abstractFramework || "",
          standardExpression: item?.standardExpression || "",
          reusedPrompt: item?.reusedChinesePrompt || ""
        };
      })()`);
      assert.match(corpusFlow.route, /corpus/);
      assert.equal(corpusFlow.stage, "spontaneous");
      assert.ok(corpusFlow.naturalnessScore >= 0 && corpusFlow.naturalnessScore <= 10);
      assert.ok(corpusFlow.correctionPairs >= 1);
      assert.equal(corpusFlow.customName, "Accountability 框架");
      assert.ok(corpusFlow.attempts >= 3);
      assert.equal(corpusFlow.usageRecords, 3);
      assert.ok(corpusFlow.framework);
      assert.ok(corpusFlow.standardExpression);
      assert.ok(corpusFlow.reusedPrompt);
      assert.equal(/[A-Za-z]/.test(corpusFlow.reusedPrompt), false);
      const corpusShot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile("browser-corpus-mobile.png", Buffer.from(corpusShot.data, "base64"));
    }

    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: `${baseUrl}/#/home` });
    await evaluate(`(async () => {
      const started = Date.now();
      while (Date.now() - started < 8000) {
        if (document.querySelector(".sidebar .nav-item")) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Desktop navigation did not render.");
    })()`);
    const desktop = await evaluate(`(() => ({
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      sidebarItems: document.querySelectorAll(".sidebar .nav-item").length,
      mobileNavVisible: getComputedStyle(document.querySelector(".bottom-nav")).display !== "none"
    }))()`);
    assert.equal(desktop.sidebarItems, 5);
    assert.equal(desktop.mobileNavVisible, false);
    assert.ok(desktop.scrollWidth <= desktop.innerWidth + 1, `Desktop overflow: ${desktop.scrollWidth} > ${desktop.innerWidth}`);

    const desktopShot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile("browser-desktop.png", Buffer.from(desktopShot.data, "base64"));

    console.log(JSON.stringify({ mobile, flow, aiFlow, learningFlow, corpusFlow, desktop }, null, 2));
  } finally {
    if (socket) socket.close();
    browser.kill();
    await Promise.race([
      once(browser, "exit"),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
