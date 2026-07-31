import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const FINAL_STATUSES = new Set(["PASSED", "FAILED", "BLOCKED"]);

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
}

function statusClass(status) {
  return requireString(status, "status").toLowerCase();
}

function screenshotUrl(value) {
  const screenshot = requireString(value, "screenshot").replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(screenshot) ||
    screenshot.split("/").includes("..")
  ) {
    throw new TypeError("screenshot must be a relative path");
  }
  return screenshot
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function validateResult(result) {
  if (!result || typeof result !== "object") {
    throw new TypeError("result must be an object");
  }
  requireString(result.system, "result.system");
  requireString(result.prd_name, "result.prd_name");
  requireString(result.environment, "result.environment");
  requireString(result.run_id, "result.run_id");
  requireString(result.started_at, "result.started_at");
  requireString(result.finished_at, "result.finished_at");
  if (!FINAL_STATUSES.has(result.result)) {
    throw new TypeError("result.result must be finalized");
  }
  if (!Array.isArray(result.testcases) || result.testcases.length === 0) {
    throw new TypeError("result.testcases must be a non-empty array");
  }

  result.testcases.forEach((testcase, caseIndex) => {
    requireString(testcase.case_name, `testcases[${caseIndex}].case_name`);
    if (!FINAL_STATUSES.has(testcase.result)) {
      throw new TypeError(`testcases[${caseIndex}].result must be finalized`);
    }
    if (!Array.isArray(testcase.steps) || testcase.steps.length === 0) {
      throw new TypeError(`testcases[${caseIndex}].steps must not be empty`);
    }
    testcase.steps.forEach((step, stepIndex) => {
      if (!FINAL_STATUSES.has(step.result)) {
        throw new TypeError(
          `testcases[${caseIndex}].steps[${stepIndex}].result must be finalized`,
        );
      }
      if (!Array.isArray(step.screenshots)) {
        throw new TypeError(
          `testcases[${caseIndex}].steps[${stepIndex}].screenshots must be an array`,
        );
      }
    });
  });
}

function renderScreenshot(screenshot, caseNo, stepNo, shotNo) {
  const url = screenshotUrl(screenshot);
  const filename = screenshot.replaceAll("\\", "/").split("/").at(-1);
  const alt =
    `用例 ${caseNo} 步骤 ${stepNo} 截图 ${shotNo}：` + displayValue(filename);
  return `
            <figure class="evidence">
              <button class="evidence-button" type="button" data-image="${escapeHtml(url)}" data-alt="${escapeHtml(alt)}">
                <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">
              </button>
              <figcaption>${escapeHtml(filename)}</figcaption>
            </figure>`;
}

function renderStep(step, caseNo) {
  const screenshots = step.screenshots.length
    ? `<div class="evidence-grid">${step.screenshots
        .map((item, index) =>
          renderScreenshot(item, caseNo, step.step, index + 1),
        )
        .join("")}
          </div>`
    : '<p class="empty-evidence">本步骤无截图</p>';

  return `
        <section class="step-card">
          <div class="step-heading">
            <h3>步骤 ${escapeHtml(step.step)}</h3>
            <span class="status ${statusClass(step.result)}">${escapeHtml(step.result)}</span>
          </div>
          <dl class="step-fields">
            <div>
              <dt>操作</dt>
              <dd>${escapeHtml(displayValue(step.action))}</dd>
            </div>
            <div>
              <dt>预期</dt>
              <dd>${escapeHtml(displayValue(step.expected))}</dd>
            </div>
            <div>
              <dt>实际</dt>
              <dd>${escapeHtml(displayValue(step.actual))}</dd>
            </div>
          </dl>
          ${screenshots}
        </section>`;
}

function renderActualUrl(actualUrl) {
  if (actualUrl === null || actualUrl === undefined || actualUrl === "") {
    return "—";
  }
  try {
    const url = new URL(actualUrl);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noreferrer">${escapeHtml(actualUrl)}</a>`;
    }
  } catch {
    return escapeHtml(actualUrl);
  }
  return escapeHtml(actualUrl);
}

