# Match context and independent insight

Context should explain why the match mattered and sharpen the football question. Weave in the relevant background; do not add a compulsory table paragraph or a catalogue of recent scores.

## Establish the situation at the match date

- Inspect table positions, points and the stakes before kickoff, then distinguish the effect of the selected result. Never substitute today's standings for the historical situation.
- The match preparer supplies `source.matchContext` for supported Israeli leagues: a table reconstructed from prior results, the selected result applied to that snapshot, and each team's five prior league matches in chronological order. Its `context.table`, `context.form.home` and `context.form.away` evidence contains the numeric claims and dated fixture IDs.
- This reconstruction does not know sanctions or every official tiebreak rule. Cross-check any published official rank against contemporaneous reporting or the official competition source; resolve differences instead of silently treating the computed rank as official. It excludes potentially overlapping fixtures because the view has no completion timestamps. Check these limits when they matter. In other competitions, obtain relevant league background from verified sources rather than constructing a meaningless cup table.
- Compare like-for-like form: identify the competition and window, separate league results from Europe/cup matches, and distinguish a run of results from a demonstrated playing-style trend. Recent wins or a goal alone do not establish improvement. Keep the existing historical audit and player-baseline requirements.

## Read the coverage, then ask what the data adds

Read relevant Israeli soccer reporting before, during and after the match when available, including outlets such as ONE, Sport5, Walla and Ynet and official team/league reports. Open the full articles; search snippets are discovery aids. Record publication/update times and the version actually read, especially a live page updated after full time. Retain links, attributable factual background and a short paraphrase of each report's angle. Do not copy its prose, lift its conclusions as our own, or manufacture a causal claim from a quote or headline.

Compare the prospective thesis with the reports read. Identify the additional football question answered by the data: for example, whether a late advantage survives removing the most memorable miss, which chances were repeatable, or whether the table stakes obscured a contrasting pattern of opportunities. These are examples, not article templates. Existing press interpretation may motivate a hypothesis; native shot, event, player, role, spatial or historical data must support our resulting insight. Do not claim universal originality across coverage you have not read.

Save the wider research audit locally. Add only relevant sources to the authored package:

```json
{
  "reportingContext": {
    "sources": [{
      "id": "ynet-match",
      "phase": "live",
      "publisher": "ynet",
      "title": "<verified page title>",
      "url": "https://<verified article URL>",
      "publishedAt": "<verified publication/update time and version>",
      "updatedAt": "<verified latest update time, when shown separately>",
      "accessedAt": "<ISO retrieval timestamp>",
      "facts": [{ "textHe": "<brief, attributed factual paraphrase>", "values": [] }],
      "angleHe": "<what the report explains or emphasizes>"
    }],
    "novelty": {
      "pressSummaryHe": "<the explanation offered by the reports read>",
      "addedInsightHe": "<what our data-backed explanation adds>",
      "dataEvidenceIds": ["<native match evidence IDs used in the body>"]
    }
  }
}
```

Use phase `before`, `live` or `after`. Include explicit numeric values only when the factual paraphrase and source support them. Cite reports as `context.reporting.<id>`; the native story CLI/finalizer derive these evidence items without modifying `source.json`. Attribute the relevant fact in prose; cited publishers render once each as links after the conclusion. Their visible labels are included in `content:review-packet`; the reporting package and URLs are bound to the final-copy hash. For context-enabled packages, the story evidence hash binds the full context, reporting and native evidence, including player-recap evidence. Re-run `content:check:story` on the completed final package after adding recaps to obtain the exact review binding. Freeze it before review. Every new match finalization requires reporting and a native-data insight, including competitions without a reconstructed league table.

## Role handoffs

The analyst supplies historical standings/form, the reporting audit, source provenance, the press-versus-data distinction and a story brief. The writer uses context selectively and attributes facts or interpretations borrowed from reporting. The editor checks that background develops the story rather than padding it. The blind reviewer still reads the clean final/numberless copy first, then independently opens cited reporting and checks table timing, sample comparability, source attributions, event details and the claimed additional insight against native data. Disagreeing with a report is optional; explaining something supported and useful is required.
