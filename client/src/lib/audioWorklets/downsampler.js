class DownsamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.accum = [];
  }
  process(inputs, outputs) {
    const input = inputs[0][0];
    if (input) {
      let i = 0;
      while (i < input.length) {
        this.accum.push(input[i]);
        i += this.ratio;
      }
      const out = new Int16Array(this.accum.length);
      for (let j = 0; j < this.accum.length; j++) {
        const s = Math.max(-1, Math.min(1, this.accum[j]));
        out[j] = s < 0 ? s * 32768 : s * 32767;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
      this.accum = [];
    }
    return true;
  }
}
registerProcessor("downsampler", DownsamplerProcessor);
