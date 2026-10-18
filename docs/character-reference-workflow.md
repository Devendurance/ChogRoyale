# Chog Royale character reference workflow

Research snapshot: 2026-10-18. Proposal only. No exporter, Tripo jobs, new metadata, gameplay changes, or database changes are included.

## Production pilot

Prepare seven assets: one real NFT commander for each of the five playable classes, plus two original troops. Keep NFT identity, derived game class, and authored production additions as separate records.

The collection identity is Monad chain `143`, contract `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`. All 1,969 indexed tokens were resolved for this research. Current derived class counts are bulwark 597, reaver 523, deadeye 245, scout 316, and warden 288. Classes come from the existing v1 trait rules, never a random token assignment or an artist's impression of the image.

| Class | On-chain token ID | Metadata display name | Current winning score / next score | Identity anchors from actual metadata |
| --- | --- | --- | --- | --- |
| Bulwark | `341` | `CHOG #1802` | 9 / 1.5 | White tuxedo, Spartan Helmet, Black skin, Round eyes, Sad, Clean aura |
| Reaver | `897` | `CHOG #389` | 12.5 / 1 | Skull form/base, Red skin, Duck Float, Dead eyes, Balls Cap, Fiery Aura |
| Deadeye | `171` | `CHOG #1632` | 6 / 2.5 | CWO, Plasma visor, Balls Cap, Violet aura, Smile |
| Scout | `1128` | `CHOG #620` | 7 / 1.5 | Red skin, Black Trackset, Anime Glass, Gray Bucket Cap, wo |
| Warden | `1720` | `CHOG #1212` | 12 / 1.5 | Black skin, White Pure Shirt, Wizard Hat, Teary, Bubblegum, Royal Blue Aura |

These are selected, verified candidates with strong class-score margins, not an objective ranking of the collection's best artwork. Table labels summarize selected attributes, not complete metadata documents. Export every exact `trait_type` and `value`, including unusual strings such as `CWO` and `wo`, without correcting their spelling or inventing their meanings. Preserve numeric trait values as numbers.

The five source images were visually inspected. Each is a 1000 x 1000 portrait with cropped body and headwear. Pure derivation from stored real attributes matched the persisted class and derivation hash for every candidate. Selection is ready for production review, while full-body adaptations still need approval. Research evidence and original WebP downloads are saved outside the repository in `C:/Users/USER/Documents/ChogRoyale-Assets/reference-research-20261018/`, including `verified-pilot-evidence.json`. These are research snapshots, not finished reference packs.

- Token 341: preserve the white tuxedo, Spartan helmet, expression, black outer spikes, and brown face. The `Black` skin trait does not mean every visible skin region should be painted black.
- Token 897: preserve the prominent yellow duck float even though the derived class is reaver. Consider a separate attachment in Blender, without replacing it with generic bruiser armor.
- Token 171: preserve the opaque rainbow/plasma visor. Eyes behind it are unknown and must not be presented as official NFT detail.
- Token 1128: the red trait corresponds to red outer spikes in the image, while the face is cream. Preserve the depicted region colors, trackset, glasses, and bucket cap.
- Token 1720: preserve the black outer spikes, brown face, white shirt, wizard hat, bubblegum, and aura. Retain the portrait's expression when translating the face into 3D.

Use these two authored roster entries for original troop work:

| Troop | Existing gameplay facts | Pilot purpose |
| --- | --- | --- |
| `choglings` | Three ground melee units per card, low health | Propose a small readable baseline, shared rig, and group readability |
| `boulderback` | One slow, durable ground melee unit with structure priority | Establish a contrasting large silhouette and heavy movement |

Neither troop receives an NFT token ID, NFT owner, fabricated NFT traits, or a commander class. Their appearance needs original concept approval. A name such as Boulderback suggests a direction but does not prove an existing canonical stone-shell design.

The full current troop roster in `src/lib/combat.ts`, `TROOP_CARDS_V1`, is Choglings, Chaos Archer, Boulderback, Frostshell, Rift Runner, Sparkcaster, Chog Guardian, and Hexwing. Their roles cover swarm melee, paired ranged anti-air, structure pressure, slowing melee, fast structure pressure, ranged splash, durable melee, and flying ranged attack. Chaos Bolt and Rally Horn are spells, not character candidates. Free commander templates are gameplay starters, not Genesis artwork sources.

## Existing sources and retrieval

The application already preserves the real collection. Reuse it instead of building another indexer.

