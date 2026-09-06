#!/usr/bin/env node
/* ============================================================================
   ingest-municode.mjs
   ----------------------------------------------------------------------------
   Retrieves the Copperas Cove Home Rule Charter from Municode, normalizes it,
   and writes:

     data/charter/current.json                 the working copy
     data/charter/snapshots/<date>.json        an immutable snapshot

   Run:  node scripts/ingest-municode.mjs
         node scripts/ingest-municode.mjs --probe     (diagnose only, writes nothing)
         node scripts/ingest-municode.mjs --dry-run   (fetch and report, writes nothing)

   Requires Node 18 or newer for native fetch. No dependencies.

   ---------------------------------------------------------------------------
   HONEST WARNING ABOUT THIS SCRIPT
   ---------------------------------------------------------------------------
   Municode's public pages are a JavaScript application. The text is not in the
   HTML; the page fetches it from an internal API at api.municode.com. This
   script targets that API.

   That API is not publicly documented and its parameter names are not
   guaranteed. The endpoint shapes below are best-effort and MAY BE WRONG. They
   have not been executed successfully against a live server by the author of
   this file. Run --probe first. It prints exactly what each endpoint returns so
   the shapes can be corrected against reality rather than guessed at twice.

   If the API is unavailable, blocked, or has changed, use the manual path:
     scripts/import-text.mjs
   which parses a hand-exported charter into the identical schema. That path
   always works and does not depend on anyone's undocumented API.
   ========================================================================== */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const CURRENT = path.join(ROOT, "data/charter/current.json");
const SNAPDIR = path.join(ROOT, "data/charter/snapshots");

const CLIENT = "copperas_cove";
const STATE = "tx";
const CHARTER_NODE = "CH";
const PUBLIC_URL =
  "https://library.municode.com/tx/copperas_cove/codes/code_of_ordinances?nodeId=CH";

/* Refuse to publish a result this thin. A charter with three sections means the
   fetch half-worked, and half-worked data is worse than none because it looks
   real. Tune only if the real article count is genuinely smaller. */
const MIN_SECTIONS = 8;

const PROBE = process.argv.includes("--probe");
const DRY = process.argv.includes("--dry-run") || PROBE;
const DELAY_MS = 400;

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ fetch */

async function get(url, label) {
  await sleep(DELAY_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent":
          "CoveCharterWatch/1.0 (civic research; contact via github.com/cryptoqueen23/homerulecharter)"
      }
    });
    const body = await res.text();
    let json = null;
    try { json = JSON.parse(body); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, url, label, body, json };
  } catch (err) {
    return { ok: false, status: 0, url, label, body: "", json: null, error: err.message };
  }
}

/* Candidate endpoint shapes, tried in order. Correct these once --probe shows
   what the server actually answers. */
const CANDIDATES = {
  client: [
    `https://api.municode.com/Clients/name?clientName=${CLIENT}`,
    `https://api.municode.com/Clients?clientName=${CLIENT}`
  ],
  products: (clientId) => [
    `https://api.municode.com/ClientProducts?clientId=${clientId}`,
    `https://api.municode.com/Products?clientId=${clientId}`
  ],
  jobs: (productId) => [
    `https://api.municode.com/Jobs/latest?productId=${productId}`,
    `https://api.municode.com/Jobs?productId=${productId}`
  ],
  toc: (jobId, productId) => [
    `https://api.municode.com/codesToc?jobId=${jobId}&productId=${productId}`,
    `https://api.municode.com/codesToc/children?jobId=${jobId}&nodeId=${CHARTER_NODE}&productId=${productId}`
  ],
  content: (jobId, productId, nodeId) => [
    `https://api.municode.com/CodesContent?jobId=${jobId}&nodeId=${nodeId}&productId=${productId}`,
    `https://api.municode.com/codesContent?jobId=${jobId}&nodeId=${nodeId}&productId=${productId}`
  ]
};

async function tryAll(urls, label) {
  for (const u of urls) {
    const r = await get(u, label);
    log(`  [${r.status || "ERR"}] ${label}: ${u}`);
    if (PROBE) log("        " + (r.body || r.error || "").slice(0, 300).replace(/\s+/g, " "));
    if (r.ok && r.json) return r;
  }
  return null;
}

/* ------------------------------------------------------------- normalizing */

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&nbsp;": " ", "&mdash;": "\u2014", "&ndash;": "\u2013", "&sect;": "\u00A7"
};

/* Convert Municode's HTML fragment to text WITHOUT altering wording.
   Block elements become paragraph breaks. Nothing is reworded, trimmed of
   content, corrected, or normalized beyond whitespace collapsing. */
function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00A0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

/* Pull annotation lines. These are the provenance leads: ordinance numbers,
   election dates, editor's notes. Captured verbatim. */
