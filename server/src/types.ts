export type SttMessage =
  | { type: "audio"; chunk: ArrayBuffer }
  | { type: "stop" }
  | { type: "ping" };

export type SttServerMessage =
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; error: string };

export type TtsRequest =
  | { type: "speak"; text: string; voiceId?: string }
  | { type: "cancel" }
  | { type: "ping" };

export type TtsServerMessage =
  | { type: "audio"; chunk: ArrayBuffer }
  | { type: "eof" }
  | { type: "error"; error: string };
