# Charter snapshots

One immutable file per successful charter retrieval, named by date.

Rules:

1. Never overwrite a snapshot. The scripts append `-2`, `-3` and so on if a file
   for that date already exists.
2. Never edit a snapshot by hand. A snapshot is a record of what Municode said
   on a date. Editing it destroys the only thing it is good for.
3. Snapshots are what make change detection possible. The first one establishes
   a baseline and detects nothing, which is expected.
4. `detected-changes.json` in the parent folder is regenerated on each diff and
   is not a snapshot. It is disposable output.

Empty until the first successful ingest.