function normalizeModulePath(modulePath) {
  if (!Array.isArray(modulePath)) {
    return ["未分组"];
  }
  const normalized = modulePath
    .filter((item) => item !== null && item !== undefined)
    .map((item) => String(item).trim())
    .filter(Boolean);
  return normalized.length ? normalized : ["未分组"];
}

function buildModuleTree(testcases) {
  const root = { children: new Map(), testcases: [] };
  testcases.forEach((testcase, index) => {
    let current = root;
    normalizeModulePath(testcase.module_path).forEach((moduleName) => {
      if (!current.children.has(moduleName)) {
        current.children.set(moduleName, {
          name: moduleName,
          children: new Map(),
          testcases: [],
        });
      }
      current = current.children.get(moduleName);
    });
    current.testcases.push({ testcase, index });
  });
  return root;
}

function countModuleTestcases(module) {
  return (
    module.testcases.length +
    [...module.children.values()].reduce(
      (total, child) => total + countModuleTestcases(child),
      0,
    )
  );
}

function renderNavigationCase(testcase, index) {
  return `
              <a class="case-nav-link" href="#case-${index + 1}" data-status="${statusClass(testcase.result)}">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${escapeHtml(testcase.case_name)}</strong>
                <em class="status ${statusClass(testcase.result)}">${escapeHtml(testcase.result)}</em>
              </a>`;
}

function renderModuleNavigation(module, depth = 1) {
  const total = countModuleTestcases(module);
  const childModules = [...module.children.values()]
    .map((child) => renderModuleNavigation(child, depth + 1))
    .join("");
  const testcaseLinks = module.testcases
    .map(({ testcase, index }) => renderNavigationCase(testcase, index))
    .join("");
  const open = depth === 1 ? " open" : "";

  return `
          <details class="module-group" data-depth="${depth}"${open}>
            <summary>
              <span class="module-chevron" aria-hidden="true">›</span>
              <strong title="${escapeHtml(module.name)}">${escapeHtml(module.name)}</strong>
              <span class="module-count">${total}</span>
            </summary>
            <div class="module-children">
              ${childModules}
              ${testcaseLinks}
            </div>
          </details>`;
}

function renderTestcase(testcase, caseIndex) {
  const caseNo = caseIndex + 1;
  const open = testcase.result === "PASSED" ? "" : " open";
  const modules = Array.isArray(testcase.module_path)
    ? testcase.module_path.join(" › ")
    : "—";
  return `
    <details id="case-${caseNo}" class="case-card" data-status="${statusClass(testcase.result)}"${open}>
      <summary>
        <span class="case-index">用例 ${String(caseNo).padStart(2, "0")}</span>
        <span class="case-title">${escapeHtml(testcase.case_name)}</span>
        <span class="status ${statusClass(testcase.result)}">${escapeHtml(testcase.result)}</span>
      </summary>
      <div class="case-body">
        <dl class="case-meta">
          <div><dt>模块</dt><dd>${escapeHtml(modules)}</dd></div>
          <div><dt>页面</dt><dd>${escapeHtml(displayValue(testcase.page_id))}</dd></div>
          <div><dt>URL</dt><dd>${renderActualUrl(testcase.actual_url)}</dd></div>
          <div><dt>前置条件</dt><dd>${escapeHtml(displayValue(testcase.precondition))}</dd></div>
        </dl>
        <div class="steps">
          ${testcase.steps.map((step) => renderStep(step, caseNo)).join("")}
        </div>
      </div>
    </details>`;
}

