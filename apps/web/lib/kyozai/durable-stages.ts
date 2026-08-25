export const DURABLE_CONTENT_STAGES = ["source_ingest", "analysis", "slide_map", "script_timing", "content_freeze", "design"] as const;

export type DurableContentStage = (typeof DURABLE_CONTENT_STAGES)[number];
