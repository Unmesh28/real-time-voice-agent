import { useEffect, useRef, useState } from "react";
import { createAudioPipelines } from "./lib/audio";

const SERVER_BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:8080";

type Log = { ts: number; level: "info" | "error"; msg: string; data?: any };

export default function App() {
  const [connected, setConnected] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [noMic, setNoMic] = useState(false);
  const [textInput, setTextInput] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ttsWsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<Awaited<ReturnType<typeof createAudioPipelines>> | null>(null);
  const textBufferRef = useRef<string>("");

  const log = (l: Omit<Log, "ts">) => setLogs((s) => [...s, { ...l, ts: Date.now() }]);

  useEffect(() => {
    audioRef.current = null;
  }, []);

  async function connect() {
    try {
      if (!audioRef.current) audioRef.current = await createAudioPipelines();

      const tokenRes = await fetch(`${SERVER_BASE}/session`);
      const data = await tokenRes.json();
      const EPHEMERAL_KEY = data.client_secret.value;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      let stream: MediaStream | null = null;
      try {
        const mic = await audioRef.current.getMicNode();
        stream = mic.stream;
        stream.getTracks().forEach((t) => pc.addTrack(t));
      } catch (err) {
        setNoMic(true);
        log({ level: "error", msg: "mic_unavailable", data: String(err) });
      }

      pc.ondatachannel = (event) => {
        if (event.channel.label === "oai-events") {
          dcRef.current = event.channel;
          event.channel.onmessage = (e) => handleOaiEvent(e);
        }
      };


      const ttsWs = new WebSocket(SERVER_BASE.replace("http", "ws") + "/ws/tts");
      ttsWsRef.current = ttsWs;
      ttsWs.binaryType = "arraybuffer";
      ttsWs.onopen = () => setTtsOpen(true);
      ttsWs.onclose = () => setTtsOpen(false);
      ttsWs.onmessage = (e) => {
        if (typeof e.data !== "string" && e.data instanceof ArrayBuffer) {
          audioRef.current?.pushPcm16(e.data);
        }
      };

      const eventsDc = pc.createDataChannel("oai-events");
      dcRef.current = eventsDc;
      eventsDc.onmessage = (e) => handleOaiEvent(e);
      eventsDc.onopen = () => {
        try {
          const proactive = {
            type: "response.create",
            response: {
              modalities: ["audio", "text"],
              instructions:
                "नमस्ते! मैं श्रेया बोल रही हूँ, टैलेंट हब से। क्या अभी 3 मिनट बात करना ठीक रहेगा? पूरी बातचीत हिंदी में होगी।",
            },
          };
          eventsDc.send(JSON.stringify(proactive));
          log({ level: "info", msg: "proactive_start_sent" });
        } catch (e) {
          log({ level: "error", msg: "proactive_start_error", data: String(e) });
        }
      };
      if (!stream) {
        pc.addTransceiver("audio", { direction: "recvonly" });
        log({ level: "info", msg: "added_recvonly_audio_transceiver" });
      } else {
        log({ level: "info", msg: "mic_track_added_to_openai" });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2025-06-03";
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp!,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
          Accept: "application/sdp",
          "OpenAI-Beta": "realtime=v1",
        },
      });
      const ct = sdpResponse.headers.get("content-type") || "";
      const text = await sdpResponse.text();
      log({ level: "info", msg: "realtime_sdp_response", data: { status: sdpResponse.status, ct, head: text.slice(0, 120) } });
      if (!sdpResponse.ok || !text.trim().startsWith("v=")) {
        throw new Error(`Unexpected SDP response: status=${sdpResponse.status} ct=${ct} head=${text.slice(0, 80)}`);
      }
      const answer = { type: "answer", sdp: text } as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(answer);

      if (stream) {
        setupBargeIn(stream);
      } else {
        log({ level: "info", msg: "using_text_fallback" });
      }

      setConnected(true);
      log({ level: "info", msg: "connected" });
    } catch (err) {
      log({ level: "error", msg: "connect_failed", data: String(err) });
    }
  }

  function setupBargeIn(stream: MediaStream) {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let speakingLocal = false;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const isSpeaking = avg > 8;
      if (isSpeaking && !speakingLocal) {
        speakingLocal = true;
        setSpeaking(true);
        audioRef.current?.clearPlayer();
        if (ttsWsRef.current && ttsWsRef.current.readyState === WebSocket.OPEN) {
          ttsWsRef.current.send(JSON.stringify({ type: "cancel" }));
        }
        log({ level: "info", msg: "barge_in" });
      } else if (!isSpeaking && speakingLocal) {
        speakingLocal = false;
        setSpeaking(false);
      }
      requestAnimationFrame(tick);
    };
    tick();
  }

  function handleOaiEvent(e: MessageEvent) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "response.delta" && msg.delta) {
        textBufferRef.current += msg.delta;
      } else if (msg.type === "response.completed") {
        const text = textBufferRef.current.trim();
        textBufferRef.current = "";
        if (text && ttsWsRef.current && ttsWsRef.current.readyState === WebSocket.OPEN) {
          ttsWsRef.current.send(JSON.stringify({ type: "speak", text }));
        }
      }
      log({ level: "info", msg: "oai", data: msg.type });
    } catch {}
  }

  function sendUserTextToLLM(text: string) {
    const dc = dcRef.current;
    if (!dc) return;
    const req = {
      type: "response.create",
      response: { modalities: ["text"], instructions: text },
    };
    dc.send(JSON.stringify(req));
    log({ level: "info", msg: "user_to_llm", data: text });
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Realtime Voice Agent (OpenAI Realtime + ElevenLabs)</h1>
      <div className="flex gap-2">
        <button className="px-3 py-2 bg-green-600 text-white rounded" onClick={connect} disabled={connected}>
          {connected ? "Connected" : "Connect"}
        </button>
        <span className="px-2 py-1 rounded bg-gray-200">Speaking: {speaking ? "Yes" : "No"}</span>
        <span className="px-2 py-1 rounded bg-gray-200">TTS WS: {ttsOpen ? "Open" : "Closed"}</span>
      {noMic && (
        <div className="flex gap-2 items-center">
          <input
            className="border rounded px-2 py-1 w-96"
            placeholder="Type a message (mic unavailable)"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendUserTextToLLM(textInput);
                setTextInput("");
              }
            }}
          />
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded"
            onClick={() => {
              sendUserTextToLLM(textInput);
              setTextInput("");
            }}
            disabled={!connected || !textInput.trim()}
          >
            Send
          </button>
        </div>
      )}

      </div>
      <audio ref={audioElRef} />
      <div className="h-64 overflow-auto rounded border p-2 text-xs bg-black text-green-200">
        {logs.slice(-200).map((l, i) => (
          <div key={i}>
            [{new Date(l.ts).toLocaleTimeString()}] {l.level.toUpperCase()} {l.msg} {l.data ? JSON.stringify(l.data) : ""}
          </div>
        ))}
      </div>
      <p className="text-sm text-gray-600">
        Speak to the mic; OpenAI Realtime transcribes in-stream and generates responses. When the LLM completes a message, it is spoken with ElevenLabs. If you start speaking, TTS will cancel immediately (barge-in).
      </p>
    </div>
  );
}
