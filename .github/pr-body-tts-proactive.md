# client: proactive ElevenLabs Hindi greeting on Connect + extract interview prompt to client/src/prompt.ts

Summary
- Client proactively starts speaking in Hindi via ElevenLabs TTS immediately on Connect.
- Extracted the Hindi interviewer prompt to client/src/prompt.ts (HINDI_INTERVIEW_INSTRUCTIONS and PROACTIVE_GREETING_HI).
- Voice/model: eleven_multilingual_v2 with default voiceId 1Z7Y8o9cvUeWq8oLKgMY; overridable via env VITE_ELEVENLABS_VOICE_ID or per speak message.
- Preserves OpenAI Realtime STT, barge-in (cancel playback when user speaks), and logging.

Changes
- client/src/App.tsx: 
  - Send {type:"speak", text: PROACTIVE_GREETING_HI, voiceId} to /ws/tts on open.
  - Replace hardcoded greeting with PROACTIVE_GREETING_HI for OAI proactive start.
  - Minor logging for proactive start and barge-in status.
- client/src/prompt.ts: new file exporting HINDI_INTERVIEW_INSTRUCTIONS and PROACTIVE_GREETING_HI.
- client/.env.example: add VITE_ELEVENLABS_VOICE_ID; VITE_SERVER_URL remains http://localhost:8080.

Local Verification
- Server:
  - /about shows tts_model: eleven_multilingual_v2 and default_voice_effective: 1Z7Y8o9cvUeWq8oLKgMY
  - /session shows full Hindi “Shreya” interviewer instructions
- Client:
  - Click Connect → immediate Hindi greeting via ElevenLabs TTS; server logs show tts.open and audio chunks forwarded
  - Barge-in: speaking cancels TTS playback promptly

Screenshots
- /about diagnostics  
  ![about](/home/ubuntu/screenshots/localhost_8080_about_155935.png)
- /session JSON  
  ![session](/home/ubuntu/screenshots/localhost_8080_160047.png)
- Client after Connect  
  ![client](/home/ubuntu/screenshots/localhost_5173_160003.png)

Audio sample
- Hindi TTS WAV generated locally using eleven_multilingual_v2, voiceId 1Z7Y8o9cvUeWq8oLKgMY:  
  /home/ubuntu/tmp/tts_test.wav

Runbook
- Server
  - cp server/.env.example server/.env
  - Set OPENAI_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID=1Z7Y8o9cvUeWq8oLKgMY
  - npm i && npm run dev
- Client
  - cp client/.env.example client/.env
  - Ensure VITE_SERVER_URL=http://localhost:8080 and VITE_ELEVENLABS_VOICE_ID set if overriding
  - npm i && npm run dev

Link to Devin run
- https://app.devin.ai/sessions/0f607135eb0346fa8488843ec29571c0

Requester
- Requested by: Unmesh Dabhade
- GitHub: @Unmesh28
