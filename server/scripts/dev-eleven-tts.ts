import "dotenv/config";
import WebSocket from "ws";
import fs from "fs";
import path from "path";

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY || "";
  if (!apiKey) {
    console.error("Missing ELEVENLABS_API_KEY in env");
    process.exit(1);
  }

  const voice = process.env.ELEVEN_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const model = process.env.ELEVEN_MODEL_ID || "eleven_flash_v2_5";
  const outDir = process.env.OUT_DIR || "/home/ubuntu/tmp";
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "dev_eleven_stream.mp3");
  const chunks: Buffer[] = [];

  const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voice
  )}/stream-input?model_id=${encodeURIComponent(model)}&optimize_streaming_latency=3&output_format=mp3_44100_128`;

  console.log("Connecting to:", url);
  const ws = new WebSocket(url, { headers: { "xi-api-key": apiKey } });

  ws.on("open", () => {
    console.log("Opened ElevenLabs WS");
    ws.send(JSON.stringify({
      text: " ",
      voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: false },
      generation_config: { chunk_length_schedule: [120, 160, 250, 290] }
    }));
    const text = process.env.TTS_TEXT || "Hello from the direct ElevenLabs websocket diagnostic script.";
    console.log("Sending text len:", text.length);
    ws.send(JSON.stringify({ text }));
    ws.send(JSON.stringify({ flush: true }));
  });

  ws.on("message", (data) => {
    if (Buffer.isBuffer(data)) {
      console.log("binary chunk", data.byteLength);
      chunks.push(data);
      return;
    }
    const s = data.toString();
    try {
      const msg = JSON.parse(s);
      console.log("json msg:", msg);
      if (msg.audio) {
        const b = Buffer.from(msg.audio, "base64");
        chunks.push(b);
      }
    } catch {
      console.log("text frame:", s.slice(0, 120));
    }
  });

  ws.on("close", (code, reason) => {
    console.log("closed", code, reason?.toString());
    if (chunks.length) {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(outFile, buf);
      console.log("wrote", outFile, "bytes", buf.length);
    } else {
      console.log("no audio chunks received");
    }
    process.exit(0);
  });

  ws.on("error", (e) => {
    console.error("ws error", e);
  });

  setTimeout(() => {
    try { ws.close(); } catch {}
  }, 15000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
