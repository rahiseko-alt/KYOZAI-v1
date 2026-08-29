# G2 preparatory checklist — document inputs and delivery integrity

Status: preparatory only (not a Gate start)

This checklist records the G2 implementation boundary before G1 has passed.  It
does not change `shared/kyozai-parity-goal.json`, enable uploads, or authorize a
G2 PR.  Its purpose is to prevent an apparently small “enable PDF” change from
bypassing G2 provenance, quota, and package requirements.

## Gate record

- Parent Gate: G2 (pending; G1 remains the active Gate)
- Goal contribution: make a long PDF or Markdown input traceable from the
  accepted private original through normalized chunks into the delivered ZIP.
- Required acceptance evidence: `long_pdf_run`, `long_markdown_run`, and
  `manifest_file_reconciliation` from `shared/kyozai-parity-goal.json`.
- Start condition: G1 is completed with all of its Preview evidence recorded;
  the single G1 PR is no longer the vehicle for product changes.  G2 then gets
  its own PR before any G3 work starts.
- Evidence record at G2 start: record this parent Gate, the goal contribution,
  the three evidence IDs, fixture IDs, and the intended G2 PR in the PR
  description.  At completion, add the corresponding commit SHA, CI URLs, and
  Preview run references; do not infer a pass from a local test alone.
- Non-goal of this note: changing the canonical Skill, enabling a preview, or
  recording G2 as started.

## Invariants to implement before accepting an attachment job

1. The byte sequence accepted from the user is written only to private R2 and
   has one SHA-256, byte size, media type, original filename, and immutable
   source identifier.  A client-provided hash is never trusted.
2. Every normalized chunk has a stable chunk ID, `sourceArtifactId`, original
   SHA-256, normalized-text SHA-256, ordinal, and an inclusive source location.
   PDF locations include page and text-item/character offsets; Markdown
   locations include UTF-8 byte offsets, Unicode character offsets, and line
   range.  Chunk order is explicit rather than inferred from model output.
3. The workflow obtains a fresh private-object readback and verifies byte count
   and SHA-256 before parsing, and it never sends an unverified source to a
   provider.
4. At most two unconsumed uploads and at most 25 MiB of their declared limits
   exist per owner.  Reservation, job consumption, and the attachment rows for
   a job are all committed in D1 commands that cannot be defeated by concurrent
   requests.
5. A final package contains the exact original files under `source/originals/`,
   the normalized source manifest/chunks under `source/`, and entries whose
   bytes and hashes agree with D1/R2 metadata.  No draft object or unrelated
   owner object is packaged.

## File-level implementation checklist

