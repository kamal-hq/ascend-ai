/**
 * Strict URL sanitizer for external & LLM-generated links.
 * Allows only absolute http:// or https:// URLs and rejects javascript:, data:, vbscript:, etc.
 */
export function toSafeHttpUrl(raw?: string | null): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}
