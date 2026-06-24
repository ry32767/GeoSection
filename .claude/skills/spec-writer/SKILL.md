---
name: spec-writer
description: >-
  Turn a feature request or rough idea into an implementation-ready technical
  design spec — grounded in the actual codebase, committing to the load-bearing
  decisions with concrete values, plus component/file-level changes, edge cases,
  testable acceptance criteria, and a step-by-step plan. Use this whenever the
  user wants to design, plan, or spec out a feature, change, or system before
  coding — phrases like "write a spec", "design doc", "技術設計", "仕様書", "設計して",
  "how should I build X", "plan this feature", "technical design for ...", or when
  they describe something they want to add/change and ask how to implement it.
  Prefer this skill even when the user never says the word "spec": any "I want to
  add/change X — how should it work?" is a trigger. Match the user's language in
  the output.
---

# spec-writer

A feature request is a wish. A technical design spec is the bridge from that
wish to code someone can actually write. Your job with this skill is to build
that bridge: take a request that may be vague, partial, or optimistic, and turn
it into a document an engineer could pick up and implement without having to
re-derive every decision.

There are two ways a spec fails, and they pull in opposite directions, so watch
for both:

1. **It restates the request in headings.** "We will add KML import. KML import
   will let users import KML." Worthless — it adds nothing the requester didn't
   already have.
2. **It hedges the hard parts into "open questions."** It looks thorough — real
   sections, real edge cases — but every decision that actually matters is
   deferred: the threshold is "around 0.6", the boundary behavior is "TBD", the
   tricky call is punted to a human. A spec that doesn't decide the load-bearing
   things isn't a design; it's a list of things someone else still has to design.

A good spec earns its length by making *committed decisions*: where the data
lives, which existing pieces change, what the actual threshold is, what happens
when the input is malformed, how you'll know it works.

## Habit 1: Ground in reality first

Before designing anything, look at what already exists. If there is a codebase,
read the relevant parts. If there is a system or product, understand how it
works today. A spec written in a vacuum invents plausible-sounding components
that don't match reality, and the engineer who implements it spends the first
day discovering your design doesn't fit. So your first move is almost always
investigation, not writing:

- **Find the real entry points and data structures.** What parses the input
  today? What shape is the data once parsed? What renders the output? Name the
  actual files, functions, and structures — `app.js`'s `parseGpx`, the
  `{lat, lon, elevation, node}` point shape, the `<canvas>` the chart draws to —
  not generic placeholders. Specs that cite real line numbers and real function
  contracts are the ones reviewers trust.
- **Understand the current behavior you must not break.** Most features are
  *additions* to a working system, and the most common way a spec fails is by
  silently changing something that already works. State explicitly what current
  behavior must be preserved, and point at the exact code that guarantees it.
- **Honor the grain of the system.** A static GitHub Pages app can't add a
  backend. A vanilla-JS project shouldn't pull in React for one feature. Design
  with the existing constraints, not against them.

## Habit 2: Find the load-bearing decision, and get *it* right

Most features hinge on one or two decisions that everything else depends on. For
"merge multi-day GPX into one profile" it's *how distance accumulates across the
day boundary*. For "OCR receipts into a form" it's *the confidence threshold and
what happens below it*. Identify that decision explicitly, then reason about it
from **what the problem actually needs to be correct** — not from what reuses the
most existing code.

This matters because the easy path and the correct path often diverge exactly
here, and the easy path fails *silently*:

> Feeding three concatenated days straight into the existing distance function
> reuses the most code and looks clean — but it adds a bogus straight-line jump
> between each day's end and the next day's start, and smears the slope average
> across the boundary. "Reuse the existing function" produced a subtly wrong
> artifact for the exact use case requested.

Reuse and simplicity are tiebreakers, not the goal. When you take the
reuse-friendly path, prove it's also *correct* for this problem — and if it
isn't, say so and do the harder thing. Naming the failure mode of the lazy path
is often the most valuable sentence in the spec.

## Habit 3: Commit to the decision; quarantine the genuine unknowns

When you reach a decision the spec can make, **make it** — pick a specific,
named value and justify it in a sentence. "Confidence threshold: 0.80 — below
this, prefill the field but flag it ⚠ for human confirmation." Not "around 0.6,
TBD." Concrete numbers, exact formats, specific orderings, named Block Kit
element types, real retry counts. A reviewer can push back on `0.80`; they can't
push back on "around 0.6."

"Open questions" exist only for things that genuinely require a **human or
product call** the spec has no authority to make — "do we support multi-currency
in v1?", "which OCR vendor are we contractually allowed to use?". Anything you
*could* decide with engineering judgment, decide. The test: if you could pick a
sensible default and move on, that's a decision, not an open question. Punting it
to a list is the #1 thing that makes a thorough-looking spec un-implementable.

