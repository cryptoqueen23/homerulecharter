/* Cove Charter Watch - all behavior.
   Plain script, no modules, no framework, no build step.
   Data comes from /data/*.json, which means the site needs to be served over
   http. Opening index.html directly from the file system will trip the browser's
   file:// fetch block, and the loader shows an explicit message when that happens. */

(function () {
  "use strict";

  var DATA = {};
  var page = document.body.dataset.page;
  var ROOT = document.body.dataset.root || "";

  /* ---------------------------------------------------------------- utils */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  var STATUS_LABEL = {
    VERIFIED: "Verified",
    PARTIALLY_VERIFIED: "Partially verified",
    RESEARCH_NEEDED: "Research needed"
  };

  var STATUS_TITLE = {
    VERIFIED: "A primary source confirms this.",
    PARTIALLY_VERIFIED: "Some evidence exists, but at least one part is missing.",
    RESEARCH_NEEDED: "The evidence has not been located yet. Do not rely on this."
  };

  function statusBadge(s) {
    if (!s) return "";
    return '<span class="badge ' + s + '" title="' + esc(STATUS_TITLE[s] || "") + '">' +
      esc(STATUS_LABEL[s] || s) + "</span>";
  }

  /* Categories that lean one way get a direction class, but the text label
     always carries the meaning so nothing depends on color alone. */
  var CAT_DIR = {
    "Resident Power Increased": "up",
    "Council Power Reduced": "up",
    "City Manager Power Reduced": "up",
    "Resident Power Reduced": "down",
    "Council Power Increased": "down",
    "City Manager Power Increased": "down",
    "Needs Legal Review": "flag"
  };

  function catBadges(cats) {
    if (!cats || !cats.length) return "";
    return cats.map(function (c) {
      return '<span class="badge cat ' + (CAT_DIR[c] || "") + '">' + esc(c) + "</span>";
    }).join("");
  }

  function sourceLinks(ids) {
    if (!ids || !ids.length) return '<span>No source on file</span>';
    return ids.map(function (id) {
      var s = (DATA.sources.records || []).filter(function (x) {
        return x.source_document_id === id;
      })[0];
      if (!s) return "";
      return '<a href="' + esc(s.source_url) + '" rel="noopener">' + esc(s.entity) + "</a>";
    }).filter(Boolean).join(" ");
  }

  function amendment(id) {
    return DATA.amendments.records.filter(function (r) { return r.change_id === id; })[0];
  }

  function topic(id) {
    return DATA.topics.records.filter(function (r) { return r.topic_id === id; })[0];
  }

  function pending(msg) {
    return '<p class="pending-block">' + esc(msg || "Research in progress") + "</p>";
  }

  /* --------------------------------------------------------------- chrome */

  /* Condensed primary nav. Search and Explore Charter live in .mast-actions,
     so they are not repeated here. */
  var NAV = [
    ["charter.html", "Charter"],
    ["timeline.html", "Timeline"],
    ["power-shift.html", "Power"],
    ["recall.html", "Elections"],
    ["debt.html", "Debt"],
    ["sources.html", "Sources"]
  ];

  /* Pages reachable from the homepage and in-page links but not in the top nav. */
  var NAV_ALIAS = {
    "changes.html": "charter.html",
    "before-now.html": "charter.html",
    "topic.html": "charter.html",
    "resident-powers.html": "power-shift.html",
    "council.html": "power-shift.html",
    "city-manager.html": "power-shift.html",
    "questions.html": "power-shift.html"
  };

  function chrome() {
    var here = location.pathname.split("/").pop() || "index.html";
    var active = NAV_ALIAS[here] || here;
    var nav = document.querySelector("nav.site");
    if (nav) {
      nav.innerHTML = NAV.map(function (l) {
        return '<a href="' + ROOT + l[0] + '"' +
          (l[0] === active ? ' aria-current="page"' : "") + ">" + l[1] + "</a>";
      }).join("");
    }

    var foot = document.querySelector("footer.site .wrap");
    if (foot) {
      foot.innerHTML =
        '<p class="disclaimer">This project is not affiliated with the City of Copperas Cove.</p>' +
        "<p><strong>Cove Charter Watch is an independent civic research project.</strong> " +
        "Information is reconstructed in good faith from public records and historical sources. " +
        "Missing records do not establish that an event did not occur. Plain-language explanations " +
        "are provided for educational purposes and are not legal advice.</p>" +
        "<p>It does not endorse or oppose any candidate, official, party or ballot measure. Where a " +
        "legal question is unsettled, the site says so rather than resolving it.</p>" +
        "<p><strong>Research prepared by Marimer Cruz-Nieves.</strong></p>" +
        '<p>Corrections and records are welcome. An old charter, an election ordinance or a canvass ' +
        "is exactly what closes the open gaps listed in the " +
        '<a href="' + ROOT + 'sources.html">Source Library</a>.</p>';
    }
  }

  /* ------------------------------------------------------------- glossary */

  function glossary() {
    var pop = document.createElement("div");
    pop.id = "gloss-pop";
    pop.hidden = true;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Definition");
    document.body.appendChild(pop);

    function close() { pop.hidden = true; }

    document.addEventListener("click", function (ev) {
      var b = ev.target.closest("button.gloss");
      if (!b) {
        if (!ev.target.closest("#gloss-pop")) close();
        return;
      }
      var term = b.dataset.term.toLowerCase();
      var def = DATA.glossary.terms[term];
      if (!def) return;
      pop.innerHTML = "<strong>" + esc(b.textContent) + "</strong>" + esc(def) +
        '<button type="button" data-close>Close</button>';
      pop.hidden = false;
      var r = b.getBoundingClientRect();
      pop.style.top = (window.scrollY + r.bottom + 8) + "px";
      pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.innerWidth - 360)) + "px";
      pop.querySelector("[data-close]").focus();
    });

    pop.addEventListener("click", function (ev) {
      if (ev.target.matches("[data-close]")) close();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
    });

    /* Auto-wrap glossary terms inside anything marked data-gloss. */
    var terms = Object.keys(DATA.glossary.terms).sort(function (a, b) {
      return b.length - a.length;
    });
    document.querySelectorAll("[data-gloss]").forEach(function (host) {
      var seen = {};
      walk(host);
      function walk(node) {
        for (var i = 0; i < node.childNodes.length; i++) {
          var c = node.childNodes[i];
          if (c.nodeType === 3) {
            for (var t = 0; t < terms.length; t++) {
              var term = terms[t];
              if (seen[term]) continue;
              var re = new RegExp("\\b(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "i");
              var m = re.exec(c.nodeValue);
              if (!m) continue;
              var after = c.splitText(m.index);
              var rest = after.splitText(m[0].length);
              var btn = document.createElement("button");
              btn.type = "button";
              btn.className = "gloss";
              btn.dataset.term = term;
              btn.setAttribute("aria-label", "Definition of " + m[0]);
              btn.textContent = m[0];
              after.parentNode.replaceChild(btn, after);
              seen[term] = true;
              i++;
              break;
            }
          } else if (c.nodeType === 1 && !c.matches("button, a, h1, h2, script, style")) {
            walk(c);
          }
        }
      }
    });
  }

  /* ------------------------------------------------------------ renderers */

  /* Statistics are driven entirely by data/audit.json. A metric with a null
     count prints "Research in progress". Nothing here is computed on the fly,
     because a label that drifts from what is actually being counted is how the
     earlier version of this page ended up displaying numbers it could not defend. */

  /* Sections live under articles in schema 2.0. Flatten for search and lists.
     Falls back to the old flat shape so an older data file still works. */
  function charterSections() {
    if (!DATA.charter) return [];
    if (Array.isArray(DATA.charter.articles)) {
      return DATA.charter.articles.reduce(function (acc, a) {
        return acc.concat(a.sections || []);
      }, []);
    }
    return DATA.charter.sections || [];
  }


  /* ------------------------------------------------------- current charter */

  function renderCharter() {
    var prov = document.getElementById("charter-provenance");
    var body = document.getElementById("charter-body");
    if (!prov || !body || !DATA.charter) return;

    var src = DATA.charter.source || {};
    var checked = DATA.charter.last_checked;
    var result = DATA.charter.last_checked_result;

    var state = result === "never_run"
      ? "The charter has not been ingested yet. Structure below is confirmed from Municode node identifiers only."
      : result === "failed"
        ? "The most recent refresh failed. The last successfully retrieved charter is shown below, unchanged."
        : result === "manual_import"
          ? "Imported by hand from a Municode export."
          : "Retrieved from Municode.";

    prov.innerHTML = '<div class="callout"><h3>Source and freshness</h3>' +
      "<p>" + esc(state) + "</p>" +
      "<p>Source: " + esc(src.publisher || "not set") +
      '. <a href="' + esc(src.source_url || "#") + '" rel="noopener">View current source on Municode</a>.</p>' +
      "<p>Current source last checked: " +
      esc(checked ? new Date(checked).toISOString().slice(0, 10) : "never") + "</p>" +
      "<p>" + esc(src.note || "") + "</p></div>";

    var cod = DATA.charter.codification;
    if (cod) {
      prov.insertAdjacentHTML("beforeend",
        '<div class="callout"><h3>What Municode says about this charter text</h3>' +
        '<p style="white-space:pre-wrap">' + esc(cod.editors_note_verbatim) + "</p>" +
        "<p><strong>What this establishes:</strong> " + esc(cod.what_this_does_and_does_not_establish) + "</p>" +
        "<p><strong>Why detected differences are not amendments:</strong> " +
        esc(cod.editorial_alterations_caveat) + "</p></div>");
    }

    var res = DATA.charter.reserved_sections;
    if (res && res.sections && res.sections.length) {
      prov.insertAdjacentHTML("beforeend",
        "<h2>Reserved sections</h2><p class=\"prose\">" + esc(res.note) + "</p>" +
        '<p class="meta">' + res.sections.map(function (x) {
          return '<a href="#sec-' + esc(x) + '">Sec. ' + esc(x) + "</a>";
        }).join("") + "</p>");
    }

    var arts = DATA.charter.articles || [];

    var idx = document.getElementById("article-index");
    if (idx) {
      idx.className = "article-cards";
      idx.innerHTML = arts.map(function (a) {
        return '<a class="article-card" href="#art-' + esc(a.article || "") + '">' +
          '<span class="numeral" aria-hidden="true">' + esc(a.article || "") + "</span>" +
          "<h3>" + esc(a.article_title || "") + "</h3>" +
          '<span class="count">' + (a.sections || []).length + " provisions</span>" +
          '<span class="go">Explore article</span></a>';
      }).join("");
    }
    var any = arts.some(function (a) {
      return (a.sections || []).some(function (x) { return x.legal_text; });
    });

    body.innerHTML = arts.map(function (a) {
      return '<h2 id="art-' + esc(a.article || "") + '">Article ' + esc(a.article || "") + ". " +
        esc(a.article_title || "") + "</h2>" +
        (a.note ? '<p class="missing-note">' + esc(a.note) + "</p>" : "") +
        (a.sections || []).map(function (x) {
          return '<article class="record" id="sec-' + esc(x.section || "") + '">' +
            '<div class="record-head"><span class="prop">Sec. ' + esc(x.section || "") + "</span>" +
            "<h3>" + esc(x.section_title || "") + "</h3>" +
            statusBadge(x.legal_text ? "VERIFIED" : "RESEARCH_NEEDED") + "</div>" +
            (x.legal_text
              ? '<div class="tabpanel"><p style="white-space:pre-wrap">' + esc(x.legal_text) + "</p></div>"
              : '<p class="pending-block">Section text not yet ingested.</p>') +
            (x.plain_english
              ? '<div class="plain"><h4>In plain English</h4><p>' + esc(x.plain_english) + "</p></div>"
              : "") +
            (x.history && x.history.length
              ? "<h4>Amendment history printed by Municode</h4><ul>" +
                x.history.map(function (h) { return "<li>" + esc(h) + "</li>"; }).join("") + "</ul>"
              : "") +
            '<p class="meta"><a href="' + esc(x.source_url) + '" rel="noopener">View current source on Municode</a>' +
            "<span>Retrieved: " + esc(x.retrieved_at ? x.retrieved_at.slice(0, 10) : "not yet") + "</span>" +
            (x.node_id ? '<span class="cite">' + esc(x.node_id) + "</span>" : "") + "</p></article>";
        }).join("");
    }).join("");

    if (!any) {
      body.insertAdjacentHTML("afterbegin",
        '<div class="callout"><h3>No section text on file yet</h3>' +
        "<p>Run <code>npm run update-charter</code> to ingest from Municode, or " +
        "<code>npm run import-charter charter.txt</code> to import a hand export. " +
        "Until then this page shows only the structure confirmed from Municode node identifiers.</p></div>");
    }

    var det = document.getElementById("detected");
    if (det) {
      fetch(ROOT + "data/charter/detected-changes.json")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.count) {
            det.innerHTML = "<p>No differences detected. This is expected until at least two snapshots exist.</p>";
            return;
          }
          det.innerHTML = "<p>" + d.count + " difference(s) detected on " +
            esc(d.generated_at.slice(0, 10)) + ".</p>" +
            d.changes.map(function (c) {
              return '<article class="record"><div class="record-head">' +
                '<span class="prop">Sec. ' + esc(c.section || "") + "</span>" +
                "<h3>" + esc(c.type.replace(/_/g, " ")) + "</h3>" +
                '<span class="badge RESEARCH_NEEDED">' + esc(c.status) + "</span></div>" +
                '<p class="missing-note">Next step: ' + esc(c.next_step) + "</p></article>";
            }).join("");
        })
        .catch(function () {
          det.innerHTML = "<p>No differences file yet. Run <code>npm run diff-charter</code> after a second snapshot.</p>";
        });
    }
  }

  function renderStats() {
    var host = document.getElementById("stats");
    if (!host || !DATA.audit) return;

    var show = ["elections", "propositions", "outcome_known", "outcome_unknown",
                "sections_named", "sections_transcribed"];

    host.innerHTML = show.map(function (id) {
      var m = metric(id);
      if (!m) return "";
      var body = (m.count === null || m.count === undefined)
        ? '<b class="pending">Research in progress</b>'
        : "<b>" + esc(m.count) + "</b>";
      return "<div>" + body + "<small>" + esc(m.label) + "</small></div>";
    }).join("");
  }

  function metric(id) {
    return (DATA.audit.metrics || []).filter(function (m) { return m.id === id; })[0];
  }

  function renderStatusBoard() {
    var host = document.getElementById("status-board");
    if (!host || !DATA.audit) return;
    host.innerHTML = "<table><caption class=\"visually-hidden\">Research status by area</caption>" +
      "<thead><tr><th scope=\"col\">Area</th><th scope=\"col\">State</th>" +
      "<th scope=\"col\">Evidence status</th><th scope=\"col\">Detail</th></tr></thead><tbody>" +
      (DATA.audit.status_board || []).map(function (r) {
        return "<tr><td><strong>" + esc(r.label) + "</strong></td><td>" + esc(r.state) +
          "</td><td>" + statusBadge(r.status) + "</td><td>" + esc(r.detail) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function renderAudit() {
    var host = document.getElementById("audit");
    if (!host || !DATA.audit) return;
    host.innerHTML = "<table><caption class=\"visually-hidden\">How each number is calculated</caption>" +
      "<thead><tr><th scope=\"col\">Metric</th><th scope=\"col\">Count</th>" +
      "<th scope=\"col\">Records counted</th><th scope=\"col\">Calculation method</th>" +
      "<th scope=\"col\">Status</th></tr></thead><tbody>" +
      (DATA.audit.metrics || []).map(function (m) {
        var count = (m.count === null || m.count === undefined)
          ? "Research in progress" + (m.candidates ? " (" + m.candidates + " candidate" + (m.candidates === 1 ? "" : "s") + ")" : "")
          : m.count;
        var recs = (m.records && m.records.length) ? m.records.join(", ")
          : (m.candidate_records && m.candidate_records.length ? "Candidates: " + m.candidate_records.join(", ") : "None");
        return "<tr><td>" + esc(m.label) + "</td><td>" + esc(count) + "</td><td>" + esc(recs) +
          "</td><td>" + esc(m.method) + "</td><td>" + statusBadge(m.status) + "</td></tr>";
      }).join("") + "</tbody></table>";

    var log = document.getElementById("correction-log");
    if (log) {
      log.innerHTML = (DATA.audit.correction_log || []).map(function (c) {
        return '<article class="record"><h3>Corrected ' + esc(c.date) + "</h3>" +
          "<p><strong>What was wrong:</strong> " + esc(c.what_was_wrong) + "</p>" +
          "<p><strong>Fix:</strong> " + esc(c.fix) + "</p></article>";
      }).join("");
    }
  }

  function renderProvenance() {
    var host = document.getElementById("provenance");
    if (!host || !DATA.provenance) return;
    var P = DATA.provenance;

    host.innerHTML =
      '<p class="prose">' + esc(P.note) + "</p>" +
      "<h3>Charter structure confirmed so far</h3>" +
      "<table><thead><tr><th scope=\"col\">Location</th><th scope=\"col\">Title</th>" +
      "<th scope=\"col\">How we know</th><th scope=\"col\">Why it matters</th></tr></thead><tbody>" +
      (P.structure || []).map(function (r) {
        return "<tr><td>" + esc(r.section ? "Sec. " + r.section : "Article " + r.article) +
          "</td><td>" + esc(r.title) + "</td><td>" + esc(r.evidence) + "</td><td>" +
          esc(r.significance) + "</td></tr>";
      }).join("") + "</tbody></table>" +
      "<h3>Annotation leads</h3>" +
      '<p class="prose">Each of these points at a document to obtain. None of them establishes what a section said before it changed, so none may be used to mark a comparison verified.</p>' +
      (P.leads || []).map(function (l) {
        return '<article class="record"><div class="record-head">' +
          '<span class="prop">Sec. ' + esc(l.section) + "</span>" +
          "<h3>" + esc(l.annotation_reported) + "</h3>" +
          statusBadge(l.status === "RELAYED_UNVERIFIED" ? "RESEARCH_NEEDED" : "PARTIALLY_VERIFIED") +
          (l.priority ? '<span class="badge cat flag">Priority lead</span>' : "") + "</div>" +
          "<p>" + esc(l.note || "") + "</p>" +
          '<p class="meta"><span>Ordinance: ' + esc(l.ordinance || "not named") + "</span>" +
          "<span>Election: " + esc(l.election_date || "unknown") + "</span></p>" +
          '<p class="missing-note">Next step: ' + esc(l.next_step) + "</p></article>";
      }).join("") +
      "<h3>Amendment years reported</h3>" +
      '<p class="prose">' + esc((P.amendment_years_reported.years || []).join(", ")) + ". " +
      esc(P.amendment_years_reported.note) + "</p>";
  }

  function recordHtml(r) {
    var oldSide = r.old_text
      ? "<p>" + esc(r.old_text) + "</p>"
      : (r.old_text_described
          ? "<p>" + esc(r.old_text_described) + '</p><p class="missing">Described from a secondary source. The charter text itself has not been located.</p>'
          : '<p class="missing">Historical comparison under research.</p>');

    var newSide = r.new_text
      ? "<p>" + esc(r.new_text) + "</p>"
      : (r.new_text_described
          ? "<p>" + esc(r.new_text_described) + "</p>"
          : '<p class="missing">Ballot language not yet located.</p>');

    var votes = (r.vote_yes != null || r.vote_no != null)
      ? "<span>Reported vote: " + (r.vote_yes != null ? r.vote_yes.toLocaleString() : "?") +
        " for, " + (r.vote_no != null ? r.vote_no.toLocaleString() : "?") + " against</span>"
      : "";

    var secs = (r.section && r.section.length)
      ? '<span class="cite">Sec. ' + r.section.map(esc).join(", ") + "</span>" : "";

    return '<article class="record" id="' + esc(r.change_id) + '">' +
      '<div class="record-head">' +
      (r.proposition_number ? '<span class="prop">' + esc(r.proposition_number) + "</span>" : "") +
      "<h3>" + esc(r.title) + "</h3>" + statusBadge(r.verification_status) + "</div>" +
      '<div class="badges">' + catBadges(r.categories) + "</div>" +
      '<div class="compare">' +
      "<div><h4>What the charter said before</h4>" + oldSide + "</div>" +
      "<div><h4>" + (r.approved_by === "Rejected by voters" ? "What was proposed and rejected" : "What it says now") +
      "</h4>" + newSide + "</div></div>" +
      '<div class="plain" data-gloss><h4>What this means for residents</h4>' +
      "<p>" + esc(r.plain_language_summary) + "</p>" +
      (r.resident_effect ? "<p>" + esc(r.resident_effect) + "</p>" : "") + "</div>" +
      '<p class="meta">' +
      "<span>Date: " + esc(r.election_date || r.date) + "</span>" +
      "<span>Approved by: " + esc(r.approved_by || "Not yet determined") + "</span>" +
      votes + secs + sourceLinks(r.sources) + "</p>" +
      (r.corroboration
        ? '<div class="callout"><h4>Corroborating evidence in the current charter</h4><p>' +
          esc(r.corroboration) + "</p></div>"
        : "") +
      (r.missing ? '<p class="missing-note">Still missing: ' + esc(r.missing) + "</p>" : "") +
      "</article>";
  }

  var filter = "all";

  function renderChanges() {
    var host = document.getElementById("changes");
    if (!host) return;
    var recs = DATA.amendments.records.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });
    var shown = recs.filter(function (r) {
      if (filter === "all") return true;
      if (filter === "priority") return !!r.priority;
      if (filter === "research") return r.verification_status === "RESEARCH_NEEDED";
      if (filter === "resident") return (r.categories || []).some(function (c) { return /Resident|Initiative|Referendum|Recall|Election/.test(c); });
      if (filter === "authority") return (r.categories || []).some(function (c) { return /Council|Manager|Mayor|Debt|Bond|Budget|Vacancy/.test(c); });
      return true;
    });
    host.innerHTML = shown.length
      ? shown.map(recordHtml).join("")
      : "<p>No records match this filter yet.</p>";
    var count = document.getElementById("change-count");
    if (count) count.textContent = shown.length + " of " + recs.length + " records shown";
    glossary();
  }

  function renderTimeline() {
    var host = document.getElementById("timeline");
    if (!host) return;
    var els = DATA.elections.records.slice().sort(function (a, b) {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return String(b.date).localeCompare(String(a.date));
    });
    host.className = "timeline";
    host.innerHTML = els.map(function (e) {
      var kids = DATA.amendments.records.filter(function (r) {
        return r.election_date === e.election_id || r.date === e.election_id;
      });
      return '<div class="tl-entry' + (e.verification_status !== "VERIFIED" ? " pending" : "") + '">' +
        '<p class="tl-date">' + esc(e.display_date) + "</p>" +
        "<h3>" + esc(e.type) + (e.propositions ? ", " + e.propositions + " propositions" : "") + "</h3>" +
        statusBadge(e.verification_status) +
        "<p>" + esc(e.summary) + "</p>" +
        '<p class="meta"><span>Origin: ' + esc(e.origin) + "</span>" +
        "<span>Ordinance: " + esc(e.ordinance_number || "not yet located") + "</span>" +
        "<span>Canvass: " + esc(STATUS_LABEL[e.canvass_status] || "unknown") + "</span>" +
        sourceLinks(e.sources) + "</p>" +
        (kids.length
          ? '<p class="meta">' + kids.map(function (k) {
              return '<a href="' + ROOT + "changes.html#" + esc(k.change_id) + '">' +
                (k.proposition_number ? esc(k.proposition_number) + ". " : "") + esc(k.title) + "</a>";
            }).join("") + "</p>"
          : "") +
        "</div>";
    }).join("");
  }

  function renderBeforeNow() {
    var sel = document.getElementById("bn-select");
    var host = document.getElementById("bn-result");
    if (!sel || !host) return;

    var recs = DATA.amendments.records;
    sel.innerHTML = '<option value="">Choose a charter change</option>' +
      recs.map(function (r) {
        return '<option value="' + esc(r.change_id) + '">' +
          esc(r.date) + " - " + (r.proposition_number ? esc(r.proposition_number) + ". " : "") +
          esc(r.title) + "</option>";
      }).join("");

    function draw() {
      var r = amendment(sel.value);
      if (!r) { host.innerHTML = "<p>Choose a change above to compare the language.</p>"; return; }
      host.innerHTML = recordHtml(r) +
        "<h3>Why it matters</h3><p class=\"prose\" data-gloss>" +
        esc(r.government_effect || "Not yet assessed.") + "</p>" +
        "<h3>Evidence</h3>" +
        (r.sources && r.sources.length
          ? "<ul>" + r.sources.map(function (id) {
              var s = DATA.sources.records.filter(function (x) { return x.source_document_id === id; })[0];
              return s ? '<li><a href="' + esc(s.source_url) + '" rel="noopener">' + esc(s.title) +
                "</a>, " + esc(s.entity) + ", " + esc(s.date || "undated") + " " +
                statusBadge(s.verification_status) + "</li>" : "";
            }).join("") + "</ul>"
          : "<p>No source records attached yet.</p>") +
        (r.old_text_status === "RESEARCH_NEEDED"
          ? '<p class="missing-note">This comparison relies on a description of the prior language, not the prior language itself. A difference in wording is not proof that the section changed. Historical comparison under research.</p>'
          : "");
      glossary();
    }

    sel.addEventListener("change", draw);
    if (qs("change")) { sel.value = qs("change"); }
    draw();
  }

  function topicCard(t) {
    return '<div class="card" id="' + esc(t.topic_id) + '"><h3>' + esc(t.name) + "</h3>" +
      statusBadge(t.charter_text_status) +
      "<dl data-gloss>" +
      "<dt>What is this?</dt><dd>" + esc(t.what_is_it) + "</dd>" +
      (t.can_residents_do_it ? "<dt>Can residents do it?</dt><dd>" + esc(t.can_residents_do_it) + "</dd>" : "") +
      "<dt>What requirements apply?</dt><dd>" +
        (t.requirements ? esc(t.requirements) : "Not yet obtained from the charter.") + "</dd>" +
      "<dt>Has this changed?</dt><dd>" + esc(t.has_changed) + "</dd>" +
      "<dt>Where is it in the charter?</dt><dd>" +
        (t.charter_location ? esc(t.charter_location) : "Section not yet identified.") + "</dd>" +
      "<dt>Why it matters</dt><dd>" + esc(t.why_it_matters) + "</dd>" +
      "</dl>" +
      '<p class="meta">' + sourceLinks(t.sources) +
      (t.related_amendments && t.related_amendments.length
        ? t.related_amendments.map(function (id) {
            return '<a href="' + ROOT + "changes.html#" + esc(id) + '">' + esc(id) + "</a>";
          }).join("")
        : "") + "</p>" +
      (t.charter_text ? "" : '<p class="missing-note">Current charter language not yet transcribed.</p>') +
      "</div>";
  }

  function renderTopicGroup(hostId, ids) {
    var host = document.getElementById(hostId);
    if (!host) return;
    host.className = "cards";
    host.innerHTML = ids.map(function (id) {
      var t = topic(id);
      return t ? topicCard(t) : "";
    }).join("");
    glossary();
  }

  function renderTopicDetail() {
    var host = document.getElementById("topic-detail");
    if (!host) return;
    var t = topic(qs("id"));
    var h1 = document.querySelector(".hero h1");
    if (!t) {
      if (h1) h1.textContent = "Topic not found";
      host.innerHTML = "<p>No topic matches that address. " +
        '<a href="' + ROOT + 'resident-powers.html">Back to resident powers</a>.</p>';
      return;
    }
    document.title = t.name + " | Cove Charter Watch";
    if (h1) h1.textContent = t.name;

    var rel = (t.related_amendments || []).map(amendment).filter(Boolean);

    host.innerHTML = topicCard(t) +
      "<h2>Charter language</h2>" +
      (t.charter_text
        ? '<div class="tabpanel"><p>' + esc(t.charter_text) + "</p></div>"
        : pending("Current charter language not yet transcribed. Obtain it from the official charter before anything is written here.")) +
      "<h2>Historical changes</h2>" +
      (rel.length ? rel.map(recordHtml).join("") : pending("Historical comparison under research."));
    glossary();
  }

  function renderQuestions() {
    var host = document.getElementById("questions");
    if (!host) return;

    var Q = [
      { q: "Can residents recall a council member?", t: "recall",
        short: "Not answerable yet from the record.",
        body: "Texas home rule charters generally provide recall and Copperas Cove is a home rule city, so a recall provision almost certainly exists. This site will not print a signature number or a deadline until the charter's recall section is obtained, because a wrong number would send someone down a dead end." },
      { q: "Can residents recall the mayor?", t: "recall",
        short: "Not answerable yet from the record.",
        body: "Same gap as above. Some charters exclude the mayor or apply a different threshold. The section text decides it." },
      { q: "Can residents fire the City Manager?", t: "city-manager",
        short: "No, not directly.",
        body: "The city manager is appointed by the council, not elected by residents. Residents act on the city manager indirectly, by electing the council that appoints and supervises that position." },
      { q: "Can the Council fire the City Manager?", t: "city-manager",
        short: "Almost certainly yes, under conditions set by the charter.",
        body: "The removal process, including whether it takes a simple majority or a supermajority and whether notice and a hearing are required, is in the charter's city manager section, which has not been obtained." },
      { q: "Can the Council borrow money without a public bond election?", t: "debt-bonds",
        short: "Under state law, in some circumstances yes.",
        body: "Texas cities have borrowing methods that do not require a bond election, though some carry notice requirements and a petition right for residents. Whether the Copperas Cove charter adds a stricter local limit on top of state law is unknown until the finance article is obtained. Legal interpretation may require additional review." },
      { q: "Can residents force an ordinance onto the ballot?", t: "initiative",
        short: "Yes, through initiative.",
        body: "The charter provides for initiative petitions. We know this indirectly because the 2021 ballot included Measure F, which changed what a signer must write on an initiative or referendum petition. The signature count required has not been obtained." },
      { q: "Can residents challenge an ordinance the Council already passed?", t: "referendum",
        short: "Yes, through referendum.",
        body: "Same petition process as initiative, aimed at an ordinance already passed. The deadline for filing after passage matters as much as the signature count, and neither has been obtained." },
      { q: "Can the Council change the Charter itself?", t: "charter-amendments",
        short: "No. Only voters can approve a charter amendment.",
        body: "A charter amendment requires approval by a majority of the qualified voters who vote at an election held for that purpose, under Texas Local Government Code sec. 9.005(a). The Attorney General has opined that a charter cannot provide for amendment by ordinance alone. The council does control which proposals reach the ballot and how they are worded, so both statements are true at once." },
      { q: "Who fills a vacant Council seat?", t: "vacancies",
        short: "Not answerable yet from the record.",
        body: "The charter says whether a vacancy is filled by council appointment or by special election, and often sets a cutoff based on how much of the term is left. That section has not been obtained." },
      { q: "What happens if several Council seats become vacant at once?", t: "vacancies",
        short: "Not answerable yet from the record.",
        body: "Two things decide it: the rule for a single vacancy, and whether the charter sets a point at which too many vacancies force a special election rather than appointments. Measure C in 2021 touched the related forfeiture of office hearing process." },
      { q: "How are Charter amendments approved?", t: "charter-amendments",
        short: "By a majority of voters voting at an election held for that purpose.",
        body: "State law also limits how often a city may order a charter amendment election. The current statute text has not been pulled, so the exact interval is not stated here." },
      { q: "Can the Council raise its own pay?", t: "council-authority",
        short: "No. Pay is set in the charter, so it takes a vote of residents.",
        body: "Residents rejected an increase in November 2021 and rejected a larger one in November 2023, the second time by a reported 1,393 against to 960 for." }
    ];

    host.innerHTML = Q.map(function (x) {
      var t = topic(x.t);
      return '<article class="record"><h3>' + esc(x.q) + "</h3>" +
        '<p><strong>' + esc(x.short) + "</strong></p>" +
        '<p class="prose" data-gloss>' + esc(x.body) + "</p>" +
        '<p class="meta">' +
        "<span>Charter citation: " + esc((t && t.charter_location) || "not yet identified") + "</span>" +
        (t ? '<a href="' + ROOT + "topic.html?id=" + esc(t.topic_id) + '">Full topic page</a>' : "") +
        (t ? sourceLinks(t.sources) : "") + "</p></article>";
    }).join("");
    glossary();
  }

  function renderPowerShift() {
    var host = document.getElementById("power-shift");
    if (!host) return;
    var groups = ["Residents", "Mayor", "City Council", "City Manager", "City Administration"];

    var rows = DATA.amendments.records.filter(function (r) {
      return (r.categories || []).length;
    }).map(function (r) {
      var effect = "Potential effect: not classified";
      var cats = r.categories || [];
      if (cats.indexOf("Resident Power Increased") > -1) effect = "Potential effect: resident authority expanded";
      else if (cats.indexOf("Resident Power Reduced") > -1) effect = "Potential effect: resident authority reduced";
      else if (cats.indexOf("Council Power Increased") > -1) effect = "Potential effect: council authority expanded";
      else if (cats.indexOf("City Manager Power Changed") > -1) effect = "Potential effect: city manager role changed";
      else if (cats.indexOf("Needs Legal Review") > -1) effect = "Potential effect: unclear, needs legal review";
      else if (cats.indexOf("Administrative Change") > -1) effect = "Potential effect: administrative only";

      return "<tr><td>" + esc(r.date) + "</td><td>" +
        '<a href="' + ROOT + "changes.html#" + esc(r.change_id) + '">' + esc(r.title) + "</a></td>" +
        "<td>" + esc(effect) + "</td><td>" + statusBadge(r.verification_status) + "</td></tr>";
    }).join("");

    host.innerHTML =
      "<p class=\"prose\">Every line below is written as a potential effect, not a finding. " +
      "A classification here is a starting point for reading the actual charter text, not a conclusion " +
      "about anyone's motives. Where the legal text does not clearly establish a shift, the row says so.</p>" +
      "<table><caption class=\"visually-hidden\">Potential authority shifts by amendment</caption>" +
      "<thead><tr><th scope=\"col\">Date</th><th scope=\"col\">Change</th>" +
      "<th scope=\"col\">Potential effect</th><th scope=\"col\">Evidence status</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table>" +
      "<p class=\"prose\">Groups tracked: " + groups.join(", ") + ". " +
      "Most rows cannot yet be assigned to a group because the charter text behind them has not been obtained.</p>";
  }

  function renderSources() {
    var host = document.getElementById("source-list");
    var needHost = document.getElementById("needed-list");
    var typeSel = document.getElementById("src-type");
    var input = document.getElementById("src-q");
    if (!host) return;

    var recs = DATA.sources.records;

    if (typeSel) {
      var types = recs.map(function (r) { return r.document_type; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
      typeSel.innerHTML = '<option value="">All document types</option>' +
        types.map(function (t) { return '<option>' + esc(t) + "</option>"; }).join("");
    }

    function draw() {
      var q = (input && input.value || "").toLowerCase();
      var t = typeSel && typeSel.value;
      var shown = recs.filter(function (r) {
        if (t && r.document_type !== t) return false;
        if (!q) return true;
        return JSON.stringify(r).toLowerCase().indexOf(q) > -1;
      });
      host.innerHTML = shown.length ? shown.map(function (s) {
        return '<article class="source"><h3><a href="' + esc(s.source_url) + '" rel="noopener">' +
          esc(s.title) + "</a></h3>" + statusBadge(s.verification_status) +
          '<p class="pub"><span class="doctype">' +
          esc(String(s.document_type || "source").toUpperCase()) + "</span>" +
          "<span>" + esc(s.entity) + "</span><span>" + esc(s.date || "undated") + "</span>" +
          "<span>Local copy: " + esc(s.local_copy || "none") + "</span>" +
          "<span>SHA-256: " + esc(s.sha256 || "not hashed") + "</span>" +
          "<span>Pages: " + esc(s.page_count == null ? "unknown" : s.page_count) + "</span>" +
          (s.sections && s.sections.length ? '<span class="cite">Sec. ' + s.sections.map(esc).join(", ") + "</span>" : "") +
          "</p><p>" + esc(s.notes) + "</p></article>";
      }).join("") : "<p>No sources match that search.</p>";
    }

    if (input) input.addEventListener("input", draw);
    if (typeSel) typeSel.addEventListener("change", draw);
    draw();

    if (needHost) {
      needHost.innerHTML = "<table><thead><tr><th scope=\"col\">Document type</th>" +
        "<th scope=\"col\">What is needed</th><th scope=\"col\">Where to get it</th></tr></thead><tbody>" +
        (DATA.sources.needed || []).map(function (n) {
          return "<tr><td>" + esc(n.document_type) + "</td><td>" + esc(n.what) +
            "</td><td>" + esc(n.where) + "</td></tr>";
        }).join("") + "</tbody></table>";
    }
  }

  function renderSearch() {
    var input = document.getElementById("q");
    var host = document.getElementById("results");
    if (!input || !host) return;

    var index = [];
    DATA.amendments.records.forEach(function (r) {
      index.push({
        kind: "Charter change",
        title: (r.proposition_number ? r.proposition_number + ". " : "") + r.title,
        blurb: r.plain_language_summary,
        href: ROOT + "changes.html#" + r.change_id,
        status: r.verification_status,
        text: JSON.stringify(r)
      });
    });
    DATA.topics.records.forEach(function (t) {
      index.push({
        kind: "Topic",
        title: t.name,
        blurb: t.what_is_it,
        href: ROOT + "topic.html?id=" + t.topic_id,
        status: t.charter_text_status,
        text: JSON.stringify(t)
      });
    });
    DATA.sources.records.forEach(function (s) {
      index.push({
        kind: "Source document",
        title: s.title,
        blurb: s.notes,
        href: ROOT + "sources.html",
        status: s.verification_status,
        text: JSON.stringify(s)
      });
    });
    Object.keys(DATA.glossary.terms).forEach(function (k) {
      index.push({
        kind: "Glossary",
        title: k,
        blurb: DATA.glossary.terms[k],
        href: ROOT + "search.html?q=" + encodeURIComponent(k),
        status: null,
        text: k + " " + DATA.glossary.terms[k]
      });
    });
    charterSections().forEach(function (s) {
      index.push({
        kind: "Charter section",
        title: "Sec. " + s.section + " " + (s.section_title || s.name || ""),
        blurb: s.legal_text || s.text || "Text not yet transcribed from the official charter.",
        href: ROOT + "changes.html",
        status: s.status,
        text: JSON.stringify(s)
      });
    });

    function draw() {
      var q = input.value.trim().toLowerCase();
      if (!q) { host.innerHTML = "<p>Type a word such as recall, bonds, city manager, mayor, taxes, referendum or debt.</p>"; return; }
      var hits = index.filter(function (x) { return x.text.toLowerCase().indexOf(q) > -1; });
      host.innerHTML = "<p>" + hits.length + " result" + (hits.length === 1 ? "" : "s") + "</p>" +
        hits.map(function (x) {
          return '<article class="record"><h3><a href="' + esc(x.href) + '">' + esc(x.title) + "</a></h3>" +
            '<p class="meta"><span>' + esc(x.kind) + "</span>" + statusBadge(x.status) + "</p>" +
            "<p>" + esc(x.blurb || "") + "</p></article>";
        }).join("");
    }

    input.addEventListener("input", draw);
    if (qs("q")) input.value = qs("q");
    draw();
    input.focus();
  }

  function wireFilters() {
    var bar = document.querySelector(".filters");
    if (!bar) return;
    bar.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      filter = b.dataset.filter;
      bar.querySelectorAll("button").forEach(function (x) {
        x.setAttribute("aria-pressed", String(x === b));
      });
      renderChanges();
    });
  }

  function wireTabs() {
    document.querySelectorAll(".tabs").forEach(function (bar) {
      bar.addEventListener("click", function (ev) {
        var b = ev.target.closest("button");
        if (!b) return;
        bar.querySelectorAll("button").forEach(function (x) {
          x.setAttribute("aria-selected", String(x === b));
        });
        var group = bar.dataset.tabs;
        document.querySelectorAll('[data-tabpanel="' + group + '"]').forEach(function (p) {
          p.hidden = p.dataset.tab !== b.dataset.tab;
        });
      });
    });
  }

  /* ---------------------------------------------------------------- boot */

  var FILES = {
    amendments: "data/amendments/amendments.json",
    elections: "data/elections/elections.json",
    sources: "data/sources/sources.json",
    topics: "data/topics/topics.json",
    charter: "data/charter/current.json",
    audit: "data/audit.json",
    provenance: "data/charter/provenance.json",
    glossary: "data/glossary.json"
  };

  function loadError(err) {
    var main = document.querySelector("main .wrap") || document.body;
    var offline = location.protocol === "file:";
    var box = document.createElement("div");
    box.className = "callout";
    box.setAttribute("role", "alert");
    box.innerHTML = offline
      ? "<h3>This page needs a local web server</h3>" +
        "<p>The site reads its records from JSON files, and browsers block that when a page is " +
        "opened straight from the file system. Run <code>python3 -m http.server 8080</code> in the " +
        "project folder and open <code>http://localhost:8080</code>.</p>"
      : "<h3>Records failed to load</h3><p>" + esc(err && err.message ? err.message : String(err)) +
        "</p><p>Check that the <code>data/</code> folder deployed alongside the pages.</p>";
    main.insertBefore(box, main.firstChild);
  }

  Promise.all(Object.keys(FILES).map(function (k) {
    return fetch(ROOT + FILES[k]).then(function (r) {
      if (!r.ok) throw new Error(FILES[k] + " returned " + r.status);
      return r.json();
    }).then(function (j) { DATA[k] = j; });
  })).then(function () {
    renderStats();
    renderStatusBoard();
    renderAudit();
    renderProvenance();
    if (page === "changes") { wireFilters(); renderChanges(); }
    if (page === "timeline") renderTimeline();
    if (page === "before-now") renderBeforeNow();
    if (page === "resident-powers") renderTopicGroup("topic-cards",
      ["recall", "initiative", "referendum", "charter-amendments", "elections"]);
    if (page === "council") renderTopicGroup("topic-cards", ["council-authority", "mayor-authority", "budget", "vacancies"]);
    if (page === "city-manager") renderTopicGroup("topic-cards", ["city-manager"]);
    if (page === "debt") renderTopicGroup("topic-cards", ["debt-bonds", "budget"]);
    if (page === "recall") renderTopicGroup("topic-cards", ["recall", "elections", "initiative", "referendum"]);
    if (page === "topic") renderTopicDetail();
    if (page === "questions") renderQuestions();
    if (page === "power-shift") renderPowerShift();
    if (page === "sources") renderSources();
    if (page === "search") renderSearch();
    if (page === "charter") renderCharter();
    wireTabs();
    glossary();
    if (location.hash) {
      var t = document.getElementById(location.hash.slice(1));
      if (t) t.scrollIntoView();
    }
  }).catch(loadError);

  chrome();
})();
