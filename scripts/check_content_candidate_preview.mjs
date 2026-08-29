#!/usr/bin/env node

import assert from "node:assert/strict";
import { renderCandidatePreview } from "./content_candidate_preview.mjs";

const fixture = {
  status: "draft",
  approval: { status: "pending" },
  aiDisclosure: "גילוי נאות",
  match: { competitionNameHe: "מפעל", scheduledAt: "2026-08-25T16:45:00Z" },
  teams: {
    home: { teamId: "home", nameHe: "בית", color: "#ff0000", score: 1, logoUrl: null, shotSummary: { count: 1 } },
    away: { teamId: "away", nameHe: "חוץ", color: "#ff0000", score: 0, logoUrl: null, shotSummary: { count: 0 } },
  },
  tags: [],
  flowWindows: [],
  timelineEvents: [],
  shots: [],
  spatialProfile: { home: { players: [] }, away: { players: [] } },
  editorial: { headline: "כותרת", dek: "פתיח", sections: [], takeaways: [], conclusion: "סיכום" },
  analysisPlan: { graphics: [] },
  factCheck: { checks: [] },
  qualityReview: { reviewedHash: "1234567890abcdef", sentenceReviews: [] },
};

const html = renderCandidatePreview(fixture);
assert.match(html, /טיוטה לאישור · אינה מפורסמת בבלוג/);
assert.match(html, /<h1>כותרת<\/h1>/);
assert.match(html, /ממתינה לאישור שלך/);
assert.doesNotMatch(html, /_workbench/);
assert.throws(() => renderCandidatePreview({ ...fixture, status: "published" }), /unpublished candidate/);

console.log("Content candidate preview regression checks passed.");
