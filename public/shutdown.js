// A short visual coda. All computation has already stopped before play() is called.
export class Shutdown {
  animations = []; timers = []; finish = null;
  constructor(heater) { this.heater = heater; }
  cancel() {
    for (const timer of this.timers) clearTimeout(timer);
    for (const animation of this.animations) animation.cancel();
    this.timers = []; this.animations = [];
    this.heater.dataset.ending = 'false'; delete this.heater.dataset.endingStage;
    this.finish?.(false); this.finish = null;
  }
  play() {
    this.cancel();
    const duration = 2700, root = this.heater;
    root.dataset.ending = 'true'; root.dataset.endingStage = 'arrive';
    const animate = (selector, frames, options = {}) => {
      const node = root.querySelector(selector);
      if (node) this.animations.push(node.animate(frames, { duration, fill: 'both', easing: 'linear', ...options }));
    };
    const hold = (offset, opacity, transform) => ({ offset, opacity, ...(transform ? { transform } : {}) });
    animate('.can-motion', [
      hold(0, 0, 'translate(36px,20px) rotate(12deg)'), hold(.10, 1, 'translate(0,0) rotate(0deg)'),
      hold(.18, 1, 'translate(0,0) rotate(-30deg)'), hold(.34, 1, 'translate(0,0) rotate(-30deg)'),
      hold(.43, 1, 'translate(14px,-4px) rotate(0deg)'), hold(.50, 1, 'translate(24px,-8px) rotate(8deg)'),
      hold(.55, 1, 'translate(24px,-8px) rotate(8deg)'), hold(.61, 1, 'translate(16px,-6px) rotate(-8deg)'),
      hold(.68, 1, 'translate(0,0) rotate(-30deg)'), hold(.82, 1, 'translate(0,0) rotate(-30deg)'),
      hold(.90, 1, 'translate(10px,-8px) rotate(0deg)'), hold(1, 0, 'translate(38px,-16px) rotate(10deg)'),
    ]);
    animate('.water-stream', [hold(0, 0), hold(.17, 0), hold(.19, .95), hold(.32, .95), hold(.36, 0), hold(1, 0)]);
    for (const line of root.querySelectorAll('.water-stream path')) this.animations.push(line.animate(
      [{ strokeDashoffset: '0' }, { strokeDashoffset: '-200' }], { duration: 650, delay: 450, fill: 'both' }));
    animate('.flames', [hold(0, 1, getComputedStyle(root.querySelector('.flames')).transform),
      hold(.19, 1, 'translateY(18px) scaleY(.82)'), hold(.29, .7, 'translateY(25px) scaleY(.35)'),
      hold(.36, 0, 'translateY(32px) scaleY(.02)'), hold(1, 0, 'scaleY(0)')]);
    animate('.firelight', [hold(0, 1), hold(.20, 1), hold(.36, 0), hold(1, 0)]);
    animate('.coils', [hold(0, 1), hold(.20, 1), hold(.36, 0), hold(1, 0)]);
    animate('.reflector', [hold(0, 1), hold(.20, 1), hold(.36, .1), hold(1, .1)]);
    animate('.first-splash', [hold(0, 0, 'scale(.1)'), hold(.23, 0, 'scale(.1)'), hold(.27, .8, 'scale(1)'), hold(.39, 0, 'scale(1.6)'), hold(1, 0)]);
    animate('.first-steam', [hold(0, 0, 'translateY(0)'), hold(.29, 0, 'translateY(0)'), hold(.34, .55, 'translateY(-5px)'), hold(.47, 0, 'translateY(-28px)'), hold(1, 0)]);
    animate('.stubborn-flame', [
      hold(0, 0, 'scale(0)'), hold(.39, 0, 'scale(.3,0)'), hold(.44, 1, 'scale(.75,1.2)'),
      hold(.48, 1, 'scale(1.1,.86)'), hold(.52, 1, 'scale(1)'), hold(.58, 1, 'translateY(-3px) scale(.96,1.05)'),
      hold(.64, 1, 'scale(1.02,.98)'), hold(.735, 1, 'scale(1)'), hold(.758, 1, 'scale(1.35,.13)'),
      hold(.78, 0, 'scale(1.4,.02)'), hold(1, 0),
    ]);
    animate('.last-drop', [
      hold(0, 0, 'translate(202px,184px) scale(.1)'), hold(.65, 0, 'translate(202px,184px) scale(.1)'),
      hold(.69, 1, 'translate(202px,190px) scale(1.25)'), hold(.715, 1, 'translate(202px,190px) scale(1.25)'),
      hold(.75, 1, 'translate(165px,324px) scale(.85,1.45)'), hold(.758, 0, 'translate(165px,334px) scale(1.6,.3)'), hold(1, 0),
    ]);
    animate('.final-splash', [hold(0, 0, 'scale(.1)'), hold(.75, 0, 'scale(.1)'), hold(.78, .9, 'scale(1)'), hold(.88, 0, 'scale(1.8)'), hold(1, 0)]);
    animate('.final-steam', [hold(0, 0, 'translateY(0) scale(.5)'), hold(.755, 0, 'translateY(0) scale(.5)'), hold(.80, .7, 'translateY(-5px) scale(1)'), hold(.96, 0, 'translateY(-34px) scale(1.25)'), hold(1, 0)]);
    for (const [time, stage] of [[450, 'pour'], [1080, 'rebel'], [1770, 'last-drop'], [2050, 'out']]) {
      this.timers.push(setTimeout(() => { root.dataset.endingStage = stage; }, time));
    }
    return new Promise(resolve => {
      this.finish = resolve;
      this.timers.push(setTimeout(() => { this.finish = null; this.cancel(); resolve(true); }, duration));
    });
  }
}
