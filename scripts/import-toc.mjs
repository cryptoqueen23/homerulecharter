#!/usr/bin/env node
/* ============================================================================
   import-toc.mjs
   ----------------------------------------------------------------------------
   Parses a saved Municode table-of-contents page into the charter structure.

   Run:  node scripts/import-toc.mjs <saved-toc.html>

   A TOC page gives article and section numbers, titles and node identifiers.
   It does NOT give section body text or amendment annotations, so every section
   this creates has legal_text: null and verification_status RESEARCH_NEEDED.

   This is deliberate. Knowing a section exists and knowing what it says are two
   different things, and the site must not blur them.

   Safe to re-run. It merges into current.json rather than replacing it, so any
   legal_text already ingested for a section is preserved.
   ========================================================================== */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const CURRENT = path.join(ROOT, "data/charter/current.json");
const SNAPDIR = path.join(ROOT, "data/charter/snapshots");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-toc.mjs <saved-toc.html>");
  process.exit(1);
}

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const unesc = (s) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
   .replace(/&[a-z]+;/gi, (m) => ENT[m.toLowerCase()] ?? m);

const raw = await readFile(file, "utf8");

/* Pull every nodeId together with the visible label that follows it. */
/* Hyphens are legal in node identifiers. Municode uses them for range
   sections such as _S6.02.2.--6.05.1RE ("Sec. 6.02.2.-6.05.1. Reserved").
   Excluding "-" from this class silently drops those entries. */