function extractHistory(text) {
  const out = [];
  const patterns = [
    /\(([^()]*(?:Ord\.\s*No\.|Amd\.\s*of|Res\.\s*No\.)[^()]*)\)/gi,
    /(Editor's note[\u2014\u2013-][^\n]+)/gi,
    /(State law reference[\u2014\u2013-][^\n]+)/gi,
    /(Cross reference[\u2014\u2013-][^\n]+)/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = m[1].trim();
      if (line && !out.includes(line)) out.push(line);
    }
  }
  return out;
}

/* "Sec. 3.18. - Recall" -> { section: "3.18", section_title: "Recall" } */
function parseHeading(title) {
  if (!title) return { section: null, section_title: null };
  const m = /^\s*(?:Sec(?:tion)?\.?\s*)?([0-9]+\.[0-9A-Za-z]+)\.?\s*[-\u2013\u2014.]*\s*(.*)$/.exec(title);
  if (m) return { section: m[1], section_title: m[2].trim() || null };
  return { section: null, section_title: title.trim() };
}

function parseArticle(title) {
  const m = /^\s*ARTICLE\s+([IVXLC]+)\.?\s*[-\u2013\u2014.]*\s*(.*)$/i.exec(title || "");
  return m ? { article: m[1].toUpperCase(), article_title: m[2].trim() } : null;
}

function sectionUrl(nodeId) {
  return `https://library.municode.com/${STATE}/${CLIENT}/codes/code_of_ordinances?nodeId=${encodeURIComponent(nodeId)}`;
}

/* Walk whatever tree shape the TOC returns. Municode has used several key
   names over time, so accept the common ones rather than assuming one. */
function collectNodes(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  const id = node.Id ?? node.id ?? node.nodeId ?? node.NodeId;
  const heading = node.Heading ?? node.heading ?? node.Title ?? node.title;
  if (id) acc.push({ id: String(id), heading: heading ? String(heading) : "" });
  const kids = node.Children ?? node.children ?? node.Nodes ?? node.nodes ?? [];
  for (const k of kids) collectNodes(k, acc);
  return acc;
}

/* ------------------------------------------------------------------- main */

