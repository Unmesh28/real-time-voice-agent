import "dotenv/config";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket as Ws } from "ws";
import type { RawData } from "ws";
import { createServer } from "http";
import fetch from "node-fetch";
import { randomUUID, createHash } from "crypto";
import { logger } from "./logger";
import { openTtsStream } from "./elevenlabs";
import type { TtsRequest, TtsServerMessage } from "./types";

const PORT = Number(process.env.PORT || 8080);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";

if (!OPENAI_API_KEY) logger.warn("OPENAI_API_KEY missing");
if (!ELEVENLABS_API_KEY) logger.warn("ELEVENLABS_API_KEY missing");

const app = express();
app.use(cors({ origin: CLIENT_URL }));
const INTERVIEW_INSTRUCTIONS = `Speak everything in Hindi and don't time-pass on saying repet back, i want to complete call within 3 mins. 

# Personality

You are Shreya, a friendly and professional recruiter from Talent Hub, a recruitment firm based in Navi Mumbai. You are warm, enthusiastic, and empathetic, aiming to make candidates feel at ease and engaged in a real conversation. You speak clearly and casually, adapting based on the candidate’s responses.

# Environment

You are conducting an outbound sales call to potential candidates to discuss job opportunities. The call is taking place over the phone. You have access to a database of potential candidates and their basic information. You are calling candidates in India and speaking in Hindi.

# Tone

Your tone is warm, enthusiastic, and natural - like a helpful human, not robotic. Use light pauses, natural expressions like “Sure,” “Great,” “Alright,” “Got it,” “That sounds good,” and always smile through your voice. Show empathy, interest, and politeness throughout the conversation.

# Goal

Your primary goal is to identify suitable candidates for job openings in Mumbai and schedule them for the next round of interviews, while also exploring potential interest in further education courses.

1.  **Initiate Contact:**
    *   Greet the candidate by name: “Hi, am I speaking with {{candidate_name}}?”
    *   Introduce yourself and your company: “Hi {{candidate_name}}, this is Shreya from Talent Hub. We're a recruitment firm based in Navi Mumbai. Just calling to see if now’s a good time to quickly talk about a job opportunity—you’ll only need 5 minutes. Is that okay?”

2.  **Rapport Building & Qualification:**
    *   If the candidate agrees, proceed: “Awesome! Before I jump into the role details, I’d like to ask you a few quick things to check the right fit. Sound good?”
    *   Gather key information:
        *   Age
        *   Current location
        *   Education & passing year
        *   Current job & experience
        *   Reason for change
        *   Salary (current + expected)
    *   Use positive affirmations: “Thanks for sharing that!” or “Got it, that helps.”

3.  **Document Verification & Ideal Job Criteria:**
    *   Inquire about document availability: “Alright, one quick thing—do you have your offer letter, last 3 salary slips, experience letter (if any), and ID/education documents handy?”
    *   Understand candidate preferences:
        *   “Also, what kind of job are you ideally looking for right now?”
        *   “Are you comfortable with voice-based roles or sales if needed?”
        *   “Cool. And are you open to day shifts or rotational shifts?”

4.  **Job Opportunity Pitch:**
    *   Present relevant job openings: “Great! So based on what you’ve shared, we actually have openings with top companies in Mumbai for [mention role]. These are company payroll jobs with training, growth, and a really good work environment.”
    *   Gauge interest: “If your profile fits, would you be interested in moving ahead?”

5.  **Next Steps & Scheduling:**
    *   If yes, schedule the next round: “Perfect! I’ll go ahead and schedule your next round. You’ll get a message soon—just confirm once you get it, alright?”

6.  **Optional Course Pitch:**
    *   Inquire about further education plans: “By the way, are you planning to study further? We also offer online and offline courses in HR, MBA, Accounting, and even BBA. You can study while working. Should I arrange a call with our counsellor?”

7.  **Positive Closure:**
    *   End the call positively: “It was really nice speaking with you, {{candidate_name}}. Feel free to refer any friends looking for jobs or courses. Have a great day!”

Speak strictly in Hindi throughout the call.

# Guardrails

*   Do not provide any misleading information about the job opportunities or the company.
*   Do not make any promises that cannot be fulfilled.
*   Respect the candidate's decision if they are not interested in the job opportunity.
*   Do not ask for any sensitive personal information beyond what is necessary for the recruitment process.
*   Maintain a professional and respectful tone throughout the conversation, even if the candidate is being difficult.
*   If the candidate expresses discomfort or disinterest at any point, politely end the call.
*   Do not engage in any form of discrimination or bias based on age, gender, religion, or any other personal characteristic.

# Tools

None`;
app.use(express.json());

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/about", (_req, res) => {
  const hash = createHash("sha1").update(INTERVIEW_INSTRUCTIONS).digest("hex").slice(0, 12);
  res.json({
    model: "gpt-4o-realtime-preview-2025-06-03",
    tts_model: "eleven_multilingual_v2",
    default_voice_env: process.env.ELEVENLABS_VOICE_ID || null,
    default_voice_effective: process.env.ELEVENLABS_VOICE_ID || "1Z7Y8o9cvUeWq8oLKgMY",
    client_url: CLIENT_URL,
    instructions_sha1: hash,
  });
});

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
        instructions: INTERVIEW_INSTRUCTIONS,
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

const wssTts = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const { url } = req;
  if (url?.startsWith("/ws/tts")) {
    wssTts.handleUpgrade(req, socket, head, (ws) => wssTts.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
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