| Need | Existing path | Export behavior |
| --- | --- | --- |
| Token identity and source URI | `src/db/nfts.ts`, `getNftByTokenId(tokenId)` | Read `token.chainId`, `contractAddress`, `tokenId`, `tokenUriOriginal` |
| Complete original metadata semantics | Same helper, `metadata.documentOriginal` | Require `status === "resolved"`, preserve the JSON document, never synthesize missing traits |
| Artwork pointer | `metadata.imageOriginal`, also `documentOriginal.image` | Preserve original URI and download original bytes with recorded final gateway URL |
| Exact attributes | `metadata.attributesOriginal` | Export original trait names, values, and types alongside a human-readable summary |
| Metadata provenance | `metadata.contentHash`, `sourceUrl`, `fetchedAt` | Keep source hash distinct from locally serialized file hash |
| Commander link | `src/db/commanders.ts`, `getCommanderByTokenId(tokenId)` | Record persisted class, ruleset version, score/signals snapshot, hash, and derivation timestamp |
| Fresh class validation | `src/lib/commanders.ts`, pure `deriveCommander({ attributes })` | Recompute in memory from the exported real attributes, compare current class and derivation hash |
| Optional owner observation | `latestObservation` from NFT helper | Mark cached with `observedAt` and source, omit from vendor upload |
| Optional local player link | Latest ownership observation joined to `player_wallets.address_normalized` | Internal audit only, no need for player IDs, emails, or wallet addresses in an art brief |

Relevant tables are `nft_tokens`, `nft_metadata`, `nft_ownership_observations`, `commanders`, and `player_wallets`. NFT identity is `(chainId, contractAddress, tokenId)`, not metadata name, artwork filename, or a local player identity. Commander linkage follows the NFT key, not an owner's current holdings.

The read-only HTTP alternative uses the existing application's API envelope, `{ success, data, requestId }`:

1. `GET /api/nfts/341`: read `data.nft`, including token identity, `tokenUri`, `metadata.image`, attributes, status, and cached owner.
2. `GET /api/nfts/341/metadata`: read `data.document`, `status`, `contentHash`, `sourceUrl`, and `fetchedAt`.
3. `GET /api/commanders/341`: require `data.status === "derived"`, read `commander.class`, `scores`, `signals`, `rulesetVersion`, and `provenance`. Investigate `hashMatch === false` before declaring a current persisted snapshot.
4. Optional `GET /api/nfts/341/owner` reads a cached ownership observation. Do not add `?fresh=1`: that path writes a new observation.

Prefer a narrow local read-only Node/TypeScript export using the existing DB helpers, especially if the local HTTP server requires an interactive authenticated session. Never export environment values or credentials. Do not invoke ingestion, ownership synchronization, or `scripts/commanders-derive.ts` to create reference files, since those paths mutate the database. The pure derivation function is sufficient for class validation.

An IPFS URI is a content pointer, not a local filename convention. Resolve the stored image URI through configured `IPFS_GATEWAYS` with `getIpfsGateways()` in `src/lib/metadata.ts`. Keep the IPFS URI in the manifest even when the download uses HTTPS. `src/lib/avatars.ts` contains geometric starter avatars and is not a Genesis artwork source.

On-chain token `341` has metadata name `CHOG #1802`. Its actual token URI is `ipfs://bafybeid4ybujnscdipkno7ps5utqelp5ry5ryreqhay3zhgk3a6x4jruqu/1802.json`, and its actual image URI is `ipfs://bafybeihau2egcccbdxymeckmmbrqytbfor5gkt3en6d5fsbueymdbq7g6e/1802.webp`. Never fetch token `1802` merely because that number appears in the name or an image filename. Record all three values separately when present.

## Folder structure

Keep source documentation and a future small exporter in the repository. Keep artwork, Blender files, vendor downloads, and staging data outside it under the established asset root.

```text
C:/Users/USER/Documents/ChogRoyale-Assets/reference-packs/
  pilot-2026-10-18/
    selection.json                  # seven assets, reason, class expectations
    review.md                       # approval status and open design questions
  nft-commanders/
    monad-143/
      0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763/
        token-000341/
          revisions/r001/
            manifest.json
            source/
              image.webp            # untouched bytes, extension from actual type
              metadata.json         # semantic copy of stored documentOriginal
              metadata.raw.json     # optional, only if original bytes are recovered
              commander.json        # derived class/provenance, not NFT metadata
            analysis/
              traits.md
              palette.json
              character-brief.md
              ownership.internal.json  # optional, excluded from handoff
            prepared/
              cutout.png
              approved-front.png
              approved-side.png
              approved-back.png
              contact-sheet.png     # human review only
              approvals.json
            tripo/
              job.json              # input hashes, settings, model/version, job ID
              raw/                  # original download, preserved before cleanup
            blender/
              working.blend
              review/
            delivery/
              character.glb
              textures/
              validation.md
  original-troops/
    roster-v1/
      choglings/
        revisions/r001/
          manifest.json
          source/roster-snapshot.json
          analysis/character-brief.md
          analysis/palette.json
          concept/                  # original artwork, source/license, approvals
          prepared/                 # approved front, side, back and cutout
          tripo/                    # same job/raw structure
          blender/
          delivery/
      boulderback/
        revisions/r001/              # same original-troop structure
  .staging/                         # per-run temporary outputs, never final packs
```

