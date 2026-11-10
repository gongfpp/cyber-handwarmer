// One bounded GPU batch at a time, in a Worker when possible, otherwise on a small DOM canvas.
export function createGPUEngine({ createCanvas, emit, finish = () => {}, mobile = false, mainThread = false }) {
  function schedule(next, delay) {
    task = setTimeout(() => { try { next(); } catch { stop('context-lost', 'unavailable'); } }, delay);
  }
  const profiles = {
    gentle: { duty: .35, steps: 96, maxSide: 768, targetMs: 8 },
    cozy: { duty: .75, steps: 192, maxSide: 1536, targetMs: 18 },
    toasty: { duty: .85, steps: 384, maxSide: 2048, targetMs: 35 },
  };
  let gl, canvas, program, textures = [], framebuffers = [], sync = null;
  let disposed = false, buffer = null;
  let revision = 0, mode = 'gentle', batchRevision = 0, batchMode = 'gentle', batchSide = 0, batchSteps = 0;
  let statsStart = performance.now(), completed = 0;
  let active = false, task = null, endAt = 0, lastHeartbeat = 0;
  let profile = profiles.gentle, side = 512, frame = 0, lastStats = 0, batchStart = 0;
  let stepLocation, timeLocation, lastBatchMs = 0;
  let timerExt = null, queries = [], timing = null, rendererName = '', runtimeSteps = 96, memoryLimit = mobile || mainThread ? 1024 : 2048, mainLagMs = 0;
  function collectTiming() {
    if (!timerExt) return;
    const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT);
    queries = queries.filter(item => {
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) return true;
      const value = Number(gl.getQueryParameter(item.query, gl.QUERY_RESULT)) / 1e6;
      if (!disjoint && Number.isFinite(value) && value > 0) timing = { ms: value, frame: item.frame, side: item.side, steps: item.steps, revision: item.revision };
      gl.deleteQuery(item.query); return false;
    });
    if (disjoint) timing = null;
    while (queries.length > 8) gl.deleteQuery(queries.shift().query);
  }

  const now = () => performance.timeOrigin + performance.now();
  function stop(reason, type = 'stopped') {
    if (disposed) return;
    disposed = true; active = false; clearTimeout(task);
    if (gl) {
      if (sync) gl.deleteSync(sync);
      for (const item of queries) gl.deleteQuery(item.query);
      for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
      for (const texture of textures) gl.deleteTexture(texture);
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    canvas?.remove?.(); emit({ type, reason }); finish();
  }
  function canRun() {
    if (!active) return false;
    if (now() >= endAt) { stop('deadline'); return false; }
    if (performance.now() - lastHeartbeat > 1400) { stop('heartbeat'); return false; }
    if (gl.isContextLost()) { stop('context-lost', 'unavailable'); return false; }
    return true;
  }
  function shader(type, source) {
    const result = gl.createShader(type); gl.shaderSource(result, source); gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('shader');
    return result;
  }
  function allocate(size) {
    for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const texture of textures) gl.deleteTexture(texture);
    textures = []; framebuffers = []; side = size;
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer');
      gl.clearColor(.2, .3, .4, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      textures.push(texture); framebuffers.push(framebuffer);
    }
    gl.viewport(0, 0, side, side);
  }
  function initialize() {
    canvas = createCanvas();
    if (!canvas) throw new Error('unsupported');
    gl = canvas.getContext('webgl2', { powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('unsupported');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    rendererName = String(renderer); timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer)) throw new Error('software-renderer');
    program = gl.createProgram();
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
    layout(location=0) in vec2 position;
    out vec2 uv;
    void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }`);
    const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    uniform sampler2D previousFrame;
    uniform int steps;
    uniform float phase;
    in vec2 uv;
    out vec4 result;
    void main(){
      vec3 v=texture(previousFrame,uv).rgb+vec3(uv,phase*.0001);
      for(int i=0;i<768;i++){
        if(i>=steps) break;
        v=sin(v.yzx*1.731+vec3(uv.yx,phase*.001)+float(i)*.013)
          +cos(v.zxy*1.273+vec3(.19,.37,.61));
      }
      result=vec4(v*.23+.5,1.);
    }`);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program');
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(gl.getUniformLocation(program, 'previousFrame'), 0);
    stepLocation = gl.getUniformLocation(program, 'steps'); timeLocation = gl.getUniformLocation(program, 'phase');
    memoryLimit = Math.min(memoryLimit, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    allocate(mobile ? 128 : Math.min(512, memoryLimit));
    canvas.addEventListener('webglcontextlost', () => { if (active) stop('context-lost', 'unavailable'); });
  }
  function cycle() {
    if (!canRun()) return;
    const maxSide = Math.min(profile.maxSide, memoryLimit);
    if (side > maxSide) allocate(maxSide);
    batchStart = performance.now(); batchRevision = revision; batchMode = mode; batchSide = side; batchSteps = runtimeSteps;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[frame % 2]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[(frame + 1) % 2]);
    gl.uniform1i(stepLocation, runtimeSteps); gl.uniform1f(timeLocation, frame);
    const query = timerExt ? gl.createQuery() : null;
    if (query) gl.beginQuery(timerExt.TIME_ELAPSED_EXT, query);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (query) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); queries.push({ query, frame, side, steps: runtimeSteps, revision: batchRevision }); }

    sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    if (!sync) { stop('gpu-sync', 'unavailable'); return; }
    schedule(poll, 2);
  }
  function poll() {
    if (!canRun()) return;
    const result = gl.clientWaitSync(sync, 0, 0);
    if (result === gl.WAIT_FAILED || performance.now() - batchStart > 2000) { stop('gpu-timeout', 'unavailable'); return; }
    if (result === gl.TIMEOUT_EXPIRED) { schedule(poll, 4); return; }
    gl.deleteSync(sync); sync = null;
    const elapsed = Math.max(1, performance.now() - batchStart); lastBatchMs = elapsed; frame++; if (batchRevision === revision) completed++; collectTiming();
    const gpuMs = timing && timing.revision === batchRevision && frame - timing.frame < 12 ? timing.ms : null;
    const workMs = gpuMs || elapsed;
    // Adapt resolution only after completed work. No texture reallocation while a batch is pending.
    if (frame % 6 === 0 || (mobile && frame <= 3)) {
      const targetMs = Math.min(profile.targetMs, mainThread ? 8 : mobile ? 18 : 35, mainLagMs > 80 ? 8 : 35);
      const factor = Math.max(.70, Math.min(1.35, Math.sqrt(targetMs / Math.max(.2, workMs))));
      const maxSide = Math.min(profile.maxSide, memoryLimit);
      const next = Math.max(128, Math.min(maxSide, Math.round(side * factor / 32) * 32));
      if (Math.abs(next - side) >= 32) allocate(next);
      else if (side >= maxSide && workMs < targetMs * .7) runtimeSteps = Math.min(768, Math.round(runtimeSteps * 1.25));
      else if (workMs > targetMs * 2) runtimeSteps = Math.max(24, Math.round(runtimeSteps * .75));
      else if (workMs < targetMs * .7 && runtimeSteps < profile.steps) runtimeSteps = Math.min(profile.steps, Math.round(runtimeSteps * 1.25));
    }
    if (performance.now() - lastStats > 700 && batchRevision === revision) {
      lastStats = performance.now(); emit({ type: 'stats', revision: batchRevision, mode: batchMode, frames: frame, side: batchSide, steps: batchSteps, batchesPerSecond: completed * 1000 / Math.max(1, performance.now() - statsStart), batchMs: Math.round(lastBatchMs), gpuMs: gpuMs ? Math.round(gpuMs * 100) / 100 : null, measurement: gpuMs ? 'gpu-timer' : 'fence-wall', backend: mainThread ? 'page-webgl2' : 'worker-webgl2', renderer: rendererName, maxSide: Math.min(profile.maxSide, memoryLimit) });
      completed = 0; statsStart = performance.now();
    }
    const duty = mainLagMs > 80 ? Math.min(.65, profile.duty) : profile.duty;
    const pause = Math.max(0, workMs / duty - elapsed);
    // No display frame-rate cap: the offscreen work is independent of visual animation.
    schedule(cycle, pause);
  }

  function receive(data) {
    if (disposed) return;
    if (data.type === 'stop') { stop('user'); return; }
    if (data.type === 'heartbeat') { lastHeartbeat = performance.now(); mainLagMs = Number(data.mainLagMs) || 0; return; }
    if (data.type === 'start' || data.type === 'update') {
      const nextRevision = Number(data.revision) || 0;
      if (revision !== nextRevision) { completed = 0; statsStart = performance.now(); }
      revision = nextRevision; mode = data.mode || mode;
      const nextProfile = profiles[data.mode] || profiles.gentle;
      if (profile !== nextProfile || !active) runtimeSteps = mobile ? Math.min(96, nextProfile.steps) : nextProfile.steps;
      profile = nextProfile;
      emit({ type: 'applied', revision, mode });
      endAt = Math.min(Number(data.endAt) || now(), now() + 300000); lastHeartbeat = performance.now();
      if (!active && data.type === 'start') {
        if (data.memoryGiB && data.memoryGiB <= 2) memoryLimit = Math.min(memoryLimit, 768);
        try {
          initialize(); active = true;
          cycle();
          if (!active) return;
          emit({ type: 'running', device: { renderer: rendererName, timerQueries: !!timerExt, maxSide: memoryLimit, backend: mainThread ? 'page-webgl2' : 'worker-webgl2' } });
        } catch (error) { stop(error.message || 'unsupported', 'unavailable'); }
      }
    }
  }
  return { receive, stop: () => stop('user') };
}
