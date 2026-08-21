/* vad-processor.js — AudioWorklet half of the voice-activity detector.
 * Runs on the audio thread. Computes per-frame RMS and posts it to the main
 * thread; all decision-making (thresholds, hysteresis, noise floor) lives in
 * vad.js so it can be tuned without touching the realtime path.
 *
 * Loaded via audioWorklet.addModule('js/vad-processor.js') — a same-origin file
 * rather than a blob: URL, because the app's CSP is script-src 'self'.
 */
class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._sum = 0;
    this._n = 0;
    // Report roughly every 20ms rather than every 128-sample render quantum,
    // which would flood the message port (~375 posts/sec at 48kHz).
    this._chunk = Math.max(1, Math.round(sampleRate * 0.02));
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;                 // no input yet; keep the node alive

    for (let i = 0; i < ch.length; i++) this._sum += ch[i] * ch[i];
    this._n += ch.length;

    if (this._n >= this._chunk) {
      this.port.postMessage(Math.sqrt(this._sum / this._n));
      this._sum = 0;
      this._n = 0;
    }
    return true;
  }
}

registerProcessor('vad-processor', VadProcessor);
