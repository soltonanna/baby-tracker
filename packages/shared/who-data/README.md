# WHO Child Growth Standards — source data

These are the **daily** LMS tables of the WHO Child Growth Standards (2006).
The app uses them to place a measurement on the WHO curves for the baby's age
and sex.

| File            | Indicator                 | Unit |
| --------------- | ------------------------- | ---- |
| `weianthro.txt` | Weight-for-age            | kg   |
| `lenanthro.txt` | Length/height-for-age     | cm   |
| `hcanthro.txt`  | Head circumference-for-age| cm   |

Columns: `sex` (1 = male, 2 = female), `age` (completed days, 0–1856),
`l`, `m`, `s`; `lenanthro` also has `loh` (`L` = recumbent length, used up to
day 730; `H` = standing height after).

## Provenance

Copied unchanged from WHO's own R package, the reference implementation behind
WHO Anthro:

- Repository: https://github.com/WorldHealthOrganization/anthro
- Path: `data-raw/growthstandards/`
- Commit: `b776d8a12b1c97369c748b561159fd2ec4f4db58` (2026-01-30)

The WHO standards page (https://www.who.int/tools/child-growth-standards/standards)
publishes the same parameters as monthly PDF/XLSX tables. The monthly PDFs in
the project's `who_standards/` folder are used by
`src/growth/who.test.ts` as an independent check: the daily rows, interpolated
to each month (month × 30.4375 days), reproduce the published L, M, S and the
printed SD curves.

## Using them

`scripts/generate-who-tables.mjs` turns birth–day 730 of these files into
`src/growth/whoTables.ts`. Do not edit that file by hand; change the source or
the script and regenerate:

    node scripts/generate-who-tables.mjs

## Terms

The growth standards are published by the World Health Organization. Check
WHO's terms of use before any commercial distribution of the app.
