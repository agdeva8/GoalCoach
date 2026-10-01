# Sutra — User Test Journey (Recorded Session)

**Recorded:** 2026-09-29
**Tester:** Claude (with Playwright Chrome browser)
**URL:** http://localhost:3000 (dev server)
**Tagline on landing page:** "Sutra — let's sort your life, together."

> **Note on recording format:** The Chrome DevTools MCP browser does not support video recording directly. The journey is documented as a step-by-step sequence with screenshots taken at each operation. All 12 screenshots are stored next to this file as `journey-01-landing.png` through `journey-12-final.png`. Review the screenshots and the step descriptions to evaluate each operation.

---

## STEP 1 — Land on the home page
**Screenshot:** `journey-01-landing.png`

The browser opens at `http://localhost:3000/`. The page renders a header banner:
- Brand: **"Sutra"**
- Subtitle: **"let's sort your life — together."**
- Top-right controls: **"About Sutra, privacy & the founder"** (info icon) and a **theme toggle** ("Switch to dark theme" / "Switch to light theme")

Below the banner is a 5-tab navigation row: **Goals · Today · Timeline · Memories · Sources**.

A floating action button at the bottom-right reads: **"Chat with your coach"**.

The default active tab is **Goals**. The Goals panel shows the text **"loading…"** indefinitely on first paint.

---

## STEP 2 — Wait 2 seconds (as requested by the test plan)
**Screenshot:** `journey-01-landing.png`

After the prescribed 2-second wait, the Goals panel still reads **"loading…"** — it never resolves. Console shows a runtime error:

```
ReferenceError: changeProvider is not defined
    at Coach (http://localhost:3000/main.fcd439637cfe5d45217a.hot-update.js:312:19)
```

This is a fatal error in the `Coach` component (likely the Goals container). The Goals tab is **completely broken** — no goal can be created, updated, or deleted from the UI.

---

## STEP 3 — Switch to the Today tab
**Screenshot:** `journey-02-today.png`

The Today tab loads successfully. It shows:
- Heading: **"Today Tuesday, September 29"**
- Body: *"Your day at a glance — blockers, commitments, and a place to jot notes as you go."*

The body content beneath the heading is otherwise empty — no blockers, commitments, or notes appear.

---

## STEP 4 — Switch back to Goals (re-test)
**Screenshot:** `journey-03-goals-broken.png`

Goals tab is still stuck on **"loading…"** with the same runtime error. There is no way to create, edit, or delete a goal from this tab.

---

## STEP 5 — Switch to Timeline
**Screenshot:** `journey-04-timeline.png`

The Timeline tab loads. It has a secondary tab strip: **Chart · A · Swim lanes · B · Horizon strip · C · Story board · D · Feed** with a small "pick a style" hint.

Default selection is **Chart**, which shows:
- Heading: **"Your timeline is a blank page"**
- Body: *"No dates on the map yet. Ask the coach to sketch a realistic timeline — it'll propose target dates and a few milestones per goal, with buffer built in."*
- CTA button: **"Ask the coach to build my timeline →"**

The Timeline page is functional but empty — there are no goals to chart because the Goals tab is broken.

---

## STEP 6 — Switch to Memories
**Screenshot:** `journey-05-memories.png`

The Memories tab partially loads:
- Heading: **"Memories"**
- Body: *"Photos and posts that anchor your goals — what's the why, what does it look like?"*
- CTA button: **"Add memory"** (top-right)

Below the header, the panel again shows **"loading…"** indefinitely. The "Add memory" button is visible but the list never populates.

---

## STEP 7 — Switch to Sources
**Screenshot:** `journey-06-sources.png`

The Sources tab partially loads:
- Heading: **"Sources"**
- Body: *"Files and links the coach reasons over — reference material that grounds your goals."*

Below the header, the panel again shows **"loading…"** indefinitely. No sources appear.

---

## STEP 8 — Open the Chat
**Screenshot:** `journey-07-chat.png`

Tapping the **"Chat with your coach"** floating button opens a modal dialog titled **"Chat with your coach"** with the subhead *"Ask anything. The coach writes to your goals only after you confirm a proposal."*

The chat log contains a single starter message labeled **"start here"**:
> *"Tell me everything you're working on across every timeframe — the career move, the body, the side thing, the relationship. Say 'I have N goals across different time horizons; help me figure out this week.' I'll tell you what deserves attention, what you're over-committing to, and where you've drifted."*

The input row at the bottom has: a paperclip **"Attach a file (PDF, .md, .txt…) as a source"**, a link **"Add a link as a source"**, a textbox **"Message the coach"** (placeholder *"Think out loud…"*), a microphone **"Dictate with your voice"**, and a disabled **Send** button. A small **"coach may ask"** suggestion chip sits below the input. Footer hint: *"enter to send · shift+enter = newline"*.

---

## STEP 9 — Send a chat message
**Screenshot:** `journey-08-chat-message.png`

Typed into the message box and submitted:
> *"I want to learn React, finish my novel, and get fit. Help me plan."*

The message appears in the log under **"you"**. The coach label appears with a streaming caret **"▋"** and the input footer changes to **"coach is responding…"** — but the response never arrives. After 30+ seconds the chat is still stuck on the typing indicator. Because the Coach component has the `changeProvider` runtime error, the chat backend cannot complete its first turn.

