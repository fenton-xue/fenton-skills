/**
 * 从 Chrome 中已打开的 Google Calendar 页面提取活动颜色。
 *
 * 推荐用法：
 *
 *   const mod = await import("D:/Workspace/FentonWorkspace/.agents/skills/weekly-report/scripts/extract_calendar_event_colors.mjs");
 *   const colorEvents = await mod.extractCalendarEventColors(tab, {
 *     calendarEvents: googleCalendarEvents,
 *     includeRawText: false,
 *   });
 *   const weeklyReportEvents = mod.mergeCalendarEventsWithColors(googleCalendarEvents, colorEvents);
 *   nodeRepl.write(JSON.stringify(weeklyReportEvents, null, 2));
 *
 * 也可以通过全局输入直接运行：
 *
 *   globalThis.calendarColorInput = { calendarEvents: googleCalendarEvents };
 *   await import("D:/Workspace/FentonWorkspace/.agents/skills/weekly-report/scripts/extract_calendar_event_colors.mjs?run=" + Date.now());
 */

const COLOR_NAME_TO_ID = {
  "石墨黑": "8",
  "孔雀蓝": "9",
  "鼠尾草绿": "10",
};

const COLOR_ID_TO_NAME = {
  "8": "石墨黑",
  "9": "孔雀蓝",
  "10": "鼠尾草绿",
};

const COLOR_ID_TO_STAGE = {
  "8": "编写用例",
  "9": "初测",
  "10": "复测",
};

const KNOWN_COLORS = [
  { color_id: "8", color_name: "石墨黑", stage: "编写用例", hex: "#e1e1e1", rgb: [225, 225, 225] },
  { color_id: "8", color_name: "石墨黑", stage: "编写用例", hex: "#616161", rgb: [97, 97, 97] },
  { color_id: "8", color_name: "石墨黑", stage: "编写用例", hex: "#d0d0d0", rgb: [208, 208, 208] },
  { color_id: "9", color_name: "孔雀蓝", stage: "初测", hex: "#5484ed", rgb: [84, 132, 237] },
  { color_id: "9", color_name: "孔雀蓝", stage: "初测", hex: "#039be5", rgb: [3, 155, 229] },
  { color_id: "9", color_name: "孔雀蓝", stage: "初测", hex: "#b3e1f7", rgb: [179, 225, 247] },
  { color_id: "10", color_name: "鼠尾草绿", stage: "复测", hex: "#51b749", rgb: [81, 183, 73] },
  { color_id: "10", color_name: "鼠尾草绿", stage: "复测", hex: "#33b679", rgb: [51, 182, 121] },
  { color_id: "10", color_name: "鼠尾草绿", stage: "复测", hex: "#c2e9d7", rgb: [194, 233, 215] },
];

const DEFAULT_WORK_ITEM_RE = /#\d+/g;

const EN_MONTH_TO_NUMBER = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const EN_MONTH_PATTERN = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripTime(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 10) : null;
}

function addDays(isoDate, days) {
  if (!isoDate) return null;
  const date = new Date(`${isoDate}T00:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeIsoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDateRangeParts(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const start = makeIsoDate(startYear, startMonth, startDay);
  let resolvedEndYear = endYear || startYear;
  let end = makeIsoDate(resolvedEndYear, endMonth || startMonth, endDay);
  if (!endYear && end < start) {
    resolvedEndYear = Number(startYear) + 1;
    end = makeIsoDate(resolvedEndYear, endMonth || startMonth, endDay);
  }
  return { start_date: start, end_date_inclusive: end };
}

function monthNameToNumber(value) {
  const key = String(value || "").replace(/\.$/, "").toLowerCase();
  return EN_MONTH_TO_NUMBER[key] || null;
}

function normalizeEventId(value) {
  return normalizeText(value).replace(/\s+/g, "").toLowerCase();
}

function eventIdsMatch(expectedId, colorEventId) {
  const expected = normalizeEventId(expectedId);
  const actual = normalizeEventId(colorEventId);
  if (!expected || !actual) return false;
  if (expected === actual) return true;
  const minLength = Math.min(expected.length, actual.length);
  return minLength >= 8 && (expected.includes(actual) || actual.includes(expected));
}

function parseInputDate(value) {
  if (!value) return null;
  if (typeof value === "object") {
    return stripTime(value.date || value.dateTime);
  }
  return stripTime(value);
}

function normalizeExpectedEvent(raw, index = 0) {
  const summary = normalizeText(raw.summary || raw.title || raw.display_title || raw.name || "");
  const startDate = parseInputDate(raw.start || raw.start_time || raw.startTime);
  const rawEndDate = parseInputDate(raw.end || raw.end_time || raw.endTime || raw.finish);
  const isAllDayExclusive = rawEndDate && startDate && rawEndDate > startDate;
  const endDateInclusive = isAllDayExclusive ? addDays(rawEndDate, -1) : rawEndDate || startDate;
  const workItemId = extractWorkItemIds(summary)[0] || raw.work_item_id || raw.workItemId || "";

  return {
    index,
    id: raw.id || raw.event_id || raw.eventId || null,
    summary,
    work_item_id: workItemId,
    start_date: startDate,
    end_date_inclusive: endDateInclusive,
    raw,
  };
}

function normalizeExpectedEvents(options = {}) {
  const rawEvents = options.calendarEvents || options.calendar_events || options.expectedEvents || options.events || [];
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents.map((event, index) => normalizeExpectedEvent(event, index)).filter((event) => event.summary || event.work_item_id);
}

export function extractWorkItemIds(value, pattern = DEFAULT_WORK_ITEM_RE) {
  const text = normalizeText(value);
  const regex = pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`) : DEFAULT_WORK_ITEM_RE;
  return Array.from(new Set(Array.from(text.matchAll(regex), (match) => match[0])));
}

