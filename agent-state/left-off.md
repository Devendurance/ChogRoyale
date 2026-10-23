# Left Off

Last updated: 2026-10-23

## P3a real Arena Patron NFT sourcing, complete (local commit, no push)

- Battle path was already genuine (indexed pool lock, verified snapshot, v2 evidence, fail-closed start, legacy re-verification, v1 excluded, Paragon at 10). The slice hardened the public read path: patron detail and chaos preview routes now verify through `lockedPatronFromNft`, wrong-collection rows 404, unresolved rows 422, client query traits ignored, provenance carries source/chain/contract/attributes. `createPatronAssignment` adds the chainId check.
- `testLockedPatron` labelled offline fixture; genuine acceptance runs through the real TEST-branch indexer write/read path. New focused route tests 7/7, patron-source 12/12, patrons DB 4/4, typecheck, lint and build green.
- Local commit: pending (scoped: 2 routes, db/patrons, test-helpers comment, 1 new test file). Pre-existing `.fast-build/STATE.md`, `DESIGN.md` and `docs/Chog Royale messaging.md` changes untouched. No push, no deploy, no PROD writes.
- Next: owner review. Do not start P3b.
