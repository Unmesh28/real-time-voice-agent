class PCM16PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(0);
    this.readIndex = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "push") {
        const int16 = new Int16Array(e.data.payload);
        const f32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
          f32[i] = Math.max(-1, Math.min(1, int16[i] / 32768));
        }
        const merged = new Float32Array(this.buffer.length + f32.length);
        merged.set(this.buffer, 0);
        merged.set(f32, this.buffer.length);
        this.buffer = merged;
      } else if (e.data && e.data.type === "clear") {
        this.buffer = new Float32Array(0);
        this.readIndex = 0;
      }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0];
    const channel = output[0];
    for (let i = 0; i < channel.length; i++) {
      channel[i] = this.readIndex < this.buffer.length ? this.buffer[this.readIndex++] : 0;
    }
    if (this.readIndex > 48000) {
      this.buffer = this.buffer.slice(this.readIndex);
      this.readIndex = 0;
    }
    return true;
  }
}
registerProcessor("pcm16-player", PCM16PlayerProcessor);
