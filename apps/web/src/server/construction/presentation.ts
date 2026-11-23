export function estimateAmount(minor: string) {
  const total = BigInt(minor);
  const whole = total / 100n;
  const fraction = (total % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

const results: Record<string, string> = {
  created: "Project created.",
  added: "Line added to the estimate.",
  removed: "Line removed from the estimate.",
  invalid: "Check the details and try again.",
  limit: "An estimate can have up to 250 lines.",
  missing: "The project is unavailable.",
  "missing-line": "The line is unavailable.",
  forbidden: "Your workspace, role or subscription does not allow this action.",
};

export function constructionResult(code?: string) {
  return code && Object.hasOwn(results, code) ? results[code] : undefined;
}
