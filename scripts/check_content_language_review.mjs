#!/usr/bin/env node

import assert from "node:assert/strict";
import { numberlessEntries, visibleSentenceEntries } from "./content_language_review.mjs";
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

const postprocessed = postprocessVisibleCopy({
  editorial: {
    ...editorial,
    dek: "מכבי כבר הובילה - ואז כבשה שוב — אחרי ההרחקה.",
  },
  analysisPlan: {
    graphics: [{ titleHe: "האגפים — והרחבה", subtitleHe: "מפות החום — לאורך כל דקות ההופעה" }],
  },
});
assert.equal(postprocessed.editorial.dek, "מכבי כבר הובילה - ואז כבשה שוב - אחרי ההרחקה.");
assert.equal(postprocessed.analysisPlan.graphics[0].titleHe, "האגפים - והרחבה");
assert.equal(postprocessed.analysisPlan.graphics[0].subtitleHe, "מפות החום - לאורך כל דקות ההופעה");
assert.match("במפת הפעילות", /(?:מפת|מפות) הפעילות/u);
assert.match("מפות הפעילות", /(?:מפת|מפות) הפעילות/u);

console.log("Content language review regression checks passed.");
