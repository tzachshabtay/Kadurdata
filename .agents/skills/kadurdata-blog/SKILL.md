---
name: kadurdata-blog
description: Select, analyze, write, fact-check, preview, and later publish Hebrew Kadurdata blog articles from repository data without calling a paid model API. Use for the daily Israeli-football article schedule, weekly Israeli-legionnaire summaries, league/player analysis, and approval-gated publication.
---

# Kadurdata blog

Create Hebrew football journalism from Kadurdata's own data. Do not call a paid model API. Use Codex roles for the analytical and editorial work.

## Route the request

- For a scheduled daily article, read [daily-selection.md](references/daily-selection.md).
- For a weekly legionnaire article, read [legionnaire-weekly.md](references/legionnaire-weekly.md).
- For Hebrew voice and sentence-level editing, read `../kadurdata-match-review/references/hebrew-voice-guide.md` and `../kadurdata-match-review/references/editorial-standards.md` in full.
- When the selected daily item is a match review, follow `../kadurdata-match-review/SKILL.md` in full after selection.

## Mandatory roles

Use four distinct real Codex agent contexts and record their IDs:

1. analyst: selects the thesis and evidence;
2. writer: writes the first complete Hebrew draft;
3. Hebrew editor: rewrites the visible copy sentence by sentence;
4. blind reviewer: reads the final visible copy without the editor's notes, then checks it against the evidence.

The writer, editor, and reviewer must be fresh-context agents. Do not collapse the roles into one response or invent role IDs.

## Common quality gates

- One coherent thesis comes before the list of numbers.
- Every paragraph must advance the thesis with a finding, an explanation, and a consequence.
- Prefer high-volume measures and role/style evidence. A goal or assist is context, not proof of a trend.
- Compare like-for-like time windows and normalize player volume per 90 minutes when minutes differ materially.
- A comparison with fewer than three prior substantial appearances is context only, never a claimed trend.
- Every visible number must be present in the cited evidence package.
- Graphics are selected after the story and must let the reader see a claim from the article. Do not add decorative graphics.
- Replace every em dash (`—`) in visible copy with a hyphen-minus (`-`) before language review.
- Read every visible sentence aloud. Reject translationese, analysis jargon, and phrases an Israeli sports editor would rewrite.
- Include the AI disclosure at the beginning of the article.

## Approval boundary

Generation, revision, finalization, preview, scheduling, and automation are not publication approval.

Finalize a local candidate with `status: "draft"` and `approval.status: "pending"`, serve it through the real blog components, and stop for the user's review. Run the promotion command only after the user explicitly approves that exact candidate in a later message.