export function renderHtmlReport(result) {
  validateResult(result);
  const reportTitle = `${result.system}-${result.prd_name}`;
  const counts = { PASSED: 0, FAILED: 0, BLOCKED: 0 };
  result.testcases.forEach((testcase) => {
    counts[testcase.result] += 1;
  });
  const moduleTree = buildModuleTree(result.testcases);
  const caseNavigation = [...moduleTree.children.values()]
    .map((module) => renderModuleNavigation(module))
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(reportTitle)} · ${escapeHtml(result.run_id)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --surface: #ffffff;
      --line: #dfe3e8;
      --text: #182230;
      --muted: #667085;
      --passed: #14804a;
      --passed-bg: #e8f7ef;
      --failed: #c4320a;
      --failed-bg: #fff0eb;
      --blocked: #9a6700;
      --blocked-bg: #fff7d6;
      --accent: #175cd3;
      --report-max: 1500px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; color: var(--text); background: var(--bg); }
    button, input { font: inherit; }
    a { color: var(--accent); }
    .report-header {
      color: white;
      background: linear-gradient(135deg, #14213d, #1d4ed8);
      padding: 32px clamp(20px, 5vw, 72px);
    }
    .header-row {
      max-width: var(--report-max);
      margin: 0 auto;
      display: flex;
      gap: 24px;
      align-items: flex-start;
      justify-content: space-between;
    }
    .report-title { margin: 5px 0 8px; font-size: clamp(26px, 4vw, 42px); }
    .eyebrow { margin: 0; opacity: .72; letter-spacing: .12em; font-size: 12px; }
    .run-meta { margin: 0; opacity: .82; line-height: 1.8; }
    .overall {
      min-width: 140px;
      text-align: center;
      padding: 14px 20px;
      border-radius: 14px;
      background: rgba(255,255,255,.14);
      border: 1px solid rgba(255,255,255,.22);
      font-size: 18px;
      font-weight: 750;
    }
    .layout {
      width: 100%;
      margin: 0;
      padding: 24px;
      display: grid;
      grid-template-columns: clamp(288px, calc(40vw - 360px), 416px) minmax(0, 1fr);
      gap: 24px;
      align-items: start;
    }
    .sidebar {
      position: sticky;
      top: 18px;
      height: calc(100vh - 36px);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 16px;
    }
    .panel, .case-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 14px;
      box-shadow: 0 5px 20px rgba(16, 24, 40, .05);
    }
    .panel { padding: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 15px; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .summary-grid div { text-align: center; border-radius: 10px; padding: 10px 4px; }
    .summary-grid strong { display: block; font-size: 22px; }
    .summary-grid span { font-size: 11px; color: var(--muted); }
    .summary-grid .passed { background: var(--passed-bg); color: var(--passed); }
    .summary-grid .failed { background: var(--failed-bg); color: var(--failed); }
    .summary-grid .blocked { background: var(--blocked-bg); color: var(--blocked); }
    .filters button {
      cursor: pointer;
      border: 1px solid var(--line);
      border-radius: 9px;
      background: white;
      color: var(--text);
      padding: 8px 10px;
    }
    .filters { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .filters button[aria-pressed="true"] { color: white; background: var(--accent); border-color: var(--accent); }
    .navigation-panel {
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .case-nav {
      min-height: 0;
      flex: 1;
      overflow: auto;
    }
    .module-group { margin: 3px 0; }
    .module-group[hidden] { display: none; }
    .module-group > summary {
      cursor: pointer;
      list-style: none;
      display: grid;
      grid-template-columns: 14px minmax(0, 1fr) auto;
      gap: 5px;
      align-items: center;
      min-height: 30px;
      padding: 5px 6px;
      border-radius: 7px;
      color: #344054;
    }
    .module-group > summary::-webkit-details-marker { display: none; }
    .module-group > summary:hover { background: #f2f4f7; }
    .module-group > summary strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }
    .module-chevron {
      color: #98a2b3;
      font-size: 18px;
      line-height: 1;
      transform-origin: center;
      transition: transform .15s ease;
    }
    .module-group[open] > summary .module-chevron { transform: rotate(90deg); }
    .module-count {
      min-width: 20px;
      color: var(--muted);
      background: #f2f4f7;
      border-radius: 999px;
      padding: 2px 6px;
      text-align: center;
      font-size: 10px;
      font-weight: 700;
    }
    .module-children {
      margin-left: 12px;
      padding-left: 6px;
      border-left: 1px solid #eaecf0;
    }
    .case-nav a {
      display: grid;
      grid-template-columns: 24px minmax(0,1fr) auto;
      gap: 8px;
      align-items: center;
      color: inherit;
      text-decoration: none;
      padding: 8px;
      border-radius: 8px;
    }
    .case-nav a:hover { background: #f2f4f7; }
    .case-nav a[hidden] { display: none; }
    .case-nav strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .case-nav em { font-size: 9px; }
    .content { display: grid; gap: 16px; min-width: 0; }
    .case-card { overflow: hidden; scroll-margin-top: 18px; }
    .case-card[hidden] { display: none; }
    .case-card summary {
      cursor: pointer;
      list-style: none;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 17px 20px;
    }
    .case-card summary::-webkit-details-marker { display: none; }
    .case-card[open] summary { border-bottom: 1px solid var(--line); }
    .case-index { color: var(--muted); font-size: 12px; font-weight: 700; }
    .case-title { font-weight: 700; overflow-wrap: anywhere; }
    .status {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 4px 9px;
      font-style: normal;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .03em;
    }
    .status.passed { color: var(--passed); background: var(--passed-bg); }
    .status.failed { color: var(--failed); background: var(--failed-bg); }
    .status.blocked { color: var(--blocked); background: var(--blocked-bg); }
    .case-body { padding: 20px; }
    dl { margin: 0; }
    .case-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--line);
    }
    .case-meta div { background: white; padding: 12px; min-width: 0; }
    dt { color: var(--muted); font-size: 11px; font-weight: 700; margin-bottom: 5px; }
    dd { margin: 0; line-height: 1.55; overflow-wrap: anywhere; }
    .steps { display: grid; gap: 14px; margin-top: 18px; }
    .step-card { border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
    .step-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .step-heading h3 { margin: 0; font-size: 16px; }
    .step-fields { display: grid; gap: 10px; margin-top: 14px; }
    .step-fields div { padding-left: 12px; border-left: 3px solid #d0d5dd; }
    .step-fields div:nth-child(2) { border-left-color: #84adff; }
    .step-fields div:nth-child(3) { border-left-color: #6ce9a6; }
    .evidence-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .evidence { margin: 0; min-width: 0; }
    .evidence-button {
      cursor: zoom-in;
      display: block;
      width: 100%;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #eef1f5;
    }
    .evidence img {
      display: block;
      width: 100%;
      height: 220px;
      object-fit: contain;
    }
    figcaption { color: var(--muted); margin-top: 6px; font-size: 11px; overflow-wrap: anywhere; }
    .empty-evidence { color: var(--muted); margin: 14px 0 0; font-size: 12px; }
    dialog {
      width: min(96vw, 1500px);
      max-width: none;
      padding: 0;
      border: 0;
      border-radius: 14px;
      background: #101828;
      box-shadow: 0 20px 80px rgba(0,0,0,.4);
    }
    dialog::backdrop { background: rgba(0,0,0,.72); }
    .lightbox-bar {
      color: white;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
    }
    .lightbox-bar span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lightbox-bar button { cursor: pointer; color: white; border: 1px solid #475467; border-radius: 8px; background: #344054; padding: 7px 12px; }
    #lightbox-image { display: block; width: 100%; max-height: 86vh; object-fit: contain; background: #0b1220; }
    @media (max-width: 860px) {
      .layout { grid-template-columns: 1fr; padding: 14px; }
      .sidebar {
        position: static;
        height: auto;
        grid-template-rows: auto auto;
      }
      .case-nav {
        flex: none;
        max-height: 360px;
      }
      .case-meta { grid-template-columns: 1fr; }
      .header-row { display: block; }
      .overall { margin-top: 18px; width: fit-content; }
    }
    @media print {
      .sidebar, dialog { display: none; }
      .layout { display: block; padding: 0; }
      .case-card { break-inside: avoid; margin-bottom: 14px; box-shadow: none; }
      .case-card:not([open]) .case-body { display: block; }
      .evidence img { height: auto; max-height: 380px; }
    }
  </style>
</head>
<body>
  <header class="report-header">
    <div class="header-row">
      <div>
        <p class="eyebrow">TEST EXECUTION REPORT</p>
        <h2 class="report-title">${escapeHtml(reportTitle)}</h2>
        <p class="run-meta">
          环境 ${escapeHtml(result.environment)} · Run ${escapeHtml(result.run_id)}<br>
          ${escapeHtml(result.started_at)} — ${escapeHtml(result.finished_at)}
        </p>
      </div>
      <div class="overall">${escapeHtml(result.result)}</div>
    </div>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <section class="panel">
        <h2>执行概览</h2>
        <div class="summary-grid">
          <div class="passed"><strong>${counts.PASSED}</strong><span>PASSED</span></div>
          <div class="failed"><strong>${counts.FAILED}</strong><span>FAILED</span></div>
          <div class="blocked"><strong>${counts.BLOCKED}</strong><span>BLOCKED</span></div>
        </div>
        <div class="filters" aria-label="按状态筛选">
          <button type="button" data-filter="all" aria-pressed="true">全部</button>
          <button type="button" data-filter="failed" aria-pressed="false">失败</button>
          <button type="button" data-filter="blocked" aria-pressed="false">阻塞</button>
          <button type="button" data-filter="passed" aria-pressed="false">通过</button>
        </div>
      </section>
      <section class="panel navigation-panel">
        <h2>用例导航</h2>
        <nav class="case-nav">${caseNavigation}
        </nav>
      </section>
    </aside>
    <section class="content">
      ${result.testcases.map(renderTestcase).join("")}
    </section>
  </main>
  <dialog id="lightbox">
    <div class="lightbox-bar">
      <span id="lightbox-title"></span>
      <button id="lightbox-close" type="button">关闭</button>
    </div>
    <img id="lightbox-image" alt="">
  </dialog>
  <script>
    const caseCards = [...document.querySelectorAll(".case-card")];
    const navLinks = [...document.querySelectorAll(".case-nav a")];
    const moduleGroups = [...document.querySelectorAll(".module-group")];
    function updateModuleGroups(filter) {
      [...moduleGroups].reverse().forEach((group) => {
        const visibleCount = [...group.querySelectorAll(".case-nav-link")]
          .filter((link) => !link.hidden).length;
        group.hidden = visibleCount === 0;
        group.querySelector(":scope > summary .module-count").textContent =
          String(visibleCount);
        if (filter !== "all" && visibleCount > 0) {
          group.open = true;
        }
      });
    }
    document.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach((item) => {
          item.setAttribute("aria-pressed", String(item === button));
        });
        caseCards.forEach((card) => {
          card.hidden = filter !== "all" && card.dataset.status !== filter;
        });
        navLinks.forEach((link) => {
          link.hidden = filter !== "all" && link.dataset.status !== filter;
        });
        updateModuleGroups(filter);
      });
    });
    navLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        const target = document.querySelector(link.getAttribute("href"));
        if (!target) {
          return;
        }
        event.preventDefault();
        target.open = true;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", link.getAttribute("href"));
      });
    });
    const dialog = document.querySelector("#lightbox");
    const dialogImage = document.querySelector("#lightbox-image");
    const dialogTitle = document.querySelector("#lightbox-title");
    document.querySelectorAll(".evidence-button").forEach((button) => {
      button.addEventListener("click", () => {
        dialogImage.src = button.dataset.image;
        dialogImage.alt = button.dataset.alt;
        dialogTitle.textContent = button.dataset.alt;
        dialog.showModal();
      });
    });
    document.querySelector("#lightbox-close").addEventListener("click", () => {
      dialog.close();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  </script>
</body>
</html>
`;
}

export async function writeHtmlReport({ result, outputPath }) {
  const targetPath = path.resolve(requireString(outputPath, "outputPath"));
  if (!path.isAbsolute(outputPath)) {
    throw new TypeError("outputPath must be an absolute path");
  }

  const html = renderHtmlReport(result);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, html, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return targetPath;
}
