export function extractStyleHint(input: { before: string; after: string }): string | undefined {
  const before = input.before.trim();
  const after = input.after.trim();
  if (!before || !after || before === after) {
    return undefined;
  }

  const hints: string[] = [];
  const beforeLower = before.toLowerCase();
  const afterLower = after.toLowerCase();

  if (/\b(need|missing|before i can|not enough|unclear|i may be missing)\b/.test(afterLower) && !/\b(need|missing|before i can|not enough|unclear|i may be missing)\b/.test(beforeLower)) {
    hints.push("adds uncertainty or missing-context language");
  }
  if (after.includes("\n- ") || after.includes("\n* ")) {
    hints.push("uses bullets for clarity");
  }
  if (after.length < before.length * 0.8) {
    hints.push("prefers a shorter reply");
  }
  if (after.length > before.length * 1.25) {
    hints.push("adds more context before replying");
  }
  if (/\bI\b/.test(after) && !/\bI\b/.test(before)) {
    hints.push("uses first-person wording");
  }

  if (hints.length === 0) {
    hints.push("edited wording before posting");
  }

  return `User ${hints.join(", ")}.`;
}
