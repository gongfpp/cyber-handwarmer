// Procedural fire: filtered pink noise, a slow breath, and irregular wood crackles.
// The power gesture unlocks audio; there is no autoplay on page load or sound control.
export class FireSound {
  context = null; graph = null; generation = 0; releaseTimer = null; pendingRelease = null;
  arm() {
    try {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Context) return;
      this.context ||= new Context({ latencyHint: 'playback' });
      this.context.resume().catch(() => {});
    } catch { /* Audio is optional; heat and controls remain usable. */ }
  }
  noise(seconds, pink = false) {
    const context = this.context;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
    const samples = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < samples.length; i++) {
      const white = Math.random() * 2 - 1;
      if (pink) {
        b0 = .99886 * b0 + white * .0555179; b1 = .99332 * b1 + white * .0750759;
        b2 = .969 * b2 + white * .153852; b3 = .8665 * b3 + white * .3104856;
        b4 = .55 * b4 + white * .5329522; b5 = -.7616 * b5 - white * .016898;
        samples[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * .5362) * .11;
        b6 = white * .115926;
      } else samples[i] = white;
    }
    return buffer;
  }
  start(mode = 'gentle', skin = 'nordic') {
    if (!this.context) return;
    this.stop(true, false);
    const context = this.context, generation = this.generation;
    try {
      const output = context.createGain(); output.gain.value = 0; output.connect(context.destination);
      const noise = context.createBufferSource(); noise.buffer = this.noise(3, true); noise.loop = true;
      const high = context.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 75;
      const low = context.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 1500; low.Q.value = .35;
      const bed = context.createGain(); bed.gain.value = .32;
      noise.connect(high).connect(low).connect(bed).connect(output);
      const breath = context.createOscillator(); breath.frequency.value = .19;
      const depth = context.createGain(); depth.gain.value = .045; breath.connect(depth).connect(bed.gain);
      const graph = this.graph = { output, noise, high, low, bed, breath, depth, mode, skin, timer: null, pops: new Set() };
      this.update(mode, skin); noise.start(); breath.start(); this.crackle(.11);
      const next = () => {
        if (this.generation !== generation || this.graph !== graph) return;
        if (graph.skin === 'nordic') this.crackle();
        const spacing = graph.mode === 'toasty' ? .55 : graph.mode === 'cozy' ? 1.1 : 1.65;
        graph.timer = setTimeout(next, (spacing + Math.random() * 1.5) * 1000);
      };
      graph.timer = setTimeout(next, 500);
    } catch { this.stop(true); }
  }
  update(mode, skin) {
    const g = this.graph, context = this.context;
    if (!g) return;
    g.mode = mode; g.skin = skin;
    const level = mode === 'toasty' ? .48 : mode === 'cozy' ? .39 : .30;
    g.output.gain.cancelScheduledValues(context.currentTime);
    g.output.gain.setTargetAtTime(level, context.currentTime, .12);
    g.low.frequency.setTargetAtTime(skin === 'retro' ? 650 : mode === 'toasty' ? 1900 : 1400, context.currentTime, .2);
  }
  crackle(level = null) {
    const g = this.graph, context = this.context;
    if (!g) return;
    const source = context.createBufferSource(); source.buffer = this.noise(.12);
    const filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 850 + Math.random() * 1500; filter.Q.value = .65;
    const envelope = context.createGain(), time = context.currentTime;
    envelope.gain.setValueAtTime(.0001, time);
    envelope.gain.exponentialRampToValueAtTime(level ?? .10 + Math.random() * .16, time + .003);
    envelope.gain.exponentialRampToValueAtTime(.0001, time + .045 + Math.random() * .05);
    source.connect(filter).connect(envelope).connect(g.output); g.pops.add(source);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); g.pops.delete(source); };
    source.start(); source.stop(time + .12);
  }
  stop(immediate = false, suspend = true) {
    this.generation++; clearTimeout(this.releaseTimer); this.releaseTimer = null;
    this.pendingRelease?.(); this.pendingRelease = null;
    const g = this.graph; this.graph = null;
    if (!g) { if (suspend) this.context?.suspend().catch(() => {}); return; }
    clearTimeout(g.timer);
    const context = this.context, generation = this.generation, fade = immediate ? 0 : .18;
    let released = false;
    const release = () => {
      if (released) return; released = true;
      if (this.pendingRelease === release) { this.pendingRelease = null; this.releaseTimer = null; }
      g.noise.disconnect(); g.breath.disconnect(); g.high.disconnect(); g.low.disconnect(); g.bed.disconnect(); g.depth.disconnect(); g.output.disconnect();
      for (const source of g.pops) { try { source.stop(); } catch {} }
      if (suspend && generation === this.generation) context.suspend().catch(() => {});
    };
    try {
      const time = context.currentTime;
      g.output.gain.cancelScheduledValues(time); g.output.gain.setValueAtTime(g.output.gain.value, time);
      g.output.gain.linearRampToValueAtTime(0, time + fade);
      g.noise.stop(time + fade); g.breath.stop(time + fade);
      if (immediate) release(); else { this.pendingRelease = release; this.releaseTimer = setTimeout(release, 220); }
    } catch { release(); }
  }
}