| File or area | G2 change | Required test or fixture evidence |
| --- | --- | --- |
| `shared/kyozai-job-contract.ts` | Add typed source-provenance contracts (original entry, normalized entry, PDF/Markdown locations, chunk, source manifest) and, only if necessary, a `source_manifest` artifact kind. Keep `attachment_original` and `attachment_normalized` as the persistent artifact categories. | Contract tests reject missing original hash, non-monotonic chunk ordinals, invalid page/line ranges, duplicate chunk IDs, and a chunk whose source hash differs from its original. |
| `apps/control-plane/migrations/0001_g1_schema.sql` plus a new ordered G2 migration | Do not rewrite applied G1 schema. Add an attachment-to-job/revision relation and the indexed fields needed to record immutable original and normalization artifacts. Preserve `upload_sessions` as pre-job state and prohibit one session from being consumed twice. | Fresh migration test and upgrade test show FK/unique constraints; a second consumption attempt fails without changing the first relation. |
| `apps/control-plane/src/upload-commands.ts` (new) and `apps/control-plane/src/index.ts` | Add an internal, typed upload command/resource: reserve upload capacity; register/verify private source bytes; read upload metadata; atomically consume selected verified sessions while creating the attachment job. Expose bytes only through the authenticated Vercel gateway path. Do not use browser-supplied signed bucket URLs or public R2. | Parallel reservation fixture submits three competing requests at the two-file/25-MiB boundary and proves the accepted rows alone fit the cap. Unauthorized, expired, wrong-owner, duplicate, wrong-size, and wrong-hash cases are rejected. |
| `apps/control-plane/src/artifact-objects.ts` or a dedicated private-source object module | Reuse the private R2 streaming/readback discipline for `kyozai-sources`, but require the recorded upload limit and calculated SHA-256 to match before an upload becomes consumable. Preserve original extension only as metadata, never as a path authority. | Local Worker fixture proves exact byte and SHA-256 readback, one-byte mismatch rejection, and no accepted metadata for a missing object. |
| `apps/web/lib/kyozai/control-plane-client.ts` and `apps/web/lib/kyozai/control-plane-artifacts.ts` | Add server-only typed upload/source clients. Keep the browser limited to `/api/uploads`; it must never receive the control-plane token, D1 data, R2 binding, or an object URL. | Client tests assert the upload routes carry only the internal bearer credential server-side and reject an unexpected response shape. |
| `apps/web/lib/kyozai/job-store.ts` | Under `cloudflareStateEnabled()`, replace the current G1 fail-closed attachment branch with the typed G2 create/consume command. Validate input shape before reservation, map gateway quota/expiry errors to the existing public non-enumerating errors, and leave the Supabase fallback intact until the Cloudflare path has its own real evidence. | Route/contract tests cover direct text unchanged, two allowed files, third file rejection, aggregate-cap rejection, concurrent conflict, expired upload, and attempt to attach another owner’s session. |
| `apps/web/app/api/uploads/route.ts` and `apps/web/app/async-job-workspace.tsx` | Keep the existing browser limit as early feedback only; align it with the shared server limit and ensure an upload is not treated as ready until server verification finishes. Do not make a G2 UI-only change that implies acceptance before the gateway commits it. | Component/API test verifies declared size, server failure rendering, and that no job is submitted with an unverified attachment ID. |
| `apps/web/lib/kyozai/pdf-safety.ts` (split if parsing becomes substantial) | Retain the 25 MiB, 30-page, timeout, and PDF magic checks, then add deterministic text extraction with page/text-item position data. Parsing must run in Vercel Workflow, not Workers. Reject encrypted/unsupported extraction or a page with no extractable text as a documented fail-closed input outcome unless the canonical Skill has an equivalent supported path. | A generated multi-page PDF fixture produces ordered page locations and stable normalized hash on two runs; corrupt, too-large, >30-page, timeout, and no-text PDF fixtures fail before provider invocation. |
| `apps/web/lib/kyozai/source-normalization.ts` (new) | Implement one deterministic normalizer for extracted PDF and UTF-8 Markdown: normalize line endings/Unicode according to an explicitly versioned policy, retain original text separately, create bounded chunks without reordering, and emit the typed source manifest. Chunk boundary constants belong in this module, not UI or model prompts. | Long Markdown fixture crosses multiple headings and chunk boundaries; assertions verify every source range is covered exactly once (apart from declared separators), all chunk hashes, and reconstruction of normalized text. |
| `apps/web/lib/kyozai/durable-source.ts` | Replace the attachment Supabase branch with D1/R2 source readback when Cloudflare state is enabled. It must verify original bytes/hash before invoking PDF extraction/Markdown decoding and pass normalized chunks plus source references into the same content pipeline. Keep the direct-text branch behavior unchanged. | Tests prove Cloudflare PDF and Markdown paths return deterministic `SourceInput`/provenance, reject altered R2 bytes, and retain the current “not ready” fail-closed behavior until the G2 flag is enabled. |
| `apps/web/lib/kyozai/types.ts`, `content-pipeline.ts`, and `job-workflow.ts` | Carry source manifest references through `source_ingest`, store `attachment_original`, `attachment_normalized`, and source-manifest artifacts, and make stage inputs/outputs list their IDs. The model receives chunks in manifest order, never raw R2 paths. | Workflow-stage fixture checks source-ingest retry reuses validated normalized artifacts, preserves source IDs/hashes, and makes no duplicate provider call. |
| `apps/web/lib/kyozai/durable-package.ts`, `apps/web/lib/kyozai/package-zip.ts`, and package validators | Add original-source and normalized-manifest files to the final ZIP and `manifest.json`; include a complete file inventory (path, byte size, SHA-256, media type, source/artifact ID). Validate ZIP contents by reopening it and comparing every listed entry, source metadata, deck `sourceHash`, and D1 artifact metadata. Avoid a self-referential hash for `manifest.json`; record the package ZIP hash outside the ZIP in its final artifact metadata. | PDF and Markdown package fixtures reopen the ZIP; verify exact original bytes, manifest inventory equality, every SHA-256, no extra non-directory entry, and package artifact hash/readback equality. |
| `apps/web/tests/durable-source.test.ts`, `apps/web/tests/durable-package.test.ts`, `apps/web/tests/image-pipeline.test.ts`, and new focused source/upload tests | Preserve current direct-text coverage and add independent normalization, upload-race, package-reconciliation, and fault tests. Tests must use synthetic non-personal fixture content; no customer document, captions, or generated output is committed. | The tests named above are required in CI; neither mock success nor a string-only assertion counts as G2 evidence. |
| `apps/control-plane/fixtures/` and `shared/fixtures/process-parity/` | Add declarative G2 fixture descriptors and SQL/Worker fixtures. Generate the long PDF at test time from synthetic text rather than storing a project document. Record fixture input SHA-256 in its generated evidence, not in a mutable source file. | `long-pdf` has several pages and multiple chunks; `long-markdown` has enough UTF-8 content, headings, and line breaks to cross multiple chunks; both run through private R2 readback and package reconciliation. |
| `docs/failures.md`, `docs/handoff.md`, and the G2 PR description | Append real failed fixture facts only; update handoff after work is performed. The eventual single G2 PR records parent Gate, contribution, exact fixture IDs, CI run URLs, Preview run IDs, commit SHA, and unresolved external setup. | No gate status changes until all local and Preview evidence exists. |

