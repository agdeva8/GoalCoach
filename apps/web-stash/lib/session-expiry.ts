const WARNING_THRESHOLD_MS = 4 * 60 * 60 * 1000;

export function shouldWarnExpiry(expiresAtIso: string | null | undefined): boolean {
  if (!expiresAtIso) return false;
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  if (Number.isNaN(ms)) return false;
  return ms < WARNING_THRESHOLD_MS;
}