async function main() {
  log("Cove Charter Watch - Municode ingestion");
  log(PROBE ? "MODE: probe, nothing will be written\n" : DRY ? "MODE: dry run, nothing will be written\n" : "MODE: live\n");

  const retrieved_at = new Date().toISOString();
  const existing = existsSync(CURRENT)
    ? JSON.parse(await readFile(CURRENT, "utf8"))
    : null;

  log("Step 1: resolve client");
  const client = await tryAll(CANDIDATES.client, "client");
  if (!client) return bail("Could not resolve the client record.", existing, retrieved_at);

  const clientId =
    client.json?.ClientID ?? client.json?.clientId ?? client.json?.Id ?? client.json?.id;
  log("  clientId =", clientId ?? "NOT FOUND");
  if (!clientId) return bail("Client responded but no client id field was recognized. Run --probe and correct the field names.", existing, retrieved_at);

  log("Step 2: resolve product");
  const products = await tryAll(CANDIDATES.products(clientId), "products");
  if (!products) return bail("Could not list products for this client.", existing, retrieved_at);

  const list = Array.isArray(products.json) ? products.json : products.json?.Products ?? [];
  const product =
    list.find((p) => /code of ordinances/i.test(p.ProductName ?? p.productName ?? p.Name ?? "")) ?? list[0];
  const productId = product?.ProductID ?? product?.productId ?? product?.Id ?? product?.id;
  log("  productId =", productId ?? "NOT FOUND");
  if (!productId) return bail("No product id recognized. Run --probe.", existing, retrieved_at);

  log("Step 3: resolve job");
  const jobs = await tryAll(CANDIDATES.jobs(productId), "jobs");
  const jobList = Array.isArray(jobs?.json) ? jobs.json : jobs?.json ? [jobs.json] : [];
  const jobId = jobList[0]?.Id ?? jobList[0]?.id ?? jobList[0]?.JobID ?? jobList[0]?.jobId;
  log("  jobId =", jobId ?? "NOT FOUND");
  if (!jobId) return bail("No job id recognized. Run --probe.", existing, retrieved_at);

  log("Step 4: fetch table of contents");
  const toc = await tryAll(CANDIDATES.toc(jobId, productId), "toc");
  if (!toc) return bail("Could not fetch the table of contents.", existing, retrieved_at);

  const all = collectNodes(toc.json);
  const charterNodes = all.filter((n) => n.id === CHARTER_NODE || n.id.startsWith(CHARTER_NODE + "_"));
  log(`  ${all.length} nodes total, ${charterNodes.length} under the charter`);

  if (PROBE) {
    log("\nCharter nodes found:");
    charterNodes.slice(0, 40).forEach((n) => log(`  ${n.id}  ${n.heading}`));
    log("\nProbe complete. Nothing written.");
    return;
  }

  log("Step 5: fetch section content");
  const articles = [];
  let currentArticle = null;
  let count = 0;

  for (const node of charterNodes) {
    const art = parseArticle(node.heading);
    if (art) {
      currentArticle = { ...art, sections: [] };
      articles.push(currentArticle);
      log(`  Article ${art.article}: ${art.article_title}`);
      continue;
    }

    const res = await tryAll(CANDIDATES.content(jobId, productId, node.id), `content ${node.id}`);
    if (!res) { log(`    skipped ${node.id}, no content returned`); continue; }

    const docs = res.json?.Docs ?? res.json?.docs ?? (Array.isArray(res.json) ? res.json : [res.json]);
    for (const doc of docs.filter(Boolean)) {
      const heading = doc.Title ?? doc.title ?? node.heading;
      const rawHtml =
        (doc.Content ?? doc.content ?? "") +
        (doc.Chunks ? doc.Chunks.map((c) => c.Content ?? "").join("\n") : "");
      const legal_text = htmlToText(rawHtml);
      if (!legal_text) continue;

      const { section, section_title } = parseHeading(heading);
      if (!currentArticle) {
        currentArticle = { article: null, article_title: "Unassigned", sections: [] };
        articles.push(currentArticle);
      }

      currentArticle.sections.push({
        article: currentArticle.article,
        article_title: currentArticle.article_title,
        section,
        section_title,
        legal_text,
        plain_english: null,
        history: extractHistory(legal_text),
        node_id: node.id,
        source_url: sectionUrl(node.id),
        retrieved_at,
        verification_status: "current_codified_source"
      });
      count++;
    }
  }

  log(`\n  ${count} sections captured across ${articles.length} articles`);

  if (count < MIN_SECTIONS) {
    return bail(
      `Only ${count} sections captured, below the ${MIN_SECTIONS} minimum. Refusing to write. ` +
      "Partial data that looks complete is worse than no data.",
      existing, retrieved_at
    );
  }

  const out = {
    schema_version: "2.0",
    source: {
      publisher: "Municode",
      jurisdiction: "Copperas Cove, Texas",
      source_url: PUBLIC_URL,
      node_id: CHARTER_NODE,
      retrieved_at,
      verification_status: "current_codified_source",
      note: "Municode remains the referenced current codified source. This file is a research snapshot, not the original authority."
    },
    last_checked: retrieved_at,
    last_checked_result: "success",
    charter_adopted: existing?.charter_adopted ?? null,
    charter_adopted_status: existing?.charter_adopted_status ?? "RESEARCH_NEEDED",
    charter_adopted_note: existing?.charter_adopted_note ?? null,
    ingest_log: [
      { at: retrieved_at, result: "success", sections: count, articles: articles.length },
      ...(existing?.ingest_log ?? []).slice(0, 19)
    ],
    articles
  };

  if (DRY) { log("\nDry run complete. Nothing written."); return; }

  await mkdir(SNAPDIR, { recursive: true });
  const stamp = retrieved_at.slice(0, 10);
  const snap = path.join(SNAPDIR, `${stamp}.json`);

  /* Snapshots are immutable. Never overwrite one. */
  let target = snap, n = 1;
  while (existsSync(target)) target = path.join(SNAPDIR, `${stamp}-${++n}.json`);

  await writeFile(target, JSON.stringify(out, null, 2));
  await writeFile(CURRENT, JSON.stringify(out, null, 2));

  log(`\nWrote ${path.relative(ROOT, target)}`);
  log(`Wrote ${path.relative(ROOT, CURRENT)}`);
  log("\nNext: node scripts/diff-snapshots.mjs");
}

/* On any failure, preserve the last good charter and record the attempt.
   The charter must never disappear from the site because a fetch failed. */
async function bail(reason, existing, at) {
  log("\nINGEST FAILED: " + reason);
  if (!existing) {
    log("No previous charter data exists, so nothing was preserved.");
    log("Use the manual path instead: node scripts/import-text.mjs <file>");
    process.exitCode = 1;
    return;
  }
  if (DRY) { log("Dry run, failure not recorded."); process.exitCode = 1; return; }

  existing.last_checked = at;
  existing.last_checked_result = "failed";
  existing.ingest_log = [
    { at, result: "failed", reason },
    ...(existing.ingest_log ?? []).slice(0, 19)
  ];
  await writeFile(CURRENT, JSON.stringify(existing, null, 2));
  log("Previous charter data preserved. Failure recorded in ingest_log.");
  process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