(You can still record the alternatives you rejected and why — that's valuable.
The point is that the *recommended path is chosen*, not left as a menu.)

## What a good spec contains

Use this as a thinking checklist, not a form to fill out. A small change doesn't
need every section; a gnarly one may need more. Write in the user's language.

```
# 技術設計仕様: <feature name>

## 1. 背景と目的 (why)            なぜやるか。成功した状態。
## 2. スコープ (goals / non-goals) やる/やらないを箇条書き。non-goals が曖昧さを潰す。
## 3. 現状 (what exists today)     今どう動くか。壊せない挙動を実ファイル・実関数で名指し。
## 4. 設計 (the core)             データモデル → 影響コンポーネント → 処理フロー → IF変更。
##                               中心となる決定を具体値で確定させる。
## 5. エッジケースとエラー処理      壊れた入力・欠損・境界・競合。各ケースで何が起きるべきか。
## 6. 受け入れ基準 / テスト計画     「完成」の条件を観測可能・検証可能な形で。具体的な数値で。
## 7. 代替案と未解決の論点         却下した案と理由（推奨は確定済み）。人間が決めるべき事だけ open。
## 8. 実装ステップ                レビュー可能な小単位に割った順序付き計画。
```

## Principles that make each section pull its weight

**Decide the data first.** Most design difficulty lives in the data model.
Settle the internal representation early — e.g. "normalize both GPX and KML into
one `{points: [{lat, lon, ele, dist}], bounds, name}` shape so the map and chart
code stay unchanged" — and the component changes usually fall out of it.

**Anchor every change to a real component.** "Update the parser" is vague. "In
`app.js`, add `parseKML(text)` alongside `parseGpx`, both returning the
normalized shape; the file-drop handler dispatches on extension" is
implementable. Name files and functions wherever you can.

**Treat edge cases as design, not garnish.** The interesting engineering is
usually in the failure modes: KML without elevation, a one-point track, two
uploads racing, a 50 MB file, an OCR misread of "total" vs "change". Listing
these — and deciding what happens for each — is often where a spec proves it
understands the problem.

**Write acceptance criteria a tester could run.** "Works correctly" is not
testable. "Uploading a valid KML renders a track and a profile with the same
point count as the source coordinates; uploading a `.txt` shows an inline error
and leaves existing tracks untouched" is. Put real numbers on it where the domain
has them (target accuracy, latency budget, point counts).

**Right-size the depth.** A spec longer than the feature warrants buries the real
decisions in ceremony. Spend words where the risk and ambiguity are; move fast
through the obvious parts. Code sketches should be correct and illustrative — a
garbled snippet in the one spot that matters undermines trust.

## Examples

**Restatement (bad):** "We will add multi-day GPX support. Users will load
multiple files. They'll be shown together. Distance will be cumulative." — the
request with bullet points; no engineer learns anything.

**Hedge (bad):** "Distance accumulation across the day boundary is an open
question. Confidence threshold should be tuned later (~0.6?). UI affordances
TBD." — looks like a spec, decides nothing load-bearing.

**Committed decision (good):** "Load order = user-specified file order, falling
back to first-trackpoint timestamp. Concatenate into one normalized track where
each day's `dist` **re-bases** to continue from the previous day's final `dist`
*without* adding the geographic gap between days (Day1's end and Day2's trailhead
are far apart; the straight-line jump would corrupt the profile and smear the
slope moving-average across the boundary). Tag each point with `segment`; the
chart colors by `segment` and draws a divider at each boundary. Single-file is
the N=1 case, unchanged." — commits to ordering, the cumulative-distance
mechanism, the boundary handling *and its failure mode*, the coloring data, and
preserves existing behavior.

## Workflow

1. **Investigate.** Read the relevant code / understand the current system.
   Identify real entry points, data shapes, and behavior you must preserve.
2. **Name the load-bearing decision(s)** and reason them out from what
   correctness requires. Check whether the reuse-friendly path is actually right.
3. **Decide the data model.** Settle the internal representation; most else
   follows.
4. **Draft the spec** using the checklist, committing to specific values.
5. **Pressure-test it as the implementing engineer.** Could you build this
   without inventing missing pieces or making a deferred decision yourself? Is
   every load-bearing call actually made? Are the failure modes covered? Are the
   acceptance criteria checkable with concrete numbers? Cut anything that's
   ceremony rather than a decision.
6. **Quarantine, don't bury, the unknowns.** End with only the questions a human
   or product owner must answer — everything else, you decided.
