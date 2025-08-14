import WebSocket from "ws";
import fs from "fs";
import path from "path";

function writeWavPCM16Mono(filePath: string, samples: Buffer, sampleRate = 16000) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length;
  const fmtChunkSize = 16;
  const fileSize = 4 + (8 + fmtChunkSize) + (8 + dataSize);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(fmtChunkSize, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, samples]));
}

async function main() {
  const base = process.env.BASE_URL || "ws://localhost:8080";
  const outDir = process.env.OUT_DIR || "/home/ubuntu/tmp";
  fs.mkdirSync(outDir, { recursive: true });
  const outChunks: Buffer[] = [];
  const ws = new WebSocket(`${base}/ws/tts`);
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try { ws.close(); } catch {}
        resolve();
      }, 5000);
    };
    ws.on("open", () => {
      console.log("TTS WS open");
      const hindiText = "नमस्ते! यह एक रियल-टाइम हिंदी टीटीएस परीक्षण है। हम इंटरव्यू एजेंट के लिए बहुभाषी आवाज़ का उपयोग कर रहे हैं।";
      ws.send(JSON.stringify({ type: "speak", text: hindiText, voiceId: process.env.ELEVENLABS_VOICE_ID }));
      arm();
    });
    ws.on("message", (data) => {
      arm();
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

  const pcm = Buffer.concat(outChunks);
  const wavFile = path.join(outDir, "tts_test.wav");
  writeWavPCM16Mono(wavFile, pcm, 16000);
  console.log("Saved TTS WAV to:", wavFile, "bytes:", pcm.length);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
