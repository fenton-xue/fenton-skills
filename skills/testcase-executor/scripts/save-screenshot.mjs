import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
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

export async function saveScreenshot({
  screenshotUrl,
  requirementDir,
  environment = "uat",
  caseNo,
  stepNo,
  shotNo,
  label,
}) {
  const sourceUrl = requireNonEmptyString(screenshotUrl, "screenshotUrl");
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

  const parsedSourceUrl = new URL(sourceUrl);
  if (parsedSourceUrl.protocol !== "file:") {
    throw new TypeError("screenshotUrl must be a file:// URL");
  }

  const normalizedCaseNo = requirePositiveInteger(caseNo, "caseNo");
  const normalizedStepNo = requirePositiveInteger(stepNo, "stepNo");
  const normalizedShotNo = requirePositiveInteger(shotNo, "shotNo");
  const filename =
    `${normalizedEnvironment}_case${padNumber(normalizedCaseNo)}` +
    `_step${padNumber(normalizedStepNo)}_${padNumber(normalizedShotNo)}` +
    `_${normalizedLabel}.png`;

  const targetDir = path.join(
    normalizedRequirementDir,
    "execute-testcase",
    "screenshots",
  );
  await mkdir(targetDir, { recursive: true });

  const absolutePath = path.join(targetDir, filename);
  await copyFile(
    fileURLToPath(parsedSourceUrl),
    absolutePath,
    constants.COPYFILE_EXCL,
  );

  return {
    filename,
    absolutePath,
    relativePath: path.posix.join("execute-testcase", "screenshots", filename),
  };
}