const pairs = [...raw.matchAll(/nodeId=([A-Za-z0-9_.\-]+)"[^>]*>\s*(?:<[^>]+>\s*)*([^<]{3,200}?)\s*</g)];
const seen = new Map();
for (const [, nid, label] of pairs) {
  const clean = unesc(label).trim();
  if (clean && !seen.has(nid)) seen.set(nid, clean);
}

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

const articles = [];
for (const [nid, label] of seen) {
  if (!/^CH_ART[A-Z]+$/.test(nid)) continue;
  const m = /^ARTICLE\s+([IVXLC]+)\.?\s*[-\u2013\u2014.]*\s*(.*)$/i.exec(label);
  if (!m) continue;
  articles.push({
    article: m[1].toUpperCase(),
    article_title: m[2].trim(),
    node_id: nid,
    source_url: url(nid),
    status: "CONFIRMED_STRUCTURE",
    note: "Article confirmed from the Municode table of contents. Section text not yet ingested.",
    sections: []
  });
}
articles.sort((a, b) => (ROMAN[a.article] ?? 99) - (ROMAN[b.article] ?? 99));

const retrieved_at = new Date().toISOString();
let secCount = 0;

for (const [nid, label] of seen) {
  /* Node ids append a title abbreviation to the section number, e.g.
     _S3.13PORE is section 3.13 with "PORE" for "Power to recall". Match digits
     only, allowing a decimal third level (_S6.02.1AMOPBU = 6.02.1). Matching
     [0-9A-Za-z] here swallows the abbreviation into the section number. */
  const sm = /_S([0-9]+\.[0-9]+(?:\.[0-9]+)?)/.exec(nid);
  if (!sm) continue;
  const artNode = nid.split("_S")[0];
  const art = articles.find((a) => a.node_id === artNode);
  if (!art) continue;

  /* Range entries look like "Sec. 6.02.2.-6.05.1. - Reserved." Keep the range
     verbatim; do not normalize it away. Municode's own numbering gaps and
     ranges are historical evidence, not formatting to be tidied. */
  const range = /^\s*Sec(?:tion)?s?\.?\s*([0-9.]+)\s*[\u2013\u2014-]+\s*([0-9.]+)\.?\s*[-\u2013\u2014.]*\s*(.*?)\.?\s*$/i.exec(label);
  const tm = range
    ? { 1: range[3] }
    : /^\s*Sec(?:tion)?\.?\s*[0-9]+\.[0-9A-Za-z]+\.?\s*[-\u2013\u2014.]*\s*(.*?)\.?\s*$/i.exec(label);

  art.sections.push({
    article: art.article,
    article_title: art.article_title,
    section: sm[1],
    section_title: tm ? tm[1].trim() : label,
    legal_text: null,
    plain_english: null,
    history: [],
    node_id: nid,
    source_url: url(nid),
    retrieved_at,
    verification_status: "RESEARCH_NEEDED",
    structure_status: "CONFIRMED_STRUCTURE",
    body_status: "not_present_in_saved_toc",
    section_range: range ? { from: range[1], to: range[2] } : null,
    label_verbatim: label
  });
  secCount++;
}

for (const a of articles) {
  a.sections.sort((x, y) => {
    const px = x.section.split(".").map(Number);
    const py = y.section.split(".").map(Number);
    return (px[0] - py[0]) || (px[1] - py[1]) || ((px[2] ?? 0) - (py[2] ?? 0));
  });
}

function url(nid) {
  return `https://library.municode.com/tx/copperas_cove/codes/code_of_ordinances?nodeId=${encodeURIComponent(nid)}`;
}

if (!secCount) {
  console.error("No sections parsed. Is this a saved Municode TOC page?");
  process.exit(1);
}

/* Merge: never discard legal_text already on file for a section. */
const existing = existsSync(CURRENT) ? JSON.parse(await readFile(CURRENT, "utf8")) : null;
if (existing?.articles) {
  const prior = new Map();
  for (const a of existing.articles) for (const s of a.sections || []) if (s.legal_text) prior.set(s.section, s);
  let kept = 0;
  for (const a of articles) {
    for (let i = 0; i < a.sections.length; i++) {
      const p = prior.get(a.sections[i].section);
      if (p) { a.sections[i] = { ...a.sections[i], ...p }; kept++; }
    }
  }
  if (kept) console.log(`Preserved existing text for ${kept} section(s).`);
}

const out = {
  schema_version: "2.0",
  note: "legal_text holds exact Municode language only. plain_english holds our explanation. The two are never mixed.",
  source: {
    publisher: "Municode",
    jurisdiction: "Copperas Cove, Texas",
    source_url: "https://library.municode.com/tx/copperas_cove/codes/code_of_ordinances?nodeId=CH",
    node_id: "CH",
    retrieved_at,
    verification_status: "structure_only",
    note: "Structure imported from a saved Municode table of contents. Section body text has not been ingested. Municode remains the referenced current codified source; this is a research snapshot.",
    import_method: "toc_import",
    imported_from: path.basename(file)
  },
  last_checked: retrieved_at,
  last_checked_result: "toc_import",
  charter_adopted: existing?.charter_adopted ?? null,
  charter_adopted_status: existing?.charter_adopted_status ?? "RESEARCH_NEEDED",
  charter_adopted_note: existing?.charter_adopted_note ?? null,
  ingest_log: [
    { at: retrieved_at, result: "toc_import", sections: secCount, articles: articles.length, file: path.basename(file) },
    ...(existing?.ingest_log ?? []).slice(0, 19)
  ],
  sections_referenced_by_amendments: existing?.sections_referenced_by_amendments ?? [],
  articles
};

await mkdir(SNAPDIR, { recursive: true });
const stamp = retrieved_at.slice(0, 10);
let target = path.join(SNAPDIR, `${stamp}-toc.json`), n = 1;
while (existsSync(target)) target = path.join(SNAPDIR, `${stamp}-toc-${++n}.json`);

await writeFile(target, JSON.stringify(out, null, 2));
await writeFile(CURRENT, JSON.stringify(out, null, 2));

console.log(`Parsed ${articles.length} articles, ${secCount} sections.`);
for (const a of articles) console.log(`  Article ${a.article}. ${a.article_title} (${a.sections.length})`);
console.log(`\nWrote ${path.relative(ROOT, target)}`);
console.log(`Wrote ${path.relative(ROOT, CURRENT)}`);
console.log("\nAll sections have legal_text: null. A TOC proves a section exists, not what it says.");