## Fixture matrix and pass criteria

| Fixture | Input construction | Assertions that must be machine-checked |
| --- | --- | --- |
| `long-pdf-onboarding` | Synthetic, multi-page PDF generated at test/runtime with Japanese-safe text, repeated sections, and enough extractable text to produce at least three chunks. | Original R2 readback SHA/size match; page/item/character locations are monotonic; normalized chunks reconstruct deterministically; every chunk links to the original; final ZIP contains exact original + source manifest; all inventories agree. |
| `long-markdown-onboarding` | Synthetic UTF-8 Markdown with headings, lists, Japanese text, different line endings, and enough content for at least three chunks. | Original bytes are preserved; normalizer records declared newline/Unicode policy; line/byte/character locations are valid; no heading/body loss or reordering; final ZIP/manifest/D1 hashes agree. |
| `upload-quota-race` | Three simultaneous upload reservations whose individual values are valid but whose combined count or bytes exceed the owner limit. | Exactly legal reservations commit; rejected requests leave no session/object that can later be consumed; retries obey idempotency; aggregate is never above 2/25 MiB. |
| `source-readback-tamper` | Alter or replace a private source object after metadata registration in the disposable test store. | Workflow stops before parser/provider; no source-normalized artifact becomes validated; failure code is recorded. |
| `manifest-file-reconciliation` | Run each successful document fixture through the durable package path. | Reopen ZIP, compare all non-directory entries against manifest, compare original hashes with D1/R2 records, compare final package bytes/hash with its finalized artifact, and reject an added, removed, or changed entry. |

## Execution order after G1 is accepted

1. Land the shared provenance contract and D1 upload/consume transaction with
   local Worker race/readback fixtures.
2. Add private upload gateway and server-only job-store path, still keeping the
   public G2 input disabled until extraction and package tests pass.
3. Add deterministic PDF/Markdown normalization and source-ingest artifact
   reuse, then verify the two synthetic fixtures locally.
4. Add package inventory/reconciliation and run the entire local verification
   set: typecheck, lint, unit/contract tests, build, smoke, E2E, and dependency
   audit.
5. Only then perform the user-configured Preview PDF and Markdown runs with
   actual providers, D1/R2 readback, ownership isolation, and commit/CI URLs.

G2 is eligible to pass only after both document fixtures have this external
Preview evidence and the ZIP-manifest reconciliation succeeds.  Completion of
this checklist alone is not evidence and does not unlock G3.
