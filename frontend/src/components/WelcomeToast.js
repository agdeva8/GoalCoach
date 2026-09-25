import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Sun, Moon, Sunset, Coffee, Sparkles, Check } from "lucide-react";

/**
 * WelcomeToast — a single, context-aware greeting that fires after the
 * user is authenticated (or after the first chat turn finishes, since
 * guest users land here without auth).
 *
 * Trigger rule (per the user's decision): every visit, dismissible. So
 * the same user coming back tomorrow gets the same toast — but it
 * stays short and dismissible so it's never annoying.
 *
 * Body content is derived from the server state at mount time:
 *   - "Good morning, {name}. You have N open commitments today."
 *   - "Welcome back. Last action 3 days ago was…"
 *   - "Your goals for this week:" + chip list
 *
 * Implementation note: we deliberately toast ONCE per component mount
 * (not per user action), using `useRef` to hold the fired flag. Each
 * new mount = each new session = toast. The toast itself is dismissible
 * via the Sonner `closeButton: true` option.
 */
export default function WelcomeToast({ user, state, signedIn }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (!state) return;
    firedRef.current = true;

    // Compute the body — keep it tiny.
    const greeting = greetingFor(new Date());
    const Icon = greeting.icon;
    const openCommits = (state.commitments || []).filter(
      (c) => c.status === "open",
    );
    const activeGoals = (state.goals || []).filter(
      (g) => g.status === "active",
    );
    const name = user?.name?.split(" ")[0] || "";
    const personalised = name ? `${greeting.text}, ${name}` : greeting.text;

    let body = "";
    if (activeGoals.length === 0) {
      body = "Add your first goal and we'll plan it together.";
    } else if (openCommits.length > 0) {
      const firstThree = openCommits.slice(0, 3).map((c) => c.text);
      body = `You have ${openCommits.length} open commitment${
        openCommits.length === 1 ? "" : "s"
      } today — top of the list: ${firstThree.join(" · ")}.`;
    } else {
      body = `Tracking ${activeGoals.length} active goal${
        activeGoals.length === 1 ? "" : "s"
      }. Tap the chat button when you're ready for a planning session.`;
    }

    toast(
      (t) => (
        <div data-testid="welcome-toast" className="flex items-start gap-3 pr-2">
          <Icon className="h-5 w-5 mt-0.5 shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-tight text-[var(--text-primary)]">
              {personalised}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {body}
            </div>
          </div>
        </div>
      ),
      {
        id: "gc-welcome",
        duration: 8000,
        closeButton: true,
        position: "top-right",
      },
    );
  }, [user, state, signedIn]);

  return null;
}

function greetingFor(now) {
  const h = now.getHours();
  if (h >= 5 && h < 12) {
    return { text: "Good morning", icon: Coffee };
  }
  if (h >= 12 && h < 17) {
    return { text: "Good afternoon", icon: Sun };
  }
  if (h >= 17 && h < 21) {
    return { text: "Good evening", icon: Sunset };
  }
  return { text: "Up late", icon: Moon };
}
