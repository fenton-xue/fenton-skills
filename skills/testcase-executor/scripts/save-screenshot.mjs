import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requirePositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return value;
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function requireScreenshotBytes(value) {
  if (value instanceof Uint8Array && value.byteLength > 0) {
    return value;
  }
  if (value instanceof ArrayBuffer && value.byteLength > 0) {
    return new Uint8Array(value);
  }
  throw new TypeError("screenshotBytes must be a non-empty Uint8Array or ArrayBuffer");
}

function detectScreenshotFormat(bytes) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return { extension: "webp", mimeType: "image/webp" };
  }
  throw new TypeError("unsupported screenshot format; expected JPEG, PNG, or WebP");
}

export async function saveScreenshot({
  screenshotBytes,
  screenshotUrl,
  requirementDir,
  environment = "uat",
  caseNo,
  stepNo,
  shotNo,
  label,
}) {
  const normalizedRequirementDir = requireNonEmptyString(
    requirementDir,
    "requirementDir",
  );
  const normalizedEnvironment = requireNonEmptyString(
    environment,
    "environment",
  ).toLowerCase();
  const normalizedLabel = requireNonEmptyString(label, "label");

  if (!path.isAbsolute(normalizedRequirementDir)) {
    throw new TypeError("requirementDir must be an absolute path");
  }
  if (normalizedEnvironment !== "uat" && normalizedEnvironment !== "pre") {
    throw new TypeError("environment must be uat or pre");
  }
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(normalizedLabel)) {
    throw new TypeError(
      "label must contain lowercase letters, digits, and single underscores only",
    );
  }

  const hasBytes = screenshotBytes !== undefined;
  const hasUrl = screenshotUrl !== undefined;
  if (hasBytes === hasUrl) {
    throw new TypeError(
      "provide exactly one of screenshotBytes or screenshotUrl",
    );
  }

  let bytes;
  let sourcePath;
  if (hasBytes) {
    bytes = requireScreenshotBytes(screenshotBytes);
  } else {
    const sourceUrl = requireNonEmptyString(screenshotUrl, "screenshotUrl");
    const parsedSourceUrl = new URL(sourceUrl);
    if (parsedSourceUrl.protocol !== "file:") {
      throw new TypeError("screenshotUrl must be a file:// URL");
    }
    sourcePath = fileURLToPath(parsedSourceUrl);
    bytes = await readFile(sourcePath);
  }
  const format = detectScreenshotFormat(bytes);

  const normalizedCaseNo = requirePositiveInteger(caseNo, "caseNo");
  const normalizedStepNo = requirePositiveInteger(stepNo, "stepNo");
  const normalizedShotNo = requirePositiveInteger(shotNo, "shotNo");
  const filename =
    `${normalizedEnvironment}_case${padNumber(normalizedCaseNo)}` +
    `_step${padNumber(normalizedStepNo)}_${padNumber(normalizedShotNo)}` +
    `_${normalizedLabel}.${format.extension}`;

  const targetDir = path.join(
    normalizedRequirementDir,
    "测试用例",
    "execute-testcase",
    `${normalizedEnvironment}-screenshots`,
  );
  await mkdir(targetDir, { recursive: true });

  const absolutePath = path.join(targetDir, filename);
  if (sourcePath) {
    await copyFile(sourcePath, absolutePath, constants.COPYFILE_EXCL);
  } else {
    await writeFile(absolutePath, bytes, { flag: "wx" });
  }

  const resultPath = path.posix.join(
    `${normalizedEnvironment}-screenshots`,
    filename,
  );
  return {
    name: filename,
    path: resultPath,
    filename,
    absolutePath,
    mimeType: format.mimeType,
    relativePath: resultPath,
  };
}
