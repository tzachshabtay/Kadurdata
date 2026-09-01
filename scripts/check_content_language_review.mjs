#!/usr/bin/env node

import assert from "node:assert/strict";
import { buildReviewPacket, numberlessEntries, visibleSentenceEntries } from "./content_language_review.mjs";
import { mentionsPlayerByFullOrIntroducedShortName } from "./generate_content_article.mjs";
import { postprocessVisibleCopy } from "./postprocess_content_article.mjs";

const editorial = {
  headline: "",
  dek: "1.50 xG לעומת 0.34. משפט נוסף.",
  sections: [],
  takeaways: [],
  conclusion: "",
};
const analysisPlan = { graphics: [] };

assert.deepEqual(visibleSentenceEntries(editorial, analysisPlan), [
  { location: "editorial.dek.sentence.0", text: "1.50 xG לעומת 0.34." },
  { location: "editorial.dek.sentence.1", text: "משפט נוסף." },
]);
assert.deepEqual(numberlessEntries(editorial, analysisPlan), [
  { location: "editorial.dek.sentence.0", text: "[מספר] לעומת [מספר]." },
  { location: "editorial.dek.sentence.1", text: "משפט נוסף." },
]);
assert.equal(numberlessEntries({ ...editorial, dek: "בחמש הופעות נאספו נתונים." }, analysisPlan)[0].text, "ב[מספר] הופעות נאספו נתונים.");
assert.equal(numberlessEntries({ ...editorial, dek: "שלוש מחמש הבעיטות נכנסו." }, analysisPlan)[0].text, "[מספר] מ[מספר] הבעיטות נכנסו.");

const playerRecaps = [{ playerId: "player-1", text: "שיחק 90 דקות. השלים 42 מסירות.", evidenceIds: ["player.week.player-1"] }];
assert.deepEqual(visibleSentenceEntries(editorial, analysisPlan, playerRecaps).slice(-2), [
  { location: "playerRecaps.0.text.sentence.0", text: "שיחק 90 דקות." },
  { location: "playerRecaps.0.text.sentence.1", text: "השלים 42 מסירות." },
]);
const weeklyPacket = buildReviewPacket({
  schemaVersion: 2,
  draftEditorial: editorial,
  draftPlayerRecaps: playerRecaps,
  editorial,
  playerRecaps,
  analysisPlan,
});
const changedWeeklyPacket = buildReviewPacket({
  schemaVersion: 2,
  draftEditorial: editorial,
  draftPlayerRecaps: playerRecaps,
  editorial,
  playerRecaps: [{ ...playerRecaps[0], text: "שיחק 89 דקות." }],
  analysisPlan,
});
assert.notEqual(weeklyPacket.finalHash, changedWeeklyPacket.finalHash);
assert.equal(weeklyPacket.draftHash, changedWeeklyPacket.draftHash);

const postprocessed = postprocessVisibleCopy({
  editorial: {
    ...editorial,
    dek: "מכבי כבר הובילה - ואז כבשה שוב — אחרי ההרחקה.",
  },
  analysisPlan: {
    graphics: [{ titleHe: "האגפים — והרחבה", subtitleHe: "מפות החום — לאורך כל דקות ההופעה" }],
  },
  playerRecaps: [{ playerId: "player-1", text: "פתח — והשלים משחק מלא.", evidenceIds: ["player.week.player-1"] }],
});
assert.equal(postprocessed.editorial.dek, "מכבי כבר הובילה - ואז כבשה שוב - אחרי ההרחקה.");
assert.equal(postprocessed.analysisPlan.graphics[0].titleHe, "האגפים - והרחבה");
assert.equal(postprocessed.analysisPlan.graphics[0].subtitleHe, "מפות החום - לאורך כל דקות ההופעה");
assert.equal(postprocessed.playerRecaps[0].text, "פתח - והשלים משחק מלא.");
assert.match("במפת הפעילות", /(?:מפת|מפות) הפעילות/u);
assert.match("מפות הפעילות", /(?:מפת|מפות) הפעילות/u);
assert.equal(
  mentionsPlayerByFullOrIntroducedShortName("פרץ כבש פעמיים", "דור פרץ קיבל את המצבים. פרץ כבש פעמיים", "דור פרץ"),
  true,
);
assert.equal(mentionsPlayerByFullOrIntroducedShortName("פרץ כבש פעמיים", "פרץ כבש פעמיים", "דור פרץ"), false);

console.log("Content language review regression checks passed.");
