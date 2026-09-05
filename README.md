# Cove Charter Watch

An independent civic research project tracking how the Copperas Cove, Texas home rule charter
has changed, who changed it, and what those changes mean for residents.

Research prepared by Marimer Cruz-Nieves.

---

## What this is technically

Fully static. Fourteen HTML pages, one stylesheet, one script, six JSON data files.

- No build step, no framework, no Bootstrap, no Tailwind
- No `package.json`, no npm install
- No backend, no database, no API keys
- No cookies, no analytics, no third-party requests

Charter data is kept entirely separate from presentation code. Every page reads from
`/data/`. To add an amendment or close a gap you edit JSON, never HTML.

## Folder structure

```
cove-charter-watch/
├── index.html                      Homepage, statistics, navigation
├── changes.html                    Charter change database, filterable
├── timeline.html                   Chronological charter timeline
├── before-now.html                 Before vs. Now comparison tool
├── resident-powers.html            Resident power map
├── council.html                    Council authority
├── city-manager.html               City manager authority and structure diagram
├── debt.html                       Debt and bonds explainer
├── recall.html                     Elections and recall
├── questions.html                  What does this mean for me
├── power-shift.html                Who holds the power
├── sources.html                    Source library and records still needed
├── search.html                     Universal search
├── topic.html                      Single topic detail, e.g. topic.html?id=recall
├── assets/
│   ├── style.css
│   └── app.js
├── data/
│   ├── charter/current.json        Current charter sections. Transcription only
│   ├── charter/historical/         One file per superseded charter version
│   ├── amendments/amendments.json  The change database
│   ├── elections/elections.json
│   ├── sources/sources.json        Source library plus a `needed` list
│   ├── topics/topics.json          The ten priority topics
│   └── glossary.json
├── research/index.html             Research mode. See the warning below
├── research-private/               Unpublished notes. Gitignored. Never deploy
└── README.md
```

## Run it locally

```
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

A local server is required. The site reads JSON with `fetch()`, and browsers block that
on `file://`. Opening `index.html` by double-clicking shows a message saying exactly this
rather than failing silently.

### Verify it worked

1. Homepage statistics render six values. "Charter adopted" should read
   **Research in progress**, not a year. If it shows a year, someone put an unverified
   date in `data/charter/current.json`.
2. Go to Charter Changes and press **Research needed**. Two records should remain, the
   2018 election and the 2023 propositions C through E.
3. Go to Search and type `recall`. You should get hits across topics, changes and glossary.
4. On any page, click a dotted underlined word such as home rule. A definition should open.
5. Open `topic.html?id=recall`. The heading should change to Recall, and historical
   comparison should read **Historical comparison under research**.

## Deploy to Cloudflare Pages

```
cd cove-charter-watch
git init
git remote add origin https://github.com/cryptoqueen23/homerulecharter.git
git add .
git commit -m "Cove Charter Watch: framework and sourced records"
git branch -M main
git push -u origin main
```

In the Cloudflare dashboard:

1. **Workers and Pages** → **Create** → **Pages** → **Connect to Git**
2. Select `cryptoqueen23/homerulecharter`
3. Framework preset: **None**
4. Build command: **leave empty**
5. Build output directory: `/`

If the repository root contains the `cove-charter-watch` folder rather than the files
themselves, set the output directory to `cove-charter-watch`.

### Verify the deploy

- Open the `*.pages.dev` URL. Statistics must render, not sit blank.
- Open `/sources.html` by typing the URL directly. It must load, not 404.
- Open `/data/amendments/amendments.json` directly. It should return JSON. If it 404s,
  the `data/` folder did not deploy and every page will show a load error.
- Confirm `/research-private/notes.json` returns **404**. If it returns JSON, the
  gitignore was bypassed and private notes are public. Remove them from the repository
  history, not just the working tree.

## Security warning about research mode

**A static site has no server, so it cannot authenticate anyone.** Every file in the
repository is readable by anyone who knows or guesses its URL. There is no way to add a
password to `/research/` with HTML and JavaScript alone, and any check written in the
browser can be bypassed by viewing source.

Two safe options:

1. Keep `research/` out of the deployed branch and run it locally only.
2. Deploy it and add a **Cloudflare Access** policy on the `/research/*` path, so
   Cloudflare authenticates the request before the file is ever served.

Unpublished notes stay in `research-private/`, which is gitignored. Do not move them into
`data/` to make them load in the site. That publishes them.

## Evidence rules

These govern every record. They are not style preferences.

| Status | Meaning |
| --- | --- |
| `VERIFIED` | A primary source confirms the change |
| `PARTIALLY_VERIFIED` | Some evidence exists, but one part is missing |
| `RESEARCH_NEEDED` | Historical evidence has not yet been located |

1. Never invent a charter amendment.
2. Never assume old wording. `old_text` holds transcription only. A description taken from
   news coverage goes in `old_text_described` and is labeled as a description on the page.
3. A difference in wording is not proof that a section changed. Only a historical record
   establishes the earlier version.
4. Every historical claim links to evidence in `data/sources/sources.json`.
5. Documented fact, interpretation, investigative lead and missing record stay visibly separate.
6. Missing evidence does not prove that something did not happen.
7. No accusation of corruption, misconduct or illegality against any official unless an
   authoritative source establishes it.
8. Where legal interpretation is uncertain, say **legal interpretation may require
   additional review**.

Right now **zero** amendment records are `VERIFIED`. That is correct. Everything currently
on file rests on news coverage, which is secondary evidence. The status rises when the
canvass, the ordinance or the charter text arrives.

## Chronium Mind integration

The data files are the contract. Chronium supplies archived pages, historical PDFs, OCR
text, document hashes, version comparisons, provenance and citation metadata. It writes
into `data/sources/sources.json` (including `local_copy`, `sha256`, `page_count`) and
`data/charter/historical/`. The public site consumes only records already marked as
published. Raw research output never renders directly.

## What is populated and what is not

Populated from sourced material:

- The thirteen November 2, 2021 measures, A through M, with committee origin and dates
- The November 7, 2023 propositions, including the rejected pay increase and its reported
  vote of 960 for and 1,393 against
- The state rule that only voters can approve a charter amendment
- Ten priority topics, each with a current page even where history is missing
- Twenty-three glossary terms, nine source records, seven document types still needed

Not populated, and deliberately visible as gaps:

- The charter text itself. Municode renders in the browser and cannot be fetched
  automatically. Use its **Download (Docx)** control at the Charter or Article level.
- The original adoption date. A 1979 date circulates informally and is **not** treated as
  verified anywhere in this project.
- Canvassed outcomes for twelve of the thirteen 2021 measures.
- The entire November 2018 election record.