A **Clear** button appears in the chat header once a message is sent.

---

## STEP 10 — Wait for the coach to respond
**Screenshot:** `journey-09-coach-response.png`, `journey-10-coach-wait.png`

The coach response never lands. The chat stays on the **"▋"** typing indicator with **"coach is responding…"** footer indefinitely. No error is surfaced to the user.

---

## STEP 11 — Close the chat and open About
**Screenshot:** `journey-11-about.png`

Closing the chat returns to the underlying tab (still Sources, still loading). Tapping **"About Sutra, privacy & the founder"** opens a centered modal titled **"About Sutra"** with subhead **"let's sort your life — together."** and four content sections:

1. **Lead paragraph** — *"You're running a career move, a body you want back, a side project, a relationship you keep meaning to invest in. Each one makes sense alone. What doesn't is what deserves attention this week, what's blocking what, and what you promised yourself at 11pm last Tuesday. Sutra holds all of it at once, remembers across sessions, and tells you the honest thing — not the warm thing."*
2. **"A coach, not a to-do list"** — *"It doesn't just capture goals — it maps a realistic path to each one. Ask it to lay out your timeline and zoom from the year down to the week. It sequences milestones, pads for real life, and works around blockers you name (a sibling's wedding in December, a launch crunch) so the plan survives contact with reality."*
3. **"Upcoming — headed your way"** — list: Calendar view & scheduling · Weekly / daily timetable builder · Reminders & nudges · Habit & progress trackers
4. **"Your data, privately"** — *"Your goals and conversations are yours alone. They're encrypted, never sold or shared with anyone, and not read by the team or the founder. The honesty audit lets you export everything at any time."*
5. **"About the founder"** — *"Building Sutra as its own first user — a self-directed IC juggling a career pivot, a fitness rebuild, side projects, and a life."* with a LinkedIn link.

The About modal also surfaces a full-screen red **webpack-dev-server** overlay (build error banner) on top of it. The overlay reports:

```
ERROR in ./src/components/TimelineTabs.js 8:0-44
Module not found: Error: Can't resolve './ChartVariant2' in '/Users/deva/.../frontend/src/components'
Did you mean './ChartVariant1.js'?
```

So in addition to the runtime error in Coach, the Timeline component also fails to **build**. The Chart variant of Timeline tab is therefore broken at the bundle level.

---

## STEP 12 — Final state
**Screenshot:** `journey-12-final.png`

After dismissing the build overlay and closing the modal, the user lands back on the broken Sources tab (still showing **"loading…"**). All 5 tabs are unreachable for their primary purpose:
- **Goals** — broken (runtime error, no goal CRUD possible)
- **Today** — renders header but body is empty (no data)
- **Timeline** — empty state shown but Chart variant bundle broken
- **Memories** — header rendered, list stuck loading
- **Sources** — header rendered, list stuck loading

The **Chat with your coach** is the only feature with a working entry point, but it cannot complete a turn due to the same Coach runtime error.

---

## Operations attempted (per the test plan)

| Operation | Result |
|---|---|
| Open landing page | ✅ Works |
| Wait 2 seconds | ✅ Works |
| Create a goal | ❌ Blocked — Goals tab stuck on "loading…" |
| Update a goal | ❌ Blocked — Goals tab stuck on "loading…" |
| Delete a goal | ❌ Blocked — Goals tab stuck on "loading…" |
| Create another goal | ❌ Blocked — Goals tab stuck on "loading…" |
| Create a milestone | ❌ Blocked — no milestones UI reachable |
| Open Today tab | ✅ Loads, empty |
| Open Timeline tab | ✅ Loads, empty |
| Open Memories tab | ⚠️ Header renders, list stuck loading |
| Open Sources tab | ⚠️ Header renders, list stuck loading |
| Open Chat | ✅ Modal opens |
| Send a chat message | ⚠️ UI accepts the message; coach never responds |
| Open About modal | ✅ Works (once overlay dismissed) |
| Toggle dark/light theme | ✅ Works |
| Close chat / close modals | ✅ Works |

---

## Known bugs observed

1. **Runtime error in `Coach`**: `ReferenceError: changeProvider is not defined` at `Coach` component — crashes Goals tab and breaks chat coach response loop.
2. **Build error in `TimelineTabs`**: cannot resolve `./ChartVariant2` — `ChartVariant1.js` exists but `ChartVariant2` does not.
3. **Memories list never populates** — stuck on loading.
4. **Sources list never populates** — stuck on loading.
5. **Today body is empty** with no data and no obvious empty-state CTA.
6. **Webpack overlay covers modals** — when a build error is active, modals are obscured by the red overlay until the user manually dismisses it.
7. **No retry/error UI** for the broken coach response — user is left looking at a typing cursor forever.

---

## Things the personas should evaluate

For each step above, score on:
1. **Clarity** — Does the user understand what is happening or what to do next?
2. **Confidence** — Does the user feel in control, or anxious/lost?
3. **Speed** — Does the page feel responsive, or sluggish/broken?
4. **Trust** — Does the UI feel trustworthy (privacy copy, About modal, brand tone)?
5. **Aesthetic** — Does it feel like a premium coaching product, or generic?

Also call out:
- The single biggest blocker to actually achieving a goal in the product today.
- The single change that would most improve first impression.
- Any copy or layout that felt off.
- Anything that made you want to keep going vs. close the tab.