import "dotenv/config";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket as Ws } from "ws";
import type { RawData } from "ws";
import { createServer } from "http";
import fetch from "node-fetch";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";
import { openScribeStream, openTtsStream } from "./elevenlabs.js";
import type { SttServerMessage, TtsRequest, TtsServerMessage } from "./types.js";

const PORT = Number(process.env.PORT || 8080);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";

if (!OPENAI_API_KEY) logger.warn("OPENAI_API_KEY missing");
if (!ELEVENLABS_API_KEY) logger.warn("ELEVENLABS_API_KEY missing");

const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/session", async (_req, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2025-06-03",
        voice: "verse",
        turn_detection: { type: "server_vad" },
        input_audio_format: "pcm16",
        input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
        modalities: ["text", "audio"],
        instructions: "You are a helpful, concise voice assistant. Keep responses brief and conversational.",
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      logger.error({ data }, "Failed to create ephemeral session");
      return res.status(500).json({ error: "openai_ephemeral_error", data });
    }
    res.json(data);
  } catch (err: any) {
    logger.error({ err }, "Error creating ephemeral session");
    res.status(500).json({ error: "internal_error" });
  }
});

const server = createServer(app);

const wssStt = new WebSocketServer({ noServer: true });
const wssTts = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const { url } = req;
  if (url?.startsWith("/ws/stt")) {
    wssStt.handleUpgrade(req, socket, head, (ws) => wssStt.emit("connection", ws, req));
  } else if (url?.startsWith("/ws/tts")) {
    wssTts.handleUpgrade(req, socket, head, (ws) => wssTts.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

wssStt.on("connection", async (clientWs) => {
  const sessionId = randomUUID();
  logger.info({ sessionId }, "Client connected to STT");

  let scribeWs: Ws | null = null;

  try {
    scribeWs = (await openScribeStream(ELEVENLABS_API_KEY)) as unknown as Ws;

    scribeWs.on("message", (data: RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "partial") {
          const out: SttServerMessage = { type: "partial", text: msg.text || "" };
          clientWs.send(JSON.stringify(out));
        } else if (msg.type === "final") {
          const out: SttServerMessage = { type: "final", text: msg.text || "" };
          clientWs.send(JSON.stringify(out));
        }
      } catch (e) {
        logger.warn({ e }, "Failed to parse Scribe message");
      }
    });

    scribeWs.on("close", () => {
      logger.info({ sessionId }, "Scribe closed");
      if (clientWs.readyState === clientWs.OPEN) clientWs.close();
    });
  } catch (err) {
    logger.error({ err }, "Failed to open Scribe stream");
    clientWs.send(JSON.stringify({ type: "error", error: "scribe_open_failed" } as SttServerMessage));
    clientWs.close();
    return;
  }

  clientWs.on("message", (raw: RawData) => {
    try {
      const parsed: any = JSON.parse(raw.toString());
      if (parsed && parsed.type === "stop") {
        scribeWs?.send(JSON.stringify({ type: "stop" }));
        return;
      }
      if (parsed && parsed.type === "ping") return;
    } catch {
      if (scribeWs && scribeWs.readyState === scribeWs.OPEN) {
        scribeWs.send(raw);
      }
    }
  });

  clientWs.on("close", () => {
    logger.info({ sessionId }, "STT client closed");
    if (scribeWs && scribeWs.readyState === scribeWs.OPEN) scribeWs.close();
  });
});

wssTts.on("connection", async (clientWs) => {
  const sessionId = randomUUID();
  logger.info({ sessionId }, "Client connected to TTS");

  let ttsWs: Ws | null = null;
  let currentVoice: string | undefined;

  const openStream = async (voiceId?: string) => {
    if (ttsWs && ttsWs.readyState === ttsWs.OPEN) {
      ttsWs.close();
    }
    ttsWs = (await openTtsStream(ELEVENLABS_API_KEY, voiceId)) as unknown as Ws;
    currentVoice = voiceId;

    ttsWs.on("message", (data: RawData) => {
      if (Buffer.isBuffer(data)) {
        try {
          logger.info({ at: "tts.chunk", bytes: data.byteLength }, "Forwarding TTS audio chunk");
          clientWs.send(data);
        } catch {}
        return;
      }
      const text = data.toString();
      try {
        const msg = JSON.parse(text);
        logger.info({ at: "tts.json", keys: Object.keys(msg || {}), msg }, "Received TTS JSON");
        if (msg.audio) {
          const chunkBuf = Buffer.from(msg.audio, "base64");
          clientWs.send(chunkBuf);
        }
        if (msg.isFinal) {
          clientWs.send(JSON.stringify({ type: "eof" } as TtsServerMessage));
        }
        if (msg.type === "error") {
          logger.error({ at: "tts.error", msg }, "ElevenLabs TTS error");
          clientWs.send(JSON.stringify({ type: "error", error: msg.error || "tts_error" } as TtsServerMessage));
        }
      } catch (e) {
        logger.warn({ at: "tts.nonjson", text }, "Non-JSON TTS text frame");
      }
    });

    ttsWs.on("error", (err) => {
      logger.error({ at: "tts.ws.error", err }, "ElevenLabs TTS WS error");
    });

    ttsWs.on("close", (code, reason) => {
      logger.info({ sessionId, code, reason: reason?.toString() }, "ElevenLabs TTS closed");
    });
  };

  clientWs.on("message", async (raw: RawData) => {
    try {
      const data = JSON.parse(raw.toString()) as TtsRequest;
      if (data.type === "speak") {
        await openStream(data.voiceId || currentVoice);
        logger.info({ at: "tts.send.init" }, "Sending initial config to ElevenLabs");
        ttsWs?.send(JSON.stringify({
          text: " ",
          voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: false },
          generation_config: { chunk_length_schedule: [120, 160, 250, 290] }
        }));
        logger.info({ at: "tts.send.text", len: data.text.length }, "Sending speak text");
        ttsWs?.send(JSON.stringify({ text: data.text }));
        ttsWs?.send(JSON.stringify({ flush: true }));
      } else if (data.type === "cancel") {
        if (ttsWs && ttsWs.readyState === ttsWs.OPEN) {
          try {
            logger.info({ at: "tts.send.end" }, "Sending empty text to end TTS");
            ttsWs.send(JSON.stringify({ text: "" }));
          } catch {}
          ttsWs.close();
        }
        clientWs.send(JSON.stringify({ type: "eof" } as TtsServerMessage));
      }
    } catch (e) {
      logger.warn({ e }, "Bad TTS message");
    }
  });

  clientWs.on("close", () => {
    logger.info({ sessionId }, "TTS client closed");
    if (ttsWs && ttsWs.readyState === ttsWs.OPEN) ttsWs.close();
  });
});

server.listen(PORT, () => {
  logger.info({ PORT }, "Server listening");
});