function buildMatchers(options = {}) {
  const expectedEvents = normalizeExpectedEvents(options);
  const explicitIds = options.workItemIds || options.work_item_ids || [];
  const ids = new Set(explicitIds.map(normalizeText).filter(Boolean));
  for (const event of expectedEvents) {
    if (event.work_item_id) ids.add(event.work_item_id);
  }

  const titleMatchers = expectedEvents
    .filter((event) => event.summary)
    .map((event) => ({
      work_item_id: event.work_item_id,
      title: event.summary,
      normalized_title: normalizeText(event.summary).toLowerCase(),
    }));

  return {
    work_item_ids: Array.from(ids),
    title_matchers: titleMatchers,
  };
}

function parseRgb(value) {
  const text = String(value || "").trim().toLowerCase();
  const rgbMatch = text.match(/rgba?\(([^)]+)\)/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((part) => part.trim());
    if (parts.length >= 3) {
      const rgb = parts.slice(0, 3).map((part) => Number.parseFloat(part));
      if (rgb.every((n) => Number.isFinite(n))) {
        const alpha = parts[3] == null ? 1 : Number.parseFloat(parts[3]);
        return {
          rgb: rgb.map((n) => Math.max(0, Math.min(255, Math.round(n)))),
          alpha: Number.isFinite(alpha) ? alpha : 1,
        };
      }
    }
  }

  const hex = normalizeHex(text);
  if (!hex) return null;
  return {
    rgb: [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ],
    alpha: 1,
  };
}

