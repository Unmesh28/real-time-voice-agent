import WebSocket from "ws";
import { logger } from "./logger";

export async function openTtsStream(apiKey: string, voiceId?: string) {
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || "1Z7Y8o9cvUeWq8oLKgMY";
  const model = "eleven_multilingual_v2";
  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voice
  )}/stream-input?model_id=${encodeURIComponent(model)}&optimize_streaming_latency=3&output_format=pcm_16000`;
  const ws = new WebSocket(url, {
    headers: { "xi-api-key": apiKey },
  });
  return await new Promise<WebSocket>((resolve, reject) => {
    ws.on("open", () => {
      logger.info({ at: "tts.open", voice, model }, "Connected to ElevenLabs TTS");
      resolve(ws);
    });
    ws.on("error", (err) => {
      logger.error({ err }, "TTS websocket error");
      reject(err);
    });
  });
}