Repeat the NFT token directory for `000897`, `000171`, `001128`, and `001720`. Class belongs in the manifest rather than the stable directory identity, because a later ruleset could classify the same token differently. Use `r002` for changed inputs or approved design changes. Never replace an approved revision in place. Preserve raw vendor exports and working files needed for recovery, while removing abandoned partial staging output and redundant build clutter.

The manifest needs schema version, asset kind, stable asset ID, revision, creation time, source collection/token or roster ID, metadata status, original URIs, download URLs/times, source hashes, per-file hashes, source dimensions and MIME, source repository commit, commander ruleset/derivation hash, selection reason, rights evidence reference, approval status, and stage status. Use explicit `null` or an unavailable status for missing facts.

`metadata.contentHash` is SHA-256 of the originally downloaded JSON bytes. JSONB storage and pretty-printing do not preserve those bytes. Therefore `sourceMetadataContentHash` and `files["source/metadata.json"].sha256` are different concepts. Mark raw metadata unavailable unless verified raw bytes were recovered. If refetching raw metadata, compare its hash against the recorded source hash and stop on mismatch. Keep a hash of the untouched artwork independently.

## Palette and brief contracts

`traits.md` lists the complete exact attributes, then separately explains the existing game's derived class and matched class signals. Background traits are cosmetic. Tier is prestige-only. Neither Tier nor token ID should justify added armor, weapons, or stronger-looking proportions.

`palette.json` has two distinct sections:

- `traitColorLabels`: exact source labels and trait names, with no invented hexadecimal interpretation.
- `sampledColors`: approximate foreground swatches sampled from the actual image, with region, pixel coordinates or mask, sRGB hex, method, and confidence. Exclude the portrait background from body swatches. Leave unsampled colors empty until sampled. A trait named Red does not prove that the face, clothing, and spikes share one red material.

Use this brief template for each NFT:

```text
Asset kind: nft-commander
Identity: chain / collection / on-chain token ID / exact metadata name
Source: original image and metadata URIs, local hashes, capture date
Gameplay context: current derived class, ruleset, intended role
Observed identity locks: face shape, spike silhouette, expression, clothing,
  headwear, accessories, material regions, visible colors and aura
Exact metadata facts: link to full traits.md and source/metadata.json
Unknown from portrait: unseen anatomy, feet, back, cropped hat construction
Proposed additions: individually labeled original production adaptations
Approved additions: reviewer/date/reference, initially empty
Geometry plan: body, detachable accessories, separate aura/VFX
Reference approval: pending / approved / rejected, with evidence
Delivery targets: approved scale/rig/material/export target sheet
```

For troops, replace NFT identity and metadata facts with `assetKind: original-troop`, roster ID/version, gameplay facts, original concept sources, and concept authorship. Proposed colors, clothing, tools, and body proportions remain design proposals until approved. Keep the same approval and technical target fields.

## Preparing the seven packs