function normalizeHex(value) {
  const text = String(value || "").trim().toLowerCase();
  const short = text.match(/^#([0-9a-f]{3})$/);
  if (short) {
    return `#${short[1].split("").map((char) => char + char).join("")}`;
  }
  const full = text.match(/^#([0-9a-f]{6})$/);
  return full ? `#${full[1]}` : null;
}

function rgbToHex(rgb) {
  return `#${rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let saturation = 0;
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    if (max === g) hue = 60 * ((b - r) / delta + 2);
    if (max === b) hue = 60 * ((r - g) / delta + 4);
  }

  if (hue < 0) hue += 360;
  return { hue, saturation, lightness };
}

function distance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function nearestKnownColor(rgb) {
  let best = null;
  for (const known of KNOWN_COLORS) {
    const score = distance(rgb, known.rgb);
    if (!best || score < best.score) {
      best = { ...known, score };
    }
  }
  return best;
}

export function inferColorFromCssColor(value) {
  const parsed = parseRgb(value);
  if (!parsed || parsed.alpha === 0) return null;
  const { rgb, alpha } = parsed;
  const hex = rgbToHex(rgb);
  const brightness = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const spread = Math.max(...rgb) - Math.min(...rgb);
  const { hue, saturation, lightness } = rgbToHsl(rgb);
  const exact = KNOWN_COLORS.find((known) => known.hex === hex);

  if (exact) {
    return {
      color_id: exact.color_id,
      color_name: exact.color_name,
      stage: exact.stage,
      color_hex: hex,
      confidence: 1,
      reason: "exact",
    };
  }

  if (brightness >= 248 && spread <= 8) return null;

  // Google Calendar may dim past events. Use hue/channel family first so lower
  // brightness variants keep their original color category.
  if (saturation <= 0.14 && brightness >= 35 && brightness <= 240) {
    return {
      color_id: "8",
      color_name: "石墨黑",
      stage: "编写用例",
      color_hex: hex,
      confidence: 0.78,
      reason: "gray-family",
    };
  }

  if (saturation >= 0.12 && hue >= 185 && hue <= 250) {
    return {
      color_id: "9",
      color_name: "孔雀蓝",
      stage: "初测",
      color_hex: hex,
      confidence: 0.82,
      reason: "blue-family",
    };
  }

  if (saturation >= 0.12 && hue >= 80 && hue <= 170) {
    return {
      color_id: "10",
      color_name: "鼠尾草绿",
      stage: "复测",
      color_hex: hex,
      confidence: 0.82,
      reason: "green-family",
    };
  }

  const nearest = nearestKnownColor(rgb);
  if (nearest && nearest.score <= 70) {
    return {
      color_id: nearest.color_id,
      color_name: nearest.color_name,
      stage: nearest.stage,
      color_hex: hex,
      confidence: Math.max(0.5, 1 - nearest.score / 100),
      reason: "nearest",
    };
  }

  return { color_hex: hex, confidence: 0, reason: "unknown", color_id: null, color_name: null, stage: null };
}

function cssPropertyWeight(property = "") {
  if (/background/i.test(property)) return 30;
  if (/border(left|right|top|bottom)?color/i.test(property)) return 22;
  if (/boxShadow/i.test(property)) return 12;
  return 4;
}

export function inferColorFromCssCandidates(candidates = []) {
  let best = null;
  for (const candidate of candidates) {
    const inferred = inferColorFromCssColor(candidate.value);
    if (!inferred || !inferred.color_id) continue;
    const score = inferred.confidence * 100 + cssPropertyWeight(candidate.property) - (candidate.depth || 0) * 4;
    const enriched = {
      ...inferred,
      css_value: candidate.value,
      css_property: candidate.property,
      css_depth: candidate.depth || 0,
      score,
    };
    if (!best || enriched.score > best.score) best = enriched;
  }
  return best;
}

function inferColorFromText(text) {
  const normalized = normalizeText(text);
  const colorMatch = normalized.match(/颜色[:：]\s*([^，, ]+)/);
  const colorName = colorMatch ? colorMatch[1] : null;
  if (colorName && COLOR_NAME_TO_ID[colorName]) {
    const colorId = COLOR_NAME_TO_ID[colorName];
    return {
      color_id: colorId,
      color_name: colorName,
      stage: COLOR_ID_TO_STAGE[colorId],
      confidence: 1,
      reason: "text",
    };
  }
  return null;
}

export function parseCalendarDateRange(text, options = {}) {
  const normalized = normalizeText(text);
  const defaultYear = options.defaultYear || options.default_year || new Date().getFullYear();

  const isoRange = normalized.match(/(\d{4}-\d{2}-\d{2})\s*[–—~至到-]\s*(\d{4}-\d{2}-\d{2})/);
  if (isoRange) {
    return { start_date: isoRange[1], end_date_inclusive: isoRange[2] };
  }

  const isoSingle = normalized.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoSingle) {
    return { start_date: isoSingle[1], end_date_inclusive: isoSingle[1] };
  }

  const slashFullRange = normalized.match(/(\d{4})[/.](\d{1,2})[/.](\d{1,2})\s*[–—~至到-]\s*(?:(\d{4})[/.])?(\d{1,2})[/.](\d{1,2})/);
  if (slashFullRange) {
    return normalizeDateRangeParts(
      slashFullRange[1],
      slashFullRange[2],
      slashFullRange[3],
      slashFullRange[4],
      slashFullRange[5],
      slashFullRange[6]
    );
  }

  const slashFullSingle = normalized.match(/(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
  if (slashFullSingle) {
    const day = makeIsoDate(slashFullSingle[1], slashFullSingle[2], slashFullSingle[3]);
    return { start_date: day, end_date_inclusive: day };
  }

  const englishRange = normalized.match(new RegExp(`\\b(${EN_MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s*[–—~至到-]\\s*(?:(${EN_MONTH_PATTERN})\\.?\\s+)?(\\d{1,2})(?:,\\s*(\\d{4}))?`, "i"));
  if (englishRange) {
    const startMonth = monthNameToNumber(englishRange[1]);
    const startDay = englishRange[2];
    const endMonth = monthNameToNumber(englishRange[4]) || startMonth;
    const endDay = englishRange[5];
    const startYear = englishRange[3] || englishRange[6] || defaultYear;
    const endYear = englishRange[6] || null;
    if (startMonth && endMonth) {
      return normalizeDateRangeParts(startYear, startMonth, startDay, endYear, endMonth, endDay);
    }
  }

  const englishSingle = normalized.match(new RegExp(`\\b(${EN_MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?`, "i"));
  if (englishSingle) {
    const month = monthNameToNumber(englishSingle[1]);
    if (month) {
      const day = makeIsoDate(englishSingle[3] || defaultYear, month, englishSingle[2]);
      return { start_date: day, end_date_inclusive: day };
    }
  }

  const fullRange = normalized.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*[–—~至到-]\s*(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日/);
  if (fullRange) {
    return normalizeDateRangeParts(fullRange[1], fullRange[2], fullRange[3], fullRange[4], fullRange[5] || fullRange[2], fullRange[6]);
  }

  const monthDayRange = normalized.match(/(\d{1,2})月(\d{1,2})日\s*[–—~至到-]\s*(?:(\d{1,2})月)?(\d{1,2})日/);
  if (monthDayRange) {
    return normalizeDateRangeParts(defaultYear, monthDayRange[1], monthDayRange[2], null, monthDayRange[3] || monthDayRange[1], monthDayRange[4]);
  }

  const slashMonthDayRange = normalized.match(/(\d{1,2})[/.](\d{1,2})\s*[–—~至到-]\s*(?:(\d{1,2})[/.])?(\d{1,2})/);
  if (slashMonthDayRange) {
    return normalizeDateRangeParts(defaultYear, slashMonthDayRange[1], slashMonthDayRange[2], null, slashMonthDayRange[3] || slashMonthDayRange[1], slashMonthDayRange[4]);
  }

  const fullSingle = normalized.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (fullSingle) {
    const day = makeIsoDate(fullSingle[1], fullSingle[2], fullSingle[3]);
    return { start_date: day, end_date_inclusive: day };
  }

  const monthDaySingle = normalized.match(/(\d{1,2})月(\d{1,2})日/);
  if (monthDaySingle) {
    const day = makeIsoDate(defaultYear, monthDaySingle[1], monthDaySingle[2]);
    return { start_date: day, end_date_inclusive: day };
  }

  const slashMonthDaySingle = normalized.match(/(\d{1,2})[/.](\d{1,2})/);
  if (slashMonthDaySingle) {
    const day = makeIsoDate(defaultYear, slashMonthDaySingle[1], slashMonthDaySingle[2]);
    return { start_date: day, end_date_inclusive: day };
  }

  return {};
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function dedupeEvents(events) {
  const byKey = new Map();
  for (const event of events) {
    const key = [
      event.work_item_id || "",
      event.title || "",
      event.start_date || "",
      event.end_date_inclusive || "",
      event.color_id || "",
      event.color_hex || "",
    ].join("|");
    const existing = byKey.get(key);
    if (!existing || event.source_score > existing.source_score) {
      byKey.set(key, event);
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) =>
      (a.start_date || "").localeCompare(b.start_date || "") ||
      (a.work_item_id || "").localeCompare(b.work_item_id || "") ||
      (b.source_score || 0) - (a.source_score || 0)
    )
    .map(({ source_score, ...event }) => event);
}

function buildElementMatcher(matchers) {
  const workItemIds = matchers.work_item_ids || [];
  const titleMatchers = matchers.title_matchers || [];

  return (text) => {
    const normalized = normalizeText(text);
    const lower = normalized.toLowerCase();
    const id = workItemIds.find((workItemId) => normalized.includes(workItemId));
    if (id) return { work_item_id: id };

    const titleMatch = titleMatchers.find((matcher) => matcher.normalized_title && lower.includes(matcher.normalized_title));
    if (titleMatch) return { work_item_id: titleMatch.work_item_id, title: titleMatch.title };
    return null;
  };
}

export async function extractCalendarEventColors(tab, options = {}) {
  const matchers = buildMatchers(options);
  if (matchers.work_item_ids.length === 0 && matchers.title_matchers.length === 0) {
    throw new Error("请传入 workItemIds 或 calendarEvents，例如 { workItemIds: ['#89608'] }。");
  }

  const rawEvents = await tab.playwright.evaluate((input) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 16 && rect.height >= 6 && rect.width <= 1800 && rect.height <= 260 &&
        style.visibility !== "hidden" && style.display !== "none";
    };
    const textFor = (element) => normalize([
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-tooltip"),
    ].filter(Boolean).join(" "));
    const matches = (text) => {
      const normalized = normalize(text);
      const lower = normalized.toLowerCase();
      for (const id of input.work_item_ids) {
        if (normalized.includes(id)) return { work_item_id: id };
      }
      for (const title of input.title_matchers) {
        if (title.normalized_title && lower.includes(title.normalized_title)) {
          return { work_item_id: title.work_item_id, title: title.title };
        }
      }
      return null;
    };
    const colorCandidatesFor = (element) => {
      const output = [];
      const props = [
        "backgroundColor",
        "borderTopColor",
        "borderRightColor",
        "borderBottomColor",
        "borderLeftColor",
        "boxShadow",
      ];

      let node = element;
      for (let depth = 0; node && depth <= 5; depth += 1, node = node.parentElement) {
        const style = getComputedStyle(node);
        for (const prop of props) {
          const value = style[prop];
          if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") continue;
          output.push({
            value,
            property: prop,
            depth,
            tag: node.tagName,
            role: node.getAttribute("role"),
            class_name: String(node.className || ""),
          });
        }
      }
      return output;
    };

    const selectors = [
      "[data-eventid]",
      "[data-event-chip]",
      "[role='button']",
      "a[aria-label]",
      "div[aria-label]",
      "span[aria-label]",
    ];
    const elements = Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))));
    const output = [];

    for (const element of elements) {
      if (!isVisible(element)) continue;

      const parentText = element.parentElement ? textFor(element.parentElement) : "";
      const text = normalize(`${textFor(element)} ${parentText}`);
      const match = matches(text);
      if (!match) continue;

      const rect = element.getBoundingClientRect();
      output.push({
        ...match,
        text,
        aria_label: element.getAttribute("aria-label"),
        title_attr: element.getAttribute("title"),
        data_event_id: element.getAttribute("data-eventid"),
        role: element.getAttribute("role"),
        tag: element.tagName,
        class_name: String(element.className || ""),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        css_colors: colorCandidatesFor(element),
      });
    }

    return output;
  }, matchers, { timeoutMs: options.timeoutMs || 10000 });

  const defaultYear = options.defaultYear || options.default_year || new Date().getFullYear();
  const mapped = rawEvents.map((event) => {
    const textColor = inferColorFromText(event.text);
    const cssColor = inferColorFromCssCandidates(event.css_colors);
    const color = textColor || cssColor;
    const dateRange = parseCalendarDateRange(event.text, { defaultYear });
    const title = event.title || parseTitleFromText(event.text, event.work_item_id);
    const sourceScore = (event.data_event_id ? 50 : 0) + (event.role === "button" ? 30 : 0) + (color?.score || color?.confidence * 100 || 0);

    return {
      work_item_id: event.work_item_id,
      title,
      ...dateRange,
      data_event_id: event.data_event_id || null,
      color_name: color?.color_name || null,
      color_id: color?.color_id || null,
      stage: color?.stage || null,
      color_hex: color?.color_hex || null,
      css_value: color?.css_value || null,
      css_property: color?.css_property || null,
      color_confidence: color?.confidence || null,
      color_reason: color?.reason || null,
      rect: event.rect,
      source_score: sourceScore,
      raw_text: options.includeRawText ? event.text : undefined,
    };
  }).filter((event) => event.color_id || event.color_hex);

  return dedupeEvents(mapped);
}

function parseTitleFromText(text, workItemId) {
  const normalized = normalizeText(text);
  if (!workItemId) return normalized.slice(0, 120);
  const index = normalized.indexOf(workItemId);
  if (index < 0) return workItemId;
  const tail = normalized.slice(index);
  const boundary = tail.search(/\s+(全天|重复|日程|颜色[:：]|Calendar|Google)/i);
  return normalizeText(boundary > 0 ? tail.slice(0, boundary) : tail).slice(0, 160);
}

function disambiguationKey(expected) {
  return expected.work_item_id || normalizeText(expected.summary).toLowerCase();
}

function scoreColorMatch(expected, colorEvent, options = {}) {
  if (!expected || !colorEvent) return -1;
  let score = 0;
  const eventIdMatched = eventIdsMatch(expected.id, colorEvent.data_event_id);
  let dateMatched = false;

  if (eventIdMatched) score += 220;
  if (expected.work_item_id && colorEvent.work_item_id === expected.work_item_id) score += 80;
  if (expected.summary && colorEvent.title && normalizeText(colorEvent.title).includes(expected.work_item_id || expected.summary)) score += 15;
  if (expected.start_date && expected.end_date_inclusive && colorEvent.start_date && colorEvent.end_date_inclusive) {
    if (rangesOverlap(expected.start_date, expected.end_date_inclusive, colorEvent.start_date, colorEvent.end_date_inclusive)) {
      score += 100;
      dateMatched = true;
    }
    if (expected.start_date === colorEvent.start_date) score += 30;
    if (expected.end_date_inclusive === colorEvent.end_date_inclusive) score += 20;
  }
  if (!colorEvent.start_date && !colorEvent.end_date_inclusive) score += 5;
  score += Math.round((colorEvent.color_confidence || 0) * 20);
  if (options.ambiguousExpected && !eventIdMatched && !dateMatched) {
    return Math.min(score, 70);
  }
  return score;
}

export function mergeCalendarEventsWithColors(calendarEvents = [], colorEvents = [], options = {}) {
  const expectedEvents = calendarEvents.map((event, index) => normalizeExpectedEvent(event, index));
  const minimumScore = options.minimumScore ?? 80;
  const ambiguityCounts = new Map();
  for (const expected of expectedEvents) {
    const key = disambiguationKey(expected);
    if (!key) continue;
    ambiguityCounts.set(key, (ambiguityCounts.get(key) || 0) + 1);
  }

  return expectedEvents.map((expected) => {
    let best = null;
    const key = disambiguationKey(expected);
    const ambiguousExpected = key && (ambiguityCounts.get(key) || 0) > 1;
    for (const colorEvent of colorEvents) {
      const score = scoreColorMatch(expected, colorEvent, { ambiguousExpected });
      if (!best || score > best.score) {
        best = { event: colorEvent, score };
      }
    }

    const color = best && best.score >= minimumScore ? best.event : null;
    return {
      ...expected.raw,
      summary: expected.summary,
      start: expected.raw.start || (expected.start_date ? `${expected.start_date}T00:00:00` : null),
      end: expected.raw.end || (expected.end_date_inclusive ? `${addDays(expected.end_date_inclusive, 1)}T00:00:00` : null),
      color_id: color?.color_id || expected.raw.color_id || expected.raw.colorId || null,
      color_name: color?.color_name || expected.raw.color_name || expected.raw.colorName || null,
      backgroundColor: color?.color_hex || expected.raw.backgroundColor || null,
      stage: color?.stage || expected.raw.stage || expected.raw["阶段"] || null,
      color_match_score: color ? best.score : 0,
    };
  });
}

export function toWeeklyReportEvents(events) {
  return events.map((event) => {
    const start = event.start_date ? `${event.start_date}T00:00:00` : event.start || null;
    let end = event.end || null;
    if (!end && event.end_date_inclusive) {
      end = `${addDays(event.end_date_inclusive, 1)}T00:00:00`;
    }

    return {
      summary: event.summary || event.title,
      start,
      end,
      color_id: event.color_id,
      color_name: event.color_name,
      backgroundColor: event.color_hex || event.backgroundColor,
      stage: event.stage,
    };
  });
}

if (globalThis.tab && globalThis.nodeRepl && globalThis.calendarColorInput) {
  const colorEvents = await extractCalendarEventColors(globalThis.tab, globalThis.calendarColorInput);
  const calendarEvents = globalThis.calendarColorInput.calendarEvents || globalThis.calendarColorInput.calendar_events;
  const weeklyReportEvents = Array.isArray(calendarEvents)
    ? mergeCalendarEventsWithColors(calendarEvents, colorEvents, globalThis.calendarColorInput)
    : toWeeklyReportEvents(colorEvents);
  globalThis.calendarColorResult = { colorEvents, weeklyReportEvents };
  nodeRepl.write(JSON.stringify(globalThis.calendarColorResult, null, 2));
}
