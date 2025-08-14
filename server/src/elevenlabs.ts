import WebSocket from "ws";
import { logger } from "./logger.js";

export async function openScribeStream(apiKey: string) {
  const url = "wss://api.elevenlabs.io/v1/speech-to-text/ws?model=scribe_v1";
  const ws = new WebSocket(url, {
    headers: { "xi-api-key": apiKey },
  });

  return await new Promise<WebSocket>((resolve, reject) => {
    ws.on("open", () => {
      logger.info({ at: "scribe.open" }, "Connected to ElevenLabs Scribe");
      try {
        ws.send(
          JSON.stringify({
            type: "start",
            encoding: "pcm_s16le",
            sample_rate: 16000,
            channels: 1,
          })
        );
      } catch (e) {
        logger.warn({ e }, "Failed to send Scribe start config");
      }
      resolve(ws);
    });
    ws.on("error", (err) => {
      logger.error({ err }, "Scribe websocket error");
      reject(err);
    });
  });
}

export async function openTtsStream(apiKey: string, voiceId?: string) {
  const voice = voiceId || "21m00Tcm4TlvDq8ikWAM";
  const model = "eleven_flash_v2_5";
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voice
  )}/stream-input?model_id=${encodeURIComponent(model)}&optimize_streaming_latency=3&output_format=pcm_16000`;
  const ws = new WebSocket(url, {
    headers: { "xi-api-key": apiKey },
  });
  return await new Promise<WebSocket>((resolve, reject) => {
    ws.on("open", () => {
      logger.info({ at: "tts.open", voice }, "Connected to ElevenLabs TTS");
      resolve(ws);
    });
    ws.on("error", (err) => {
      logger.error({ err }, "TTS websocket error");
      reject(err);
    });
  });
}
