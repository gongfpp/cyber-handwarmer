import { ShutdownAtmosphere } from './shutdown-atmosphere.js';
// Computation has already stopped. Each physical appliance has its own coda.
export class Shutdown {
  animations = []; timers = []; frame = 0; finish = null;
  constructor(heater) { this.heater = heater; this.atmosphere = new ShutdownAtmosphere(heater.querySelector('.shutdown-atmosphere')); }
  cancel() {
    cancelAnimationFrame(this.frame); this.frame = 0; this.atmosphere.clear();
    for (const timer of this.timers) clearTimeout(timer);
    for (const animation of this.animations) animation.cancel();
    this.timers = []; this.animations = [];
    this.heater.dataset.ending = 'false'; delete this.heater.dataset.endingStage; this.heater.style.removeProperty('--coil-start');
    this.finish?.(false); this.finish = null;
  }
  play() {
    this.cancel();
    const duration = 2700, root = this.heater, retro = document.body.dataset.skin === 'retro';
    const knobStart = retro ? getComputedStyle(root.querySelector('.relay-knob')).transform : '';
    if (retro) root.style.setProperty('--coil-start', getComputedStyle(root.querySelector('.coils i'), '::before').opacity);
    root.dataset.ending = 'true'; root.dataset.endingStage = 'arrive';
    const animate = (selector, frames) => {
      const node = root.querySelector(selector);
      if (node) this.animations.push(node.animate(frames, { duration, fill: 'both', easing: 'linear' }));
    };
    const hold = (offset, opacity, transform, easing) => ({ offset, opacity, ...(transform ? { transform } : {}), ...(easing ? { easing } : {}) });
    if (retro) {
      animate('.relay-knob', [
        hold(0,1,knobStart,'cubic-bezier(.6,0,.2,1)'),hold(.18,1,'rotate(-38deg)'),hold(.42,1,'rotate(-38deg)'),
        hold(.50,1,'rotate(-33deg)'),hold(.63,1,'rotate(-33deg)','cubic-bezier(.7,0,.2,1)'),
        hold(.755,1,'rotate(-57deg)'),hold(.82,1,'rotate(-38deg)'),hold(1,1,'rotate(-38deg)'),
      ]);
      animate('.reflector', [hold(0,1),hold(.32,.14),hold(.45,.1),hold(.54,.35),hold(.65,.16),hold(.77,.1),hold(1,.1)]);
    } else {
      this.atmosphere.prepare();
      const began = performance.now();
      const draw = time => { const elapsed=time-began; this.atmosphere.paint(elapsed); if(elapsed<duration)this.frame=requestAnimationFrame(draw); };
      this.frame=requestAnimationFrame(draw);
      animate('.can-motion', [
        hold(0,0,'translate(36px,16px) rotate(10deg)','cubic-bezier(.16,.75,.2,1)'),hold(.10,1,'translate(0,0) rotate(-2deg)','cubic-bezier(.4,0,.2,1)'),
        hold(.18,1,'translate(0,0) rotate(-30deg)'),hold(.34,1,'translate(0,0) rotate(-30deg)','cubic-bezier(.2,.7,.3,1)'),
        hold(.44,1,'translate(13px,-4px) rotate(1deg)'),hold(.50,1,'translate(23px,-7px) rotate(7deg)'),
        hold(.55,1,'translate(23px,-7px) rotate(7deg)','cubic-bezier(.45,0,.25,1)'),hold(.61,1,'translate(17px,-5px) rotate(-5deg)','cubic-bezier(.35,0,.2,1)'),
        hold(.68,1,'translate(0,0) rotate(-30deg)'),hold(.82,1,'translate(0,0) rotate(-30deg)','cubic-bezier(.2,.65,.3,1)'),
        hold(.90,1,'translate(10px,-7px) rotate(0deg)'),hold(1,0,'translate(38px,-14px) rotate(8deg)'),
      ]);
      animate('.flames', [hold(0,1,getComputedStyle(root.querySelector('.flames')).transform),hold(.19,1,'translateY(18px) scaleY(.82)'),hold(.29,.5,'translateY(24px) scaleY(.38)'),hold(.37,0,'translateY(27px) scaleY(.08)'),hold(1,0)]);
      animate('.firelight', [hold(0,1),hold(.20,1),hold(.37,0),hold(1,0)]);
    }
    const stages = retro ? [[450,'cooling'],[1080,'relight'],[1770,'cutoff'],[2050,'out']] : [[450,'pour'],[1080,'rebel'],[1770,'last-drop'],[2050,'out']];
    for (const [time,stage] of stages) this.timers.push(setTimeout(()=>{root.dataset.endingStage=stage;},time));
    return new Promise(resolve=>{
      this.finish=resolve;
      this.timers.push(setTimeout(()=>{this.finish=null;this.cancel();resolve(true);},duration));
    });
  }
}
