// Quality heuristic for assistant responses.
// Flags responses that are too short or carry AI-apology phrases.
// DX 3A: callers can use this to decide whether to retry the LLM call.

const MIN_LENGTH = 40;

const GENERIC_PATTERNS: RegExp[] = [
  /\bas an ai\b/i,
  /\bi'?m an ai\b/i,
  /\bi am an ai\b/i,
  /\bi cannot help\b/i,
  /\bi can'?t help\b/i,
  /\bi don'?t have personal\b/i,
];

export function isLowQualityResponse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH) return true;
  return GENERIC_PATTERNS.some((re) => re.test(trimmed));
}

