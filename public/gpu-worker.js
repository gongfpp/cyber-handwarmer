import { createGPUEngine } from './gpu-engine.js';
let engine;
onmessage = ({ data }) => {
  if (!engine && data.type === 'start') engine = createGPUEngine({
    createCanvas: () => typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : null,
    emit: message => postMessage(message), finish: () => close(), mobile: !!data.mobile,
  });
  if (engine) engine.receive(data);
  else if (data.type === 'stop') { postMessage({ type: 'stopped', reason: 'user' }); close(); }
};
postMessage({ type: 'ready' });
