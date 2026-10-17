# Story before drafting

Use for match reviews, league analysis and the weekly overview. Interesting writing begins with a worthwhile premise, not an adjective, a quota or a more dramatic headline.

## Analyst: decide whether there is a story

Before assigning the writer, fill `analysisPlan.storyBrief` in the authored package:

```json
{
  "status": "ready",
  "questionHe": "<the concrete football question>",
  "answerHe": "<one supported answer, understandable without figures>",
  "tensionHe": "<the puzzle, change, contrast or expectation that needs explaining>",
  "whyItMattersHe": "<what this changes in the reader's understanding of the match, team or player>",
  "evidenceIds": ["<decisive available evidence used later in the body>"],
  "rejectionReasonHe": ""
}
```

Write the prose fields in Hebrew. `evidenceIds` contains the evidence that distinguishes this explanation, not the entire audit. If the source cannot answer the question, use `status: "reject"` with `rejectionReasonHe` and research another premise. Do not draft around an evidence hole or turn an invented tactical cause into a more interesting story.

Run `rtk npm run content:check:story -- --source <source.json> --authored <authored.json>` before the writer starts. This checks the handoff and available citations. It cannot decide whether a premise is interesting: that is a real analyst/editor judgment, and the blind reader can still veto it. All new match, league and weekly finalizers require the brief plus the review below. Existing reviewed candidates and published articles retain their original contract.

Reject a premise whose answer is only a leaderboard, a large change in a metric, or familiar duties such as centre-backs passing, creators creating and forwards shooting. A position comparison can work when it explains a consequential difference; the positions themselves are not the explanation. Do not rescue a rejected premise by cycling through cosmetic Hebrew edits.

For example, **“Kanikovski passes, Peretz shoots”** organizes true figures but leaves the reader without a football problem or verdict. In the Maccabi–Sakhnin rewrite, **“was this only bad finishing, or did the barrage overstate the threat?”** connects shot quality, the forwards' opportunities and the late miss. The answer holds both creation and execution accountable. That is one useful shape, not a mandatory template: a comeback, sustained role change, individual comparison or weekly development can need a different arc.

## Writer and editor: make each section do a job

Open with the football problem or tension. Develop the evidence that changes the reader's understanding, explain the strongest supported relationship, and earn a clear verdict or consequence. Do not sort the article into metric families or force a chronological recap. Use a player or event when it tests the explanation, not to attach a name to another total.

For each statistic ask: would removing it change the answer, distinguish an alternative explanation, or support the consequence? If not, omit it from the body. Complete source audits and required all-player cards remain intact outside the selective main narrative. A numerical-density limit is a ceiling, not a target. Descriptive evidence may support a restrained interpretation; never manufacture causality for drama.

The editor should challenge the premise again. Remove sections that repeat the graphic or restate the same answer. If the only fix is shortening a catalogue, return to selection. Maintain source-qualified samples and evidence gates, and keep methodology in the internal record unless the reader needs a concise qualification.

## Blind reader: reconstruct the story independently

First read only final visible copy and the numberless copy, without the analyst brief, draft, editor notes or earlier verdicts. Independently state the question and answer the article leaves with the reader. After recording that first read, inspect the evidence and compare the brief with what the article actually delivers; preserve your initial assessment. Reject accurate but inconsequential role catalogues, repeated sections and summaries that offer no more than the charts.

Alongside the existing exact sentence reviews and thirteen checks, record `qualityReview.storyReview`:

```json
{
  "status": "passed",
  "briefHash": "<storyBriefHash from content:review-packet>",
  "reviewedContentHash": "<storyContentHash from content:review-packet>",
  "evidenceHash": "<evidenceHash from content:check:story on the reviewed source>",
  "summaryHe": "<your own reconstruction of the question and answer>",
  "explanationHe": "<what evidence explains the answer, rather than merely correlating with it>",
  "readerValueHe": "<what the reader learns beyond a table or familiar roles>",
  "sectionProgression": [{ "sectionIndex": 0, "addsHe": "<what this section adds beyond the preceding text>" }],
  "issues": []
}
```

Cover every main body section exactly once with its zero-based index; do not enumerate the mandatory player cards here. Use `status: "failed"` and precise issues if any body section has no distinct contribution, the numberless read has no substantive payoff, or the evidence does not support the explanation. Do not fill another agent's review. The opaque brief hash binds the eventual review without giving the blind reader the analyst's conclusions.

Finalization checks evidence use, complete section assessment, exact final/numberless hashes and the brief/content/evidence hashes. The content hash also binds the full graphic settings (metrics, selected players, groups and placement), including settings with no text change. The evidence hash binds the full decisive evidence payloads, so corrected events or contexts under unchanged citation IDs need renewed evidence review. The reviewer can run `content:check:story` after the independent first read to obtain these evidence bindings, or derive them with `storyEvidenceHash` from `scripts/content_story_gate.mjs`. A changed premise, visible copy or graphic selection needs renewed genuine review; a coordinator must not relabel an earlier pass. These structural checks support editorial judgment, never replace it.

Show the actual local blog review UI after finalization. Markdown, JSON and standalone graphics are not the article preview. Publication still needs explicit later approval of the exact candidate.
