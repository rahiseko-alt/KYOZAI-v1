export type ImagePipelineStage =
  | "image_provider_response"
  | "image_decode"
  | "image_normalize"
  | "image_qa_response"
  | "image_qa_verdict";

export type ImagePipelineDiagnostic = {
  stage: ImagePipelineStage;
  provider?: "google" | "openai";
  model?: string;
};

export class ImagePipelineError extends Error {
  constructor(
    readonly diagnostic: ImagePipelineDiagnostic,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ImagePipelineError";
  }
}

export function imagePipelineError(diagnostic: ImagePipelineDiagnostic, message: string, cause?: unknown) {
  return new ImagePipelineError(diagnostic, message, cause);
}
