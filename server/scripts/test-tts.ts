import WebSocket from "ws";
import fs from "fs";
import path from "path";

async function main() {
  const base = process.env.BASE_URL || "ws://localhost:8080";
  const outDir = process.env.OUT_DIR || "/home/ubuntu/tmp";
  fs.mkdirSync(outDir, { recursive: true });
  const outChunks: Buffer[] = [];
  const ws = new WebSocket(`${base}/ws/tts`);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      console.log("TTS WS open");
      ws.send(JSON.stringify({ type: "speak", text: "Hello, this is a realtime TTS test from ElevenLabs via our bridge." }));
      setTimeout(() => {
        try {
          ws.close();
        } catch {}
      }, 12000);
    });
    ws.on("message", (data) => {
      if (Buffer.isBuffer(data)) {
        outChunks.push(data);
      } else {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "eof") {
            resolve();
          }
        } catch {}
      }
    });
    ws.on("close", () => resolve());
    ws.on("error", (e) => reject(e));
  });

  const buf = Buffer.concat(outChunks);
  const outFile = path.join(outDir, "tts_test.mp3");
  fs.writeFileSync(outFile, buf);
  console.log("Saved TTS MP3 to:", outFile, "bytes:", buf.length);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
