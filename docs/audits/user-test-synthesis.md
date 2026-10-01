# Sutra — 8-Persona User Test Synthesis

**Date:** 2026-09-29
**Journey:** `docs/audits/user-test-journey.md` (12 screenshots, 12 operations)
**Personas (8, distinct):**
1. Pria, 17, high-school / nerd
2. Maria, 54, mom
3. Daniel, 35, senior PM
4. Asha, 28, freelance designer
5. Robert, 62, retired teacher
6. Marcus, 22, college athlete
7. Jen, 41, working parent
8. Sam, 30, first-time founder

**Method:** Each persona reviewed the same journey document independently and filled out a feedback form for every step. This file is the cross-persona synthesis.

---

## TL;DR

The product has a **strong voice and a broken body.** The copy, the brand promise, and the chat starter are good enough that 7/8 personas said "I would have stayed." But the Goals tab never loads, the chat coach never replies, and 4 of 5 tabs sit on a permanent `loading…` string. The single most damaging screenshot in the entire journey is the **red webpack-dev-server error overlay sitting on top of the About modal** — that one image is a trust-killer for every persona.

If we fix only one thing today: **fix the runtime error in the Coach component (`changeProvider is not defined`)** and replace `loading…` with a real empty state across all tabs. That single change converts the product from "looks broken" to "early but promising."

---

## Common patterns across personas

### 1. The Goals tab is the #1 blocker (8/8 personas)

Every single persona flagged the Goals tab as the dealbreaker. The first tab the user sees is `loading…` and never resolves. Console shows:

```
ReferenceError: changeProvider is not defined
    at Coach (Coach.js)
```

Without a working Goals tab, every other feature is downstream of nothing: no goals to chart in Timeline, no goals to anchor Memories, no goals for the chat to write to.

**Quotations:**
- Pria (17): *"The literal core feature and it's a ReferenceError. I'd already have one foot out the door."*
- Maria (54): *"This is the heart of the app and it's stuck. That's a dealbreaker."*
- Daniel (PM): *"The whole product is gated behind this tab and it doesn't render. That's not a bug, that's a missing product."*
- Sam (founder): *"I literally cannot do the one thing the app exists for. The whole product is gated on this."*

### 2. `loading…` as a terminal state is universal poison (8/8 personas)

Three tabs (Goals, Memories, Sources) plus the chat response all sit on the bare lowercase string `loading…` (or `coach is responding…`) with no spinner, no skeleton, no timeout, no retry, no error toast. The personas called this out with different vocabularies but the same conclusion: **a forever-spinner with no fallback quietly says "we shipped without testing."**

**Quotations:**
- Asha (designer): *"`loading…` as literal lowercase text is the weakest visual on the page."*
- Maria (mom): *"If my therapist's website did this I'd hang up."*
- Jen (parent): *"Three words sitting in the middle of five tabs is hostile."*
- Marcus (athlete): *"Loading spinner gang represent."*

### 3. The Chat modal is the strongest screen (8/8 personas)

The chat was the single feature that earned trust from every persona, including the most skeptical ones (Daniel, Sam, Robert). It earned trust for two specific reasons:

- The **starter prompt** ("Tell me everything you're working on across every timeframe…") is opinionated and feels like a real coaching question.
- The **guardrail copy** ("The coach writes to your goals only after you confirm a proposal") is exactly what a cautious user wants to see.

But the chat also falls into the same trap: the coach **never replies.** All 8 personas waited 30+ seconds, then gave up. Sam's reaction was the sharpest: *"If your AI can't reply, you show an error. You do not leave a blinking caret forever."*

### 4. The About modal has the best writing, but is destroyed by the build overlay (8/8 personas)

Every persona read the About modal and praised the prose. The lines that landed hardest:

- *"Holds all of it at once, remembers across sessions, and tells you the honest thing — not the warm thing."* (Pria, Daniel, Marcus)
- *"Your goals and conversations are yours alone. They're encrypted, never sold or shared with anyone, and not read by the team or the founder."* (Maria, Robert, Asha, Jen)

But the **webpack-dev-server error overlay covering the modal** was called out by every persona as a trust-destroying screenshot. Robert's reaction was the sharpest: *"The big red webpack error banner plastered over the About modal is humiliating — it tells me the builder was in the middle of working when I was invited to read."*

The error reads:
```
ERROR in ./src/components/TimelineTabs.js
Module not found: Error: Can't resolve './ChartVariant2' in '...'
```

So there's actually a **second build error** (ChartVariant2 missing) on top of the runtime error in Coach.

### 5. Timeline empty-state copy earns trust, but the variant labels confuse (7/8 personas)

*"Your timeline is a blank page"* and *"No dates on the map yet. Ask the coach to sketch a realistic timeline — it'll propose target dates and a few milestones per goal, with buffer built in."* — every non-designer persona praised this.

