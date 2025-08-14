export async function createAudioPipelines() {
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.audioWorklet.addModule("/src/lib/audioWorklets/pcm16-player.js");
  await ctx.audioWorklet.addModule("/src/lib/audioWorklets/downsampler.js");

  const player = new AudioWorkletNode(ctx, "pcm16-player", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  player.connect(ctx.destination);

  const getMicNode = async () => {
    const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const src = ctx.createMediaStreamSource(ms);
    const downsampler = new AudioWorkletNode(ctx, "downsampler", { numberOfInputs: 1, numberOfOutputs: 0 });
    src.connect(downsampler);
    return { downsampler, stream: ms };
  };

  const pushPcm16 = (buf: ArrayBuffer) => player.port.postMessage({ type: "push", payload: buf }, [buf]);
  const clearPlayer = () => player.port.postMessage({ type: "clear" });

  return { ctx, getMicNode, pushPcm16, clearPlayer };
}
