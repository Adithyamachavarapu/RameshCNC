# RameshCNC Tool Finder

A simple, local, dependency-free tool finder for RameshCNC using the Unitec Master Catalogue 2026–27.

## Run it

From this folder, start a small local web server:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173>.

The catalogue is pre-indexed in `data/catalogue.json`. To rebuild the index from the source PDF:

```bash
python3 scripts/build_catalogue.py \
  "/Users/adithyamachavarapu27/Desktop/UNITEC Master Catalogue 2026-27.pdf" \
  data/catalogue.json
```

The index keeps all 622 pages as searchable records and links each detected catalogue identifier to every page where it appears. The finder also builds a bidirectional recommendation graph: an insert can surface its matching holder or adapter, and selecting that holder can surface the inserts/tools printed with it. Pairings are limited to shared source pages or relationship language present in the catalogue such as “matching”, “fits”, or “compatible”.

When an exact item is searched or selected, the result dialog shows `Catalog No.`, `Designation`, `Grade`, `Item type`, and the source page. Because the supplied Unitec PDF does not contain a separate numeric catalog-number column, `Catalog No.` uses the exact Unitec designation/order code rather than inventing a number.
