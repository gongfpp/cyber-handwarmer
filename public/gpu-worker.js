/* Actual WebGL2 shader work in a Worker. One GPU batch in flight; never an unbounded queue. */
const profiles = {
  gentle: { duty: .35, steps: 96, maxSide: 768, targetMs: 8 },
  cozy: { duty: .65, steps: 192, maxSide: 1280, targetMs: 13 },
  toasty: { duty: .90, steps: 384, maxSide: 2048, targetMs: 20 },
};
let gl, canvas, program, textures = [], framebuffers = [], sync = null;
let active = false, task = null, endAt = 0, lastHeartbeat = 0;
let profile = profiles.gentle, side = 512, frame = 0, lastStats = 0, batchStart = 0;
let stepLocation, timeLocation, lastGpuMs = 0;
const now = () => performance.timeOrigin + performance.now();
function stop(reason, type = 'stopped') {
  active = false; clearTimeout(task);
  if (gl) {
    if (sync) gl.deleteSync(sync);
    for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const texture of textures) gl.deleteTexture(texture);
    if (program) gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  postMessage({ type, reason }); close();
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
  if (typeof OffscreenCanvas === 'undefined') throw new Error('unsupported');
  canvas = new OffscreenCanvas(1, 1);
  gl = canvas.getContext('webgl2', { powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error('unsupported');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
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
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(gl.getUniformLocation(program, 'previousFrame'), 0);
  stepLocation = gl.getUniformLocation(program, 'steps'); timeLocation = gl.getUniformLocation(program, 'phase');
  allocate(512);
  canvas.addEventListener('webglcontextlost', () => { if (active) stop('context-lost', 'unavailable'); });
}
function cycle() {
  if (!canRun()) return;
  if (side > profile.maxSide) allocate(profile.maxSide);
  batchStart = performance.now();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures[frame % 2]);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[(frame + 1) % 2]);
  gl.uniform1i(stepLocation, profile.steps); gl.uniform1f(timeLocation, frame);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
  if (!sync) { stop('gpu-sync', 'unavailable'); return; }
  task = setTimeout(poll, 2);
}
function poll() {
  if (!canRun()) return;
  const result = gl.clientWaitSync(sync, 0, 0);
  if (result === gl.WAIT_FAILED || performance.now() - batchStart > 2000) { stop('gpu-timeout', 'unavailable'); return; }
  if (result === gl.TIMEOUT_EXPIRED) { task = setTimeout(poll, 4); return; }
  gl.deleteSync(sync); sync = null;
  const elapsed = Math.max(1, performance.now() - batchStart); lastGpuMs = elapsed; frame++;
  // Adapt resolution only after completed work. No texture reallocation while a batch is pending.
  if (frame % 12 === 0) {
    const factor = Math.max(.75, Math.min(1.15, Math.sqrt(profile.targetMs / elapsed)));
    const next = Math.max(128, Math.min(profile.maxSide, Math.round(side * factor / 32) * 32));
    if (Math.abs(next - side) >= 32) allocate(next);
  }
  if (performance.now() - lastStats > 700) {
    lastStats = performance.now(); postMessage({ type: 'stats', frames: frame, side, steps: profile.steps, batchMs: Math.round(lastGpuMs) });
  }
  const period = Math.max(1000 / 60, elapsed / profile.duty);
  task = setTimeout(cycle, Math.max(0, period - elapsed));
}
onmessage = ({ data }) => {
  if (data.type === 'stop') { stop('user'); return; }
  if (data.type === 'heartbeat') { lastHeartbeat = performance.now(); return; }
  if (data.type === 'start' || data.type === 'update') {
    profile = profiles[data.mode] || profiles.gentle;
    endAt = Math.min(Number(data.endAt) || now(), now() + 300000); lastHeartbeat = performance.now();
    if (!active && data.type === 'start') {
      try { initialize(); active = true; postMessage({ type: 'running' }); cycle(); }
      catch (error) { stop(error.message || 'unsupported', 'unavailable'); }
    }
  }
};
postMessage({ type: 'ready' });
