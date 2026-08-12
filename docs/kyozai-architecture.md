# KYOZAI architecture

KYOZAI is the product name for the future SaaS: 教材 + AI. The repository should be organized so each capability can run independently, but can also be chained into a complete teaching-material pipeline.

## Naming

Use lowercase hyphen-case for actual Codex skill folder names because Codex skill names are safer that way.

Use `KYOZAI ...` as the display/product name.

| Product display name | Skill folder | Role |
|---|---|---|
| KYOZAI Slide | `.agents/skills/kyozai-slide/` | Source material to teaching slides |
| KYOZAI Support | `.agents/skills/kyozai-support/` | Instructor preparation, A4 cue sheet, A4 after sheet |
| KYOZAI Design | `.agents/skills/kyozai-design/` | Analyze reference slide/design and produce design profiles |
| KYOZAI Movie | `.agents/skills/kyozai-movie/` | Convert slide content into motion storyboard and video prompts |
| KYOZAI Orchestrator | `.agents/skills/kyozai-orchestrator/` | Chain KYOZAI skills into one package |

Note: if `KYOZAI-movei` was intentional, rename `kyozai-movie` later. For now this uses `movie`.

## Skill boundary

Each Skill should own one responsibility.

```text
kyozai-design
  reference design or template site
  -> design-profile.json

kyozai-slide
  source material + optional design-profile.json
  -> deck-spec.json + slide images

kyozai-support
  deck-spec.json + source-info.json + slide images
  -> before / during A4 / after A4

kyozai-movie
  deck-spec.json + design-profile.json + slide images
  -> motion-storyboard.json + video prompts + video assets

kyozai-orchestrator
  user request
  -> choose and run the needed KYOZAI skills
```

Do not grow one giant Skill. Keep `SKILL.md` short, and put detailed rules in `references/` or deterministic code in `scripts/`.

## Generated output policy

Generated artifacts must be separated by lifecycle. This is required now for safe local cleanup, and later for SaaS storage retention.

```text
outputs/
├─ drafts/        # disposable work-in-progress; safe to delete
├─ final/         # cleaned deliverables selected for handoff/export
├─ attachments/   # local copies or metadata for user-provided files
├─ tmp/           # transient build/render intermediates; safe to delete
└─ cache/         # reusable downloaded/generated cache; safe to delete if rebuildable
```

Safe deletion rule:

- `outputs/drafts/`, `outputs/tmp/`, and `outputs/cache/` are safe to delete.
- `outputs/final/` is not safe to delete unless the user explicitly asks.
- `outputs/attachments/` is not safe to delete unless the related job/project is intentionally removed.

## Job-level structure

Each KYOZAI job should use a stable job id or slug. Prefer:

```text
outputs/drafts/{job_id}/
outputs/final/{job_id}/
outputs/attachments/{job_id}/
outputs/tmp/{job_id}/
outputs/cache/{source_hash}/
```

Within a job:

```text
drafts/{job_id}/
├─ source/
├─ analysis/
├─ deck/
├─ images/
├─ support/
├─ motion/
└─ validation/

final/{job_id}/
├─ slides/
├─ support/
├─ movie/
├─ manifest.json
└─ package.zip
```

Drafts can contain partial, duplicate, or failed attempts. Final must contain only the selected clean deliverables.

## Attachment handling

Attachments are user-provided images, slide files, PDFs, source documents, audio, video, or template references.

Local development:

```text
outputs/attachments/{job_id}/
├─ originals/     # original uploaded files, never modified
├─ normalized/    # converted images/PDF pages/text extractions
└─ manifest.json  # metadata and links to related artifacts
```

Rules:

1. Never overwrite originals.
2. Normalize into a separate folder.
3. Store source URL, upload filename, content hash, media type, byte size, and usage purpose in metadata.
4. Final packages should reference attachments by asset id, not by fragile local path.
5. Do not commit real attachments to Git.

SaaS-ready equivalent:

```text
Object storage:
  tenants/{tenant_id}/projects/{project_id}/jobs/{job_id}/attachments/{asset_id}/original
  tenants/{tenant_id}/projects/{project_id}/jobs/{job_id}/artifacts/{artifact_id}

Database:
  jobs
  assets
  artifacts
  artifact_versions
  source_references
```

Local paths should be treated as a development adapter for this future object-storage layout.

## Common schemas

Shared schemas live in:

```text
shared/schemas/
```

Minimum shared objects:

- `kyozai-job.schema.json`
- `kyozai-artifact.schema.json`
- `deck-spec.schema.json` later
- `design-profile.schema.json` later
- `motion-storyboard.schema.json` later

Skills should exchange JSON artifacts rather than relying on each other's internal files.

## Migration plan

Current active Skill:

```text
.agents/skills/teaching-slide-package/
```

Canonical Skills as of this repo state:

```text
.agents/skills/kyozai-slide/    # canonical replacement for teaching-slide-package
.agents/skills/kyozai-support/  # canonical instructor-support Skill
```

Canonical scaffold Skills:

```text
.agents/skills/kyozai-design/        # design-profile generation scaffold
.agents/skills/kyozai-movie/         # motion storyboard / video prompt scaffold
.agents/skills/kyozai-orchestrator/  # coordination scaffold
```

Migration path:

1. Keep `teaching-slide-package` working as a legacy compatibility Skill.
2. Use `kyozai-slide` as the canonical Slide Skill for new work.
3. Use `kyozai-support` as the canonical instructor-support Skill.
4. Expand `kyozai-design` from scaffold to full design-analysis workflow.
5. Expand `kyozai-movie` from scaffold to full video-generation workflow.
6. Expand `kyozai-orchestrator` from scaffold to full multi-Skill coordination workflow.

Do not delete the existing active legacy Skill until the new KYOZAI Skills have been forward-tested on multiple real slide jobs.
