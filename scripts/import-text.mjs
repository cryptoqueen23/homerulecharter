#!/usr/bin/env node
/* ============================================================================
   import-text.mjs
   ----------------------------------------------------------------------------
   The manual path. Parses a hand-exported charter into the same schema the
   Municode ingest produces, so the rest of the pipeline does not care which
   route the text arrived by.

   Run:  node scripts/import-text.mjs charter.txt

   To produce charter.txt: open the charter on Municode, use Download (Docx) at
   the Charter or Article level, open the file, select all, paste into a plain
   text file. Or export the docx to text with any converter.

   Expected shape, which is how Municode lays it out:

       ARTICLE III. - ELECTIONS, INITIATIVE, REFERENDUM AND RECALL
       Sec. 3.01. - City elections.
       <text of the section>
       (Ord. No. 2012-34, approved 11-6-12)
       Sec. 3.02. - Filing for office.
       <text>

   The parser preserves section text exactly. It does not reword, correct or
   summarize. plain_english is left null for a human to fill in separately.
   ========================================================================== */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const CURRENT = path.join(ROOT, "data/charter/current.json");
const SNAPDIR = path.join(ROOT, "data/charter/snapshots");

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/import-text.mjs <charter.txt>");
  process.exit(1);
}

const ART = /^\s*ARTICLE\s+([IVXLC]+)\.?\s*[-\u2013\u2014.]*\s*(.*)$/i;
const SEC = /^\s*Sec(?:tion)?\.?\s*([0-9]+\.[0-9A-Za-z]+)\.?\s*[-\u2013\u2014.]*\s*(.*)$/i;
const HIST = /^\s*[\(\[]?\s*(Ord\.\s*No\.|Amd\.\s*of|Res\.\s*No\.|Editor's note|State law reference|Cross reference)/i;

function nodeIdGuess(article, section) {
  return section ? `CH_ART${article ?? ""}_S${section}` : `CH_ART${article ?? ""}`;
}

const raw = await readFile(file, "utf8");
const retrieved_at = new Date().toISOString();

const articles = [];
let art = null, sec = null;
let count = 0;

function closeSection() {
  if (!sec) return;
  sec.legal_text = sec._lines.join("\n\n").trim();
  delete sec._lines;
  if (sec.legal_text) { art.sections.push(sec); count++; }
  sec = null;
}

for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (!t) continue;

  const a = ART.exec(t);
  if (a) {
    closeSection();
    art = { article: a[1].toUpperCase(), article_title: a[2].trim(), sections: [] };
    articles.push(art);
    continue;
  }

  const s = SEC.exec(t);
  if (s) {
    closeSection();
    if (!art) { art = { article: null, article_title: "Unassigned", sections: [] }; articles.push(art); }
    sec = {
      article: art.article, article_title: art.article_title,
      section: s[1], section_title: s[2].trim() || null,
      legal_text: "", plain_english: null, history: [],
      node_id: nodeIdGuess(art.article, s[1]),
      source_url: "https://library.municode.com/tx/copperas_cove/codes/code_of_ordinances?nodeId=CH",
      retrieved_at, verification_status: "current_codified_source",
      import_method: "manual_transcription"
    };
    sec._lines = [];
    continue;
  }

  if (sec) {
    if (HIST.test(t)) sec.history.push(t.replace(/^[\(\[]|[\)\]]$/g, "").trim());
    else sec._lines.push(t);
  }
}
closeSection();

if (!count) {
  console.error("No sections parsed. Check that the file contains lines like 'Sec. 3.01. - Title'.");
  process.exit(1);
}

const existing = existsSync(CURRENT) ? JSON.parse(await readFile(CURRENT, "utf8")) : null;

const out = {
  schema_version: "2.0",
  source: {
    publisher: "Municode",
    jurisdiction: "Copperas Cove, Texas",
    source_url: "https://library.municode.com/tx/copperas_cove/codes/code_of_ordinances?nodeId=CH",
    node_id: "CH",
    retrieved_at,
    verification_status: "current_codified_source",
    note: "Imported by hand from a Municode export. Municode remains the referenced current codified source. This file is a research snapshot, not the original authority.",
    import_method: "manual_transcription",
    imported_from: path.basename(file)
  },
  last_checked: retrieved_at,
  last_checked_result: "manual_import",
  charter_adopted: existing?.charter_adopted ?? null,
  charter_adopted_status: existing?.charter_adopted_status ?? "RESEARCH_NEEDED",
  charter_adopted_note: existing?.charter_adopted_note ?? null,
  ingest_log: [
    { at: retrieved_at, result: "manual_import", sections: count, articles: articles.length, file: path.basename(file) },
    ...(existing?.ingest_log ?? []).slice(0, 19)
  ],
  articles
};

await mkdir(SNAPDIR, { recursive: true });
const stamp = retrieved_at.slice(0, 10);
let target = path.join(SNAPDIR, `${stamp}.json`), n = 1;
while (existsSync(target)) target = path.join(SNAPDIR, `${stamp}-${++n}.json`);

await writeFile(target, JSON.stringify(out, null, 2));
await writeFile(CURRENT, JSON.stringify(out, null, 2));

console.log(`Parsed ${count} sections across ${articles.length} article(s).`);
articles.forEach((a) => console.log(`  Article ${a.article}: ${a.article_title} (${a.sections.length} sections)`));
console.log(`\nWrote ${path.relative(ROOT, target)}`);
console.log(`Wrote ${path.relative(ROOT, CURRENT)}`);
