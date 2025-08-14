# Realtime Voice Agent (Node.js + WebRTC)

Voice agent that uses:
- OpenAI Realtime (WebRTC) for low‑latency LLM conversation
- OpenAI Realtime STT (WebRTC, server VAD + transcription)
- ElevenLabs TTS (WebSocket Streaming) for speech output
- Barge‑in: TTS playback cancels immediately when user starts speaking
- Structured logging via `pino`

## Architecture

Browser (React)
- Mic capture with WebAudio; adds mic audio track to WebRTC PeerConnection
- Connects to OpenAI Realtime over WebRTC using ephemeral token from server (`/session`)
- Receives LLM events over data channel; on `response.completed` streams text to `/ws/tts`
- AudioWorklet player consumes streamed PCM16 from server and plays it
- Barge‑in: simple VAD using analyser energy; cancels TTS instantly

Server (Express + ws)
## Interview Agent (Hindi - Shreya)
- Persona configured in server /session instructions. The agent speaks strictly in Hindi and follows a 3-minute recruiter flow as "Shreya" from Talent Hub (Navi Mumbai), with the provided steps and guardrails.
- TTS uses ElevenLabs multilingual_v2 with default voice ID 1Z7Y8o9cvUeWq8oLKgMY. Override via env ELEVENLABS_VOICE_ID or per-message voiceId.

Quick test:
- Server: npm run dev
- Client: npm run dev
- Connect and speak/type in Hindi; responses should be in Hindi. Barge-in should cancel playback immediately when you speak.
- TTS script: npm run test:tts (generates WAV with Hindi speech using multilingual_v2).
- `GET /session` mints ephemeral OpenAI Realtime token
- Live STT handled by OpenAI Realtime; mic track is sent via WebRTC and server VAD detects turns
- `WS /ws/tts` bridges text to ElevenLabs TTS streaming and relays PCM16 audio chunks
- CORS enabled for local client

## Prerequisites

- Node.js 18+
- API keys:
  - `OPENAI_API_KEY`
  - `ELEVENLABS_API_KEY`

## Setup

1) Clone or copy this project to your machine.

2) Server env:
```
cp server/.env.example server/.env
# Edit server/.env with your keys
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=1Z7Y8o9cvUeWq8oLKgMY
CLIENT_URL=http://localhost:5173
PORT=8080
```

3) Install deps:
```
cd server
npm i
```

4) Start server (dev):
```
npm run dev
```

5) Client env:
```
cd ../client
cp .env.example .env
# Ensure API URL of server is set
# VITE_SERVER_URL is already present in .env.example, but you can override it:
# echo "VITE_SERVER_URL=http://localhost:8080" >> .env
npm i
npm run dev
```

6) Open the app at the printed Vite URL (default http://localhost:5173).
- Click "Connect". If a microphone is available, grant access and speak.
- If a microphone is not available, use the text input to send prompts.

Watch logs for:
- "oai" response.delta/response.completed
- "user_to_llm" (for text fallback)
- "oai" events
- "barge_in" when TTS is interrupted

### Quick test scripts (server)
Run these with the server running:
```
# Validate OpenAI Realtime ephemeral session creation
npm run test:session

# Validate ElevenLabs TTS streaming bridge (saves /home/ubuntu/tmp/tts_test.wav)
npm run test:tts
```

## Logging

- Server: `pino` with pretty transport in dev. Change level with `LOG_LEVEL=debug`.
- Client: log panel shows major events. Open the browser console for more details.

## Notes

- This is a POC; the server uses in‑memory sessions and no persistence.
- The STT/TTS streams expect PCM16. Ensure browser mic can be accessed via HTTPS in production.
- For real deployments, consider TURN servers for WebRTC, error retries, and authentication.
