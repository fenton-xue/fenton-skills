function formatError(lineNumber, message) {
  return new Error(`Line ${lineNumber}: ${message}`);
}

function requireText(value, lineNumber, field) {
  const normalized = value.trim();
  if (normalized === "") {
    throw formatError(lineNumber, `${field} cannot be empty`);
  }
  return normalized;
}

export function parseTestcases(sourceText) {
  if (typeof sourceText !== "string") {
    throw new TypeError("sourceText must be a string");
  }

  const lines = sourceText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const testcases = [];
  let modulePath = [];
  let currentCase = null;

  function finalizeCase() {
    if (!currentCase) {
      return;
    }
    if (currentCase.module_path.length === 0) {
      throw formatError(currentCase.lineNumber, "module path is missing");
    }

    const numbers = [
      ...new Set([
        ...currentCase.actions.keys(),
        ...currentCase.expectedResults.keys(),
      ]),
    ].sort((left, right) => left - right);

    if (numbers.length === 0) {
      throw formatError(currentCase.lineNumber, "test steps are missing");
    }

    numbers.forEach((number, index) => {
      if (number !== index + 1) {
        throw formatError(
          currentCase.lineNumber,
          `step numbers must be continuous from 1; found ${number}`,
        );
      }
      if (!currentCase.actions.has(number)) {
        throw formatError(
          currentCase.lineNumber,
          `步骤描述${number} is missing`,
        );
      }
      if (!currentCase.expectedResults.has(number)) {
        throw formatError(
          currentCase.lineNumber,
          `预期结果${number} is missing`,
        );
      }
    });

    testcases.push({
      case_name: currentCase.case_name,
      module_path: currentCase.module_path,
      precondition: null,
      steps: numbers.map((number) => ({
        step: number,
        action: currentCase.actions.get(number),
        expected: currentCase.expectedResults.get(number),
      })),
    });
    currentCase = null;
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === "") {
      return;
    }

    const moduleMatch = line.match(
      /^([一二三四五六七八九十百]+级模块)\s*[:：]\s*(.*)$/,
    );
    if (moduleMatch) {
      finalizeCase();
      if (modulePath.length > 0 && currentCase === null) {
        const previousLine = lines
          .slice(0, index)
          .reverse()
          .find((candidate) => candidate.trim() !== "");
        if (previousLine?.trim().startsWith("预期结果")) {
          modulePath = [];
        }
      }
      modulePath.push(requireText(moduleMatch[2], lineNumber, moduleMatch[1]));
      return;
    }

    const caseMatch = line.match(/^用例名称\s*[:：]\s*(.*)$/);
    if (caseMatch) {
      finalizeCase();
      currentCase = {
        lineNumber,
        case_name: requireText(caseMatch[1], lineNumber, "用例名称"),
        module_path: [...modulePath],
        actions: new Map(),
        expectedResults: new Map(),
      };
      return;
    }

    const actionMatch = line.match(/^步骤描述(\d+)\s*[:：]\s*(.*)$/);
    if (actionMatch) {
      if (!currentCase) {
        throw formatError(lineNumber, "步骤描述 appears before 用例名称");
      }
      const number = Number(actionMatch[1]);
      if (currentCase.actions.has(number)) {
        throw formatError(lineNumber, `duplicate 步骤描述${number}`);
      }
      currentCase.actions.set(
        number,
        requireText(actionMatch[2], lineNumber, `步骤描述${number}`),
      );
      return;
    }

    const expectedMatch = line.match(/^预期结果(\d+)\s*[:：]\s*(.*)$/);
    if (expectedMatch) {
      if (!currentCase) {
        throw formatError(lineNumber, "预期结果 appears before 用例名称");
      }
      const number = Number(expectedMatch[1]);
      if (currentCase.expectedResults.has(number)) {
        throw formatError(lineNumber, `duplicate 预期结果${number}`);
      }
      currentCase.expectedResults.set(
        number,
        requireText(expectedMatch[2], lineNumber, `预期结果${number}`),
      );
      return;
    }

    throw formatError(lineNumber, `unsupported field: ${line}`);
  });

  finalizeCase();
  if (testcases.length === 0) {
    throw new Error("No testcases found");
  }

  return { testcases };
}
