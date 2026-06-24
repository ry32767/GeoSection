---
name: spec-writer
description: >-
  Turn a feature request or rough idea into an implementation-ready technical
  design spec — grounded in the actual codebase, with concrete data models,
  component/file-level changes, edge cases, testable acceptance criteria, and a
  step-by-step plan. Use this whenever the user wants to design, plan, or spec
  out a feature, change, or system before coding — phrases like "write a spec",
  "design doc", "技術設計", "仕様書", "設計して", "how should I build X", "plan this
  feature", "technical design for ...", or when they describe something they want
  to add/change and ask how to implement it. Prefer this skill even when the user
  never says the word "spec": any "I want to add/change X — how should it work?"
  is a trigger. Match the user's language in the output.
---

# spec-writer

A feature request is a wish. A technical design spec is the bridge from that
wish to code someone can actually write. Your job with this skill is to build
that bridge: take a request that may be vague, partial, or optimistic, and turn
it into a document an engineer could pick up and implement without having to
re-derive every decision.

The trap to avoid is writing a spec that just **restates the request in
headings**. "We will add KML import. KML import will let users import KML." That
is worthless — it adds no information the requester didn't already have. A good
spec earns its length by making *decisions*: where the data lives, which
existing pieces change, what happens when the input is malformed, how you'll
know it works.

## The one habit that separates good specs from bad ones: ground in reality first

Before designing anything, look at what already exists. If there is a codebase,
read the relevant parts of it. If there is a system or product, understand how
it works today. A spec written in a vacuum invents plausible-sounding components
that don't match reality, and the engineer who implements it spends the first
day discovering your design doesn't fit.

So your first move is almost always investigation, not writing:

- **Find the real entry points and data structures.** What file parses the
  input today? What shape is the data once parsed? What renders the output?
  Name the actual files, functions, and structures — `app.js`'s GPX parser, the
  `profile` array, the `<canvas>` the chart draws to — not generic placeholders.
- **Understand the current behavior you must not break.** Most features are
  *additions* to a working system. The single most common way a spec fails is by
  silently changing something that already works. State explicitly what current
  behavior must be preserved.
- **Notice the constraints the environment imposes.** A static GitHub Pages app
  can't add a backend. A vanilla-JS project shouldn't pull in React for one
  feature. Honor the grain of the existing system instead of fighting it.

When grounding reveals that the request is ambiguous or has hidden choices, that
is a feature, not a problem — surface those as decisions or open questions
rather than papering over them.

## What a good spec contains

Use this structure as a default. Adapt it to the feature — a small change
doesn't need every section, and a gnarly one may need more. The headings are a
checklist of "did I think about this?", not a form to fill out. Write in the
user's language.

```
# 技術設計仕様: <feature name>

## 1. 背景と目的 (why)
   なぜこれをやるのか。解決する問題と、この変更が成功した状態。

## 2. スコープ (goals / non-goals)
   やること / やらないこと を箇条書きで。non-goals が曖昧さを一番よく潰す。

## 3. 現状 (what exists today)
   今どう動いているか。壊してはいけない既存挙動を明示する。
   実在のファイル・関数・データ構造を名指しする。

## 4. 設計 (the design — this is the core)
   - データモデル / データ構造: 入力をどんな内部表現に正規化するか
   - 影響を受けるコンポーネント: ファイル / 関数 / モジュール単位で、何を足し何を変えるか
   - 処理フロー: 入力から出力までの流れ（必要なら手順 or 簡単な図）
   - インターフェース変更: API / 関数シグネチャ / UI の変化

## 5. エッジケースとエラー処理
   壊れた入力、欠損データ、境界値、競合状態。各ケースで何が起きるべきか。

## 6. 受け入れ基準 / テスト計画
   「完成した」と言える条件を、検証可能な形で。観測できる振る舞いで書く。

## 7. リスク・代替案・未解決の論点
   検討した別案となぜ採らなかったか。残っている判断・確認したいこと。

## 8. 実装ステップ
   レビュー可能な小さい単位に割った、順序付きの計画。
```

## Principles that make each section pull its weight

**Make decisions, not restatements.** Every section should contain at least one
thing the requester didn't already say. If a section only echoes the request,
cut it or add the missing decision.

**Be concrete about the data first.** Most design difficulty lives in the data
model. Decide the internal representation early — e.g. "normalize both GPX and
KML into a single `{points: [{lat, lon, ele, dist}], bounds, name}` shape so the
map and chart code stay unchanged." Once the data shape is right, the component
changes usually fall out of it.

**Anchor changes to real components.** "Update the parser" is vague. "In
`app.js`, add `parseKML(text)` alongside the existing `parseGPX`, both returning
the normalized track shape; the file-drop handler dispatches on extension" is
implementable. Name files and functions wherever you can.

**Treat edge cases as part of the design, not an afterthought.** The interesting
engineering is usually in the failure modes: KML without elevation, a GPX with
one point, two uploads racing, a 50 MB file. Listing these is often where a spec
proves it actually understands the problem.

**Write acceptance criteria you could hand to a tester.** "Works correctly" is
not testable. "Uploading a valid KML renders a track on the map and a profile
with the same point count as the source coordinates; uploading a `.txt` shows an
inline error and leaves existing tracks untouched" is.

**Right-size the depth.** A spec that's longer than the feature warrants is its
own failure — it buries the real decisions in ceremony. Spend words where the
risk and ambiguity are; move fast through the obvious parts.

## Examples

**Restatement (bad):**
> We will add multi-day GPX support. Users will be able to load multiple GPX
> files. The files will be shown together. Distance will be cumulative.

This is just the request with bullet points. No engineer learns anything.

**Decision (good):**
> Load order is the user-specified file order, falling back to the first
> trackpoint timestamp when available. Concatenate into one normalized track
> where each day's `dist` continues from the previous day's final `dist` (so the
> X axis is monotonic across days), and tag each point with a `segment` index.
> The chart colors by `segment` and draws a thin divider at each boundary. This
> keeps the single-file path untouched: one file is just the N=1 case.

The good version commits to ordering, the cumulative-distance mechanism, the
data tag that drives coloring, and an explicit note that the existing
single-file behavior is preserved as a degenerate case.

## Workflow

1. **Investigate.** Read the relevant code / understand the current system.
   Identify real entry points, data shapes, and the behavior you must preserve.
2. **Decide the data model.** Settle the internal representation first; most
   other decisions follow from it.
3. **Draft the spec** using the structure above, making concrete decisions.
4. **Pressure-test it.** Reread as the implementing engineer: could you build
   this without inventing missing pieces? Are the failure modes covered? Are the
   acceptance criteria actually checkable? Tighten or cut anything that's
   ceremony rather than a decision.
5. **Surface, don't bury, the unknowns.** End with the open questions and risks
   so the reader knows exactly what still needs a human call.
