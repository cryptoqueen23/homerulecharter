#!/usr/bin/env node
/* ============================================================================
   diff-snapshots.mjs
   ----------------------------------------------------------------------------
   Compares the two most recent charter snapshots and writes detected changes to
   data/charter/detected-changes.json

   Run:  node scripts/diff-snapshots.mjs
         node scripts/diff-snapshots.mjs <older.json> <newer.json>

   A detected difference is NOT a charter amendment. It is a difference between
   two copies of a codified document, which can also come from a Municode
   re-codification, a typo correction, a renumbering, or a scraping error.
   Everything found here is written as:

       DETECTED CHANGE - VERIFICATION REQUIRED

   and stays that way until an ordinance, election and canvass explain it.
   ========================================================================== */

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SNAPDIR = path.join(ROOT, "data/charter/snapshots");
const OUT = path.join(ROOT, "data/charter/detected-changes.json");

function flatten(doc) {
  const map = new Map();
  for (const a of doc.articles ?? []) {
    for (const s of a.sections ?? []) {
      const key = s.section || s.node_id || s.section_title;
      if (key) map.set(String(key), s);
    }
  }
  return map;
}

/* Word-level difference. Reports what moved without rewriting either side. */
function wordDiff(oldText, newText) {
  const a = (oldText || "").split(/\s+/).filter(Boolean);
  const b = (newText || "").split(/\s+/).filter(Boolean);
  const setA = new Set(a), setB = new Set(b);
  return {
    words_removed: a.filter((w) => !setB.has(w)).slice(0, 60),
    words_added: b.filter((w) => !setA.has(w)).slice(0, 60),
    length_before: a.length,
    length_after: b.length
  };
}

async function main() {
  let [, , oldArg, newArg] = process.argv;

  if (!oldArg || !newArg) {
    if (!existsSync(SNAPDIR)) { console.log("No snapshots directory yet. Run the ingest first."); return; }
    /* Sort by modification time, not filename. Lexical sort is wrong here:
       "2026-09-05.json" sorts after "2026-09-05-3.json" because "." > "-",
       which silently reverses the comparison direction and reports additions
       as removals. */
    const names = (await readdir(SNAPDIR)).filter((f) => f.endsWith(".json"));
    const stamped = await Promise.all(
      names.map(async (f) => ({ f, t: (await stat(path.join(SNAPDIR, f))).mtimeMs }))
    );
    const files = stamped.sort((a, b) => a.t - b.t).map((x) => x.f);
    if (files.length < 2) {
      console.log(`Only ${files.length} snapshot(s) on file. Need two to compare.`);
      console.log("This is expected on the first successful ingest.");
      return;
    }
    oldArg = path.join(SNAPDIR, files[files.length - 2]);
    newArg = path.join(SNAPDIR, files[files.length - 1]);
  }

  console.log("Comparing:");
  console.log("  before:", path.relative(ROOT, oldArg));
  console.log("  after: ", path.relative(ROOT, newArg));

  const before = flatten(JSON.parse(await readFile(oldArg, "utf8")));
  const after = flatten(JSON.parse(await readFile(newArg, "utf8")));

  const changes = [];
  const stamp = new Date().toISOString();

  for (const [key, s] of after) {
    if (!before.has(key)) {
      changes.push({
        type: "section_added", section: key, section_title: s.section_title,
        status: "DETECTED CHANGE - VERIFICATION REQUIRED",
        detected_at: stamp, source_url: s.source_url,
        history_annotations: s.history ?? [],
        next_step: "Identify the ordinance and election that added this section. Confirm against the canvass before recording it as an amendment."
      });
    }
  }

  for (const [key, s] of before) {
    if (!after.has(key)) {
      changes.push({
        type: "section_removed", section: key, section_title: s.section_title,
        status: "DETECTED CHANGE - VERIFICATION REQUIRED",
        detected_at: stamp,
        removed_text: s.legal_text,
        next_step: "A section disappearing may be a repeal, a renumbering, or a failed fetch. Check the previous snapshot and Municode directly before recording a repeal."
      });
      continue;
    }
    const t = after.get(key);

    if ((s.section_title || "") !== (t.section_title || "")) {
      changes.push({
        type: "title_changed", section: key,
        before: s.section_title, after: t.section_title,
        status: "DETECTED CHANGE - VERIFICATION REQUIRED",
        detected_at: stamp, source_url: t.source_url,
        next_step: "Confirm whether the title changed by amendment or by editorial recodification."
      });
    }

    if ((s.legal_text || "") !== (t.legal_text || "")) {
      changes.push({
        type: "text_changed", section: key, section_title: t.section_title,
        status: "DETECTED CHANGE - VERIFICATION REQUIRED",
        detected_at: stamp, source_url: t.source_url,
        diff: wordDiff(s.legal_text, t.legal_text),
        text_before: s.legal_text,
        text_after: t.legal_text,
        next_step: "This is the highest-value case. The prior text is now on file, which is the missing half of every Before vs. Now comparison. Locate the ordinance, proposition and canvass that produced it before marking anything VERIFIED."
      });
    }

    const hb = JSON.stringify(s.history ?? []), ha = JSON.stringify(t.history ?? []);
    if (hb !== ha) {
      changes.push({
        type: "history_changed", section: key,
        before: s.history ?? [], after: t.history ?? [],
        status: "DETECTED CHANGE - VERIFICATION REQUIRED",
        detected_at: stamp, source_url: t.source_url,
        next_step: "A new annotation names a new ordinance. Add it to the provenance index and obtain the ordinance."
      });
    }
  }

  const out = {
    schema_version: "1.0",
    compared: { before: path.basename(oldArg), after: path.basename(newArg) },
    generated_at: stamp,
    note: "A detected difference is not a charter amendment. Every entry requires an ordinance, election and canvass before it is recorded as a change to the charter.",
    count: changes.length,
    changes
  };

  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`\n${changes.length} difference(s) detected.`);
  changes.forEach((c) => console.log(`  ${c.type}  ${c.section ?? ""} ${c.section_title ?? ""}`));
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
  if (changes.length) console.log("All entries marked VERIFICATION REQUIRED. None is published as an amendment.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
