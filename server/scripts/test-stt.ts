import WebSocket from "ws";
import fs from "fs";
import path from "path";

async function main() {
  const base = process.env.BASE_URL || "ws://localhost:8080";
  const inFile = process.env.IN_FILE || "/home/ubuntu/tmp/tts_test.wav";
  if (!fs.existsSync(inFile)) {
    console.error("Input file not found:", inFile);
    process.exit(1);
  }
  const buf = fs.readFileSync(inFile);
  let pcm = buf;
  if (buf.toString("utf8", 0, 4) === "RIFF") {
    pcm = buf.slice(44);
  }
  const ws = new WebSocket(`${base}/ws/stt`);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      console.log("STT WS open, streaming PCM16 16k mono");
      const chunkSize = 3200; // 100ms at 16kHz * 2 bytes
      for (let i = 0; i < pcm.length; i += chunkSize) {
        const chunk = pcm.subarray(i, Math.min(i + chunkSize, pcm.length));
        ws.send(chunk);
      }
      ws.send(JSON.stringify({ type: "stop" }));
      setTimeout(() => resolve(), 1500);
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log("STT msg:", msg);
      } catch {}
    });
    ws.on("error", (e) => reject(e));
    ws.on("close", () => resolve());
  });
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
