#!/usr/bin/env node

import assert from "node:assert/strict";
import { numberlessEntries, visibleSentenceEntries } from "./content_language_review.mjs";

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

console.log("Content language review regression checks passed.");
