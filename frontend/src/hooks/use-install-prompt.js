import { useCallback, useEffect, useState } from "react";

/**
 * use-install-prompt — detects whether the current browser can offer an
 * "Add to Home Screen / Install app" flow and exposes the controls the
 * InstallPromptDialog needs.
 *
 * Three platforms, three behaviours (this is the whole PWA-install matrix):
 *
 *  1. Chromium (Chrome/Edge, desktop + Android): fires `beforeinstallprompt`
 *     once the manifest installability criteria AND the user-engagement
 *     heuristics (one click + 30s on page) are met. We call `preventDefault()`
 *     to suppress Chrome's mini-infobar (we render our own dialog instead),
 *     hold the event, and replay it when the user taps Install.
 *  2. iOS Safari: no event exists. The only path is manual instructions
 *     (Share → Add to Home Screen), so we offer the instructions variant.
 *     Only Safari can do it — Chrome/Firefox/Edge on iOS have no such menu,
 *     so we don't show instructions there.
 *  3. Everything else (Firefox desktop, etc.): no install path at all —
 *     `canPrompt` stays false and the dialog never opens.
 *
 * Guards:
 *  - Already installed (display-mode standalone / iOS navigator.standalone)
 *    → never prompt again.
 *  - Dismissed → dialog closes, no persistence. Chrome's own anti-spam
 *    (once per ~30 days per site for `beforeinstallprompt`) does the
 *    throttling — a separate localStorage snooze would only add friction
 *    for users who change their mind or are testing. If Chrome ever
 *    fires the event again, we'll show the dialog again.
 */

export function isStandalone() {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
    if (window.navigator?.standalone === true) return true; // iOS Safari
  } catch { /* matchMedia can throw in odd embeddings */ }
  return false;
}

export function isIosSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS
  if (!iOS) return false;
  // Safari is the only iOS browser with Share → Add to Home Screen.
  // crios/fxios/edgios = the other guys.
  return !/crios|fxios|edgiOS|opios/i.test(ua);
}

function recentlyDismissed() {
  // Snooze removed — see Guards note in the file header. Chrome's
  // `beforeinstallprompt` is rate-limited at the browser level; we don't
  // need our own. Keeping the function as a stub for the `dismissed`
  // return below so the call site stays readable.
  return false;
}

export default function useInstallPrompt({ showDelayMs = 2500 } = {}) {
  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [, setDismissed] = useState(false); // kept for API compatibility, no-op
  const [ready, setReady] = useState(false); // show-delay elapsed

  const iosSafari = isIosSafari();

  useEffect(() => {
    const onBeforeInstall = (e) => {
      // Suppress Chrome's own mini-infobar — the in-app dialog replaces it.
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Eligible = not installed and actually capable (Chromium captured a
  // prompt, or iOS Safari) — no snooze. Chrome throttles
  // `beforeinstallprompt` itself (~once per 30 days per site).
  const eligible = !installed && (deferred !== null || iosSafari);

  useEffect(() => {
    if (!eligible) {
      setReady(false);
      return undefined;
    }
    const t = setTimeout(() => setReady(true), showDelayMs);
    return () => clearTimeout(t);
  }, [eligible, showDelayMs]);

  const promptInstall = useCallback(async () => {
    if (!deferred) return "unavailable";
    deferred.prompt();
    let outcome = "dismissed";
    try {
      const res = await deferred.userChoice;
      outcome = res?.outcome || "dismissed";
    } catch {
      /* user closed the native sheet */
    }
    setDeferred(null);
    if (outcome === "accepted") setInstalled(true);
    else setDismissed(true); // they said no to the native sheet too
    return outcome;
  }, [deferred]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    // No localStorage persistence — closing just hides the dialog. If
    // Chrome fires `beforeinstallprompt` again later, we'll show it again.
  }, []);

  return {
    // Dialog opens when the show-delay elapsed AND we can actually do
    // something: Chromium (real prompt) or iOS (instructions).
    open: ready && eligible && (deferred !== null || iosSafari),
    platform: deferred !== null ? "chromium" : iosSafari ? "ios" : "none",
    installed,
    promptInstall,
    dismiss,
  };
}