1. Freeze the seven-entry selection manifest. Assert the five expected token-to-class mappings above against current real metadata with `deriveCommander`, recording scores and signals. Do not silently substitute another class or token if anything changed. Record the roster definitions and repository commit for troops.
2. Export resolved metadata and source pointers using read-only queries. Download only the five corresponding original images. Keep exact bytes and metadata provenance, then validate identity, decode images, measure dimensions, and hash files. A missing or failed source remains failed, without a generated replacement.
3. Create trait summaries and regional palette notes. Human review confirms the visible identity locks above. Confirm artwork use and external processing rights before vendor upload, as required by `docs/PRD.md` and `docs/architecture.md`. Ownership and public metadata alone are insufficient evidence of those rights.
4. Approve a shared production target sheet before modeling. `DESIGN.md` is referenced by AGENTS.md but was absent during research. Use the current PRD art direction, vivid playful Chog-inspired fantasy with original troop silhouettes, and obtain explicit decisions for proportions, arena viewing size, rig, scale/axes, material style, texture sizes, polygon budget, and export format. Do not present guessed numeric budgets as established project requirements.
5. Make an untouched-source comparison next to a cleaned derivative. Remove background/aura contamination only in `prepared/`, preserve face proportions, clothing, accessories, and region colors. Keep a separate aura reference so effects can be rebuilt without becoming fused body geometry.
6. Approve original full-body front, side, and back artwork for each asset. The Genesis portraits do not reveal complete bodies, backs, feet, or cropped hat tops. Those regions require artist decisions labeled as adaptations, with review evidence. For troops, approve the original concept first. Generated alternate views require identity review because they can change outfits, face, or accessories.
7. Prepare a neutral plain background, even lighting, full subject, relaxed A-pose where appropriate, and consistent proportions across views. Aim for the subject to occupy about 70-85% of the frame and roughly 1024-pixel input where useful. Preserve the 1000-pixel original. Upscaling does not reveal missing detail. Ensure the whole approved hat and feet fit without cropping.
8. Use Tripo image-to-3D for an approved front reference, or multi-view mode with two to four consistent approved views when the current interface supports it. Upload each view as its own image in the correct orientation slot. A contact sheet is for review, not a multi-view upload. The original NFT portrait is an identity anchor and a useful bust feasibility test, but does not establish a production full-body design.
9. Log submitted input file hashes, view order, brief/prompt text, model/version, settings, date, job ID, job status, and download details. Keep prompts concise and preserve explicit identity locks. Additional views and prompts cannot make unseen NFT anatomy factual. Download the raw result unchanged before editing.
10. Review the first commander and both troop contrasts before spending on the remaining commanders. Continue until the seven-asset coverage pilot is complete. Compare identity, silhouette, proportions, accessories, and foreground colors against approved references. Reject inconsistent reconstructions before polish.
11. Open a separate Blender working file through the existing local MCP bridge. Keep its loopback binding and preserve the live scene. Review geometry, normals, topology, non-manifold surfaces, UVs, material assignments, rig/deformation, scale/origin, attachment separation, and export/reimport behavior against the target sheet. Separate the duck float, hats where useful, and aura/VFX without discarding them.
12. Produce turntables and arena-scale stills for approval, then export the agreed delivery assets. Current project documents target a 2D/2.5D presentation, so 3D production can also feed sprite/animation renders. This pilot does not authorize a renderer migration or imply existing 3D runtime integration.

Tripo preparation references: [better image-to-3D results](https://www.tripo3d.ai/help/features/how-to-get-better-image-to-3d-results) and [effective multi-view input](https://www.tripo3d.ai/help/features/how-to-use-multi-view-input-effectively). Record the actual options offered by the account at job time rather than assuming a fixed vendor UI or API capability.

## Proposed exporter contract

A narrow source-pack exporter is worthwhile now because five immutable identities, provenance checks, and manual copy steps are easy to mix up. Keep Tripo submission, concept approval, and Blender cleanup manual through this seven-asset pilot. Full vendor job orchestration can wait until approved reference standards and rejection rates are known.

Suggested future interface, not an implemented command:

```text
node --import tsx scripts/export-character-references.ts
  --tokens 341,897,171,1128,1720
  --expect-classes 341=bulwark,897=reaver,171=deadeye,1128=scout,1720=warden
  --troops choglings,boulderback
  --out C:/Users/USER/Documents/ChogRoyale-Assets/reference-packs
  --plan
```

`--plan` should show source availability, identity/class validation, and planned paths without downloads or file writes. A separate explicit export mode writes only external files and never changes database rows. A resume mode verifies completed file hashes before skipping, and creates a new revision when inputs differ. No automatic upload is included.

Implement as a small TypeScript CLI reusing the existing DAL and pure derivation. Image downloads need their own guarded binary fetcher because the existing metadata resolver accepts JSON and has metadata-specific limits. Resolve IPFS to approved gateways, allow only safe public HTTPS destinations, revalidate redirects, reject credentials/private destinations, cap redirect count and streamed bytes, set timeouts, and verify actual image bytes/MIME before decoding. Do not just replace `ipfs://` with an unchecked URL and fetch arbitrary metadata-controlled hosts.

Run one download stream, space gateway requests by at least six seconds, respect `Retry-After`, use bounded backoff, cache by immutable URI/content hash, and reuse completed originals. A six-second spacing policy is separate from a request timeout. Never run competing ingest workers to prepare assets. Keep image byte/pixel limits explicit and appropriate for the verified originals rather than borrowing a JSON limit accidentally.

Build each revision in an isolated staging directory and validate required files before an atomic final rename. Track `planned`, `source-complete`, `reference-approved`, `generated`, `blender-reviewed`, `delivered`, and `failed` stages. Failed source fetches must never mark a pack complete or overwrite a good revision. A source-complete pack is not automatically approved for generation.

Before implementing the exporter, define behavioral checks for real token/name separation, expected-class mismatch, unresolved metadata, JSON serialization hashes, bad image MIME, oversized streams, redirect rejection, throttling/resume, interrupted writes, and original-troop separation. Run the repository's normal lint, typecheck, test, and build checks for any implementation change. The current deliverable is this proposal, so no new ingestion or asset-generation pipeline has been executed.