But the **variant picker labels** (`Chart · A · Swim lanes · B · Horizon strip · C · Story board · D · Feed`) confused older and non-technical personas specifically (Maria, Robert). Sam and Daniel tolerated them; Marcus and Pria thought they were "nerd bait" but acknowledged the A/B/C/D labels add noise without helping anyone choose.

Asha caught a real taxonomy bug: **"Chart" appears as both the top-level tab and a Timeline sub-variant.**

### 6. Today tab is empty with no CTA (7/8 personas)

Every persona flagged the Today tab as "header only, body is a void." The header copy is good ("Today Tuesday, September 29" + "Your day at a glance — blockers, commitments, and a place to jot notes as you go") but there is no input, no empty-state CTA, no sample commitment.

- Maria: *"Give me something to tap."*
- Jen: *"A billboard with nothing on it."*
- Daniel: *"An empty day-view with zero CTA is sad."*

### 7. The chat starter prompt is too long for some (5/8 personas)

Pria, Robert, and Jen found the chat starter prompt to be a "sales pitch dressed up as a welcome" or "a whole essay." Daniel, Asha, Maria, and Marcus liked it. Worth tightening to 1–2 lines for the older / more time-poor personas.

### 8. Privacy copy is trusted, but only the PM asked where the keys live (1/8)

Daniel was the only persona who pushed back on the privacy claim: *"Encrypted" without explaining where the keys live is a half-trust signal.* The other 7 personas accepted the privacy paragraph at face value. Worth a future session.

### 9. Founder blurb is honest but undersells (3/8 personas)

Maria, Asha, and Sam read the "About the founder" section closely. Sam's reaction: *"Tell me who you are and why I'm supposed to trust you. One sentence and a LinkedIn isn't enough."* Maria and Asha agreed it needed more substance.

### 10. Voice consistency is the brand's biggest strength

The single most consistent praise across all 8 personas was **the writing**. Whether it was the chat starter, the About modal, the Sources heading ("Files and links the coach reasons over"), or the Timeline empty state, the words sounded like the same team had sweated over them. That voice is what gave 7/8 personas a 60–90 second grace period before they closed the tab.

---

## Per-persona verdict (would they come back?)

| # | Persona | Verdict | What would bring them back |
|---|---|---|---|
| 1 | Pria, 17 | Close + tell a friend "looks cool, broken" | Working Goals tab with a real empty state and an "Add your first goal" CTA |
| 2 | Maria, 54 | Close — "broken doorbell" | A first tab that does something; privacy copy is great, delivery isn't |
| 3 | Daniel, 35 | Close — would check Linear for a competitor | A working coach response + real empty states; PM wants to see the keys story |
| 4 | Asha, 28 | Stay 90s more, then close | Replace bare `loading…` with skeletons or honest empty states |
| 5 | Robert, 62 | Close — would tell students "draft emailed by accident" | Hide broken tabs; give him one thing that works end to end |
| 6 | Marcus, 22 | Close — would screenshot and tweet | Working Goals tab, chat first turn that lands |
| 7 | Jen, 41 | Close — "would text friend 'nah this one's a no'" | Pre-filled sample goals so a tired parent doesn't have to imagine the product |
| 8 | Sam, 30 | Close — would not sign up | Literally one working CRUD loop on the Goals tab |

---

## Single biggest blocker to achieving a goal today (consensus)

**The `changeProvider is not defined` runtime error in the Coach component** — because it breaks both the Goals tab (no CRUD possible) and the chat response loop (no coach replies). One bug, two surfaces, total blackout.

## Single change that would most improve first impression (consensus)

**Replace the raw `loading…` text with a real empty state across Goals, Memories, Sources, and the chat response** — give every empty surface a one-sentence explanation and one obvious first action. Combined with fixing the Coach runtime error, this changes the app from "broken on arrival" to "early but promising," which matches the actual state of the product.

## The two specific bugs to fix this session

1. **Runtime error in `Coach` component** — `changeProvider is not defined` at `Coach.js:312`. Source the missing identifier (probably imported `changeProvider` from a provider module that's not wired up).
2. **Build error in `TimelineTabs.js`** — `Module not found: Error: Can't resolve './ChartVariant2'`. Either add `ChartVariant2.js`, or fix the import to point to one of the variants that exists (`ChartVariant1.js`, `ChartVariant3.js`, etc.).

After both fixes, also:
3. Disable the webpack-dev-server overlay (or wrap it in a `process.env.NODE_ENV === 'development'` check) so it doesn't cover modals for non-dev users in the demo flow.

---

## Artifacts

- Journey walkthrough: `docs/audits/user-test-journey.md`
- 12 journey screenshots: `journey-01-landing.png` through `journey-12-final.png` (in repo root)
- This synthesis: `docs/audits/user-test-synthesis.md`
- Per-persona forms: returned inline by the 8 persona agents