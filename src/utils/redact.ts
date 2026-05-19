const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function redactSlackText(text: string, options: { redactEmails: boolean }): string {
  if (!options.redactEmails) {
    return text;
  }
  return text.replace(emailPattern, "[redacted-email]");
}

export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, Math.max(0, maxChars - 32)) + "\n[truncated]",
    truncated: true
  };
}
