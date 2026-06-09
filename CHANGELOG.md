# Changelog

## 0.1.0 - Release candidate

- Added byte-aware RTF parsing helpers and Scrivener project parsing for binder,
  documents, comments, snapshots, metadata, settings, resources, and compile plans.
- Made project parsing defaults lightweight: RTF decoding, snapshots, and derived
  binder display titles must be requested explicitly.
- Added release packaging checks so npm tarballs are built from a fresh `dist`.
- Documented best-effort RTF table and bookmark extraction.
