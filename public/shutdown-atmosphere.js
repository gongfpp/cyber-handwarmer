// Translucent liquid, hot gas and flame. No pictograms or outlined smoke.
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const envelope = (t,a,b,c,d) => smooth((t-a)/(b-a)) * (1-smooth((t-c)/(d-c)));
export class ShutdownAtmosphere {
  constructor(canvas) { this.canvas = canvas; this.context = null; }
  prepare() {
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.width = Math.round(330 * ratio); this.canvas.height = Math.round(510 * ratio);
    this.context = this.canvas.getContext('2d'); this.context?.setTransform(ratio,0,0,ratio,0,0);
  }
  clear() {
    this.context?.clearRect(0,0,330,510);
    delete this.canvas.dataset.water; delete this.canvas.dataset.flame; delete this.canvas.dataset.drop;
  }
  paint(milliseconds) {
    const c = this.context; if (!c) return;
    const t = milliseconds/1000; c.clearRect(0,0,330,510);
    const water = envelope(t,.43,.55,.86,1.02), flame = envelope(t,1.055,1.21,2.015,2.075);
    this.canvas.dataset.water = String(water > .1); this.canvas.dataset.flame = String(flame > .2);
    this.canvas.dataset.drop = String(t > 1.79 && t < 2.05);
    // A little contact shadow makes the vessel belong to the room.
    const vessel = envelope(t,0,.27,2.35,2.7);
    const shadow=c.createRadialGradient(260,226,1,260,226,43);shadow.addColorStop(0,`rgba(9,18,13,${.10*vessel})`);shadow.addColorStop(1,'rgba(9,18,13,0)');c.fillStyle=shadow;c.fillRect(216,183,88,86);
    if (flame > 0) this.fire(t,flame);
    this.vapor(t,.65,.84,1.09,1.48,.58);
    if (water > 0) {
      c.save();c.globalAlpha=water;c.lineCap='round';
      const stream=c.createLinearGradient(197,184,165,333);stream.addColorStop(0,'rgba(235,248,235,.82)');stream.addColorStop(.35,'rgba(161,193,184,.32)');stream.addColorStop(1,'rgba(228,245,232,.6)');
      c.strokeStyle=stream;c.lineWidth=2.2;c.beginPath();c.moveTo(197,184);c.bezierCurveTo(195,221,178+Math.sin(t*18),292,165,333);c.stroke();
      c.lineWidth=.55;c.strokeStyle='rgba(250,255,240,.72)';c.beginPath();c.moveTo(196.6,184);c.bezierCurveTo(194,223,177,294,164.5,333);c.stroke();
      for(let i=0;i<19;i++){
        const u=(t*1.8+i/19)%1,x=197-32*u+Math.sin(u*13+t*22)*u*1.3,y=184+149*u;
        c.fillStyle=`rgba(220,242,230,${.3+.3*Math.sin(i*2)**2})`;c.beginPath();c.ellipse(x,y,.65+u*.7,1.2+u*1.5,-.2,0,Math.PI*2);c.fill();
      }
      c.restore();
    }
    this.splash(t-.73,.8);this.splash(t-2.045,1);
    if(t>1.77&&t<2.06){
      const fall=clamp((t-1.93)/.115),size=smooth((t-1.77)/.12);
      this.drop(197-32*fall,190+139*fall*fall,size*(1-.08*fall),1+.18*fall);
    }
    this.vapor(t,2.035,2.16,2.32,2.69,.9);
  }
  fire(t,amount) {
    const c=this.context; c.save();
    // Keep hot gas inside the glass, with a broad, almost invisible light spill.
    c.beginPath();c.rect(62,100,207,260);c.clip();c.globalCompositeOperation='screen';
    const glow=c.createRadialGradient(165,321,1,165,321,59);glow.addColorStop(0,`rgba(255,139,45,${.19*amount})`);glow.addColorStop(1,'rgba(248,95,20,0)');c.fillStyle=glow;c.fillRect(104,260,122,100);
    const lift=1+.15*Math.exp(-Math.pow((t-1.22)/.12,2));
    for(let layer=0;layer<5;layer++){
      const offset=(layer-2)*3.1, h=(65-layer*8)*amount*lift*(1+.055*Math.sin(t*27+layer*1.9));
      const x=165+offset, y=333, sway=Math.sin(t*12+layer*.9)*5+Math.sin(t*23)*1.6,w=12-layer*.9;
      const gradient=c.createLinearGradient(x,y,x,y-h);gradient.addColorStop(0,'rgba(255,234,157,.78)');gradient.addColorStop(.2,'rgba(255,190,75,.68)');gradient.addColorStop(.56,'rgba(241,103,24,.38)');gradient.addColorStop(.87,'rgba(219,62,15,.12)');gradient.addColorStop(1,'rgba(202,43,8,0)');
      c.fillStyle=gradient;c.globalAlpha=amount*(layer===0?.65:.74);
      c.beginPath();c.moveTo(x-w,y);c.bezierCurveTo(x-w*1.4,y-h*.28,x+sway+w*.4,y-h*.57,x+sway-4,y-h);
      c.bezierCurveTo(x+sway+13,y-h*.61,x+w*1.45,y-h*.28,x+w,y);c.quadraticCurveTo(x,y+3,x-w,y);c.fill();
    }
    c.globalAlpha=amount;
    const core=c.createRadialGradient(165,331,1,165,329,12);core.addColorStop(0,'rgba(255,248,203,.9)');core.addColorStop(.4,'rgba(255,181,65,.35)');core.addColorStop(1,'rgba(255,120,24,0)');c.fillStyle=core;c.fillRect(152,317,26,23);
    for(let i=0;i<3;i++){const u=(t*.95+i*.31)%1;c.fillStyle=`rgba(255,195,99,${(1-u)*amount*.65})`;c.beginPath();c.arc(163+Math.sin(i*4+t)*7,326-u*65,.5,0,Math.PI*2);c.fill();}
    c.restore();
  }
  vapor(t,a,b,d,e,strength) {
    const opacity=envelope(t,a,b,d,e)*strength;if(opacity<=0)return;
    const c=this.context,p=clamp((t-a)/(e-a));c.save();c.globalCompositeOperation='screen';
    for(let layer=0;layer<3;layer++)for(let i=0;i<6;i++){
      const u=(i+.4)/6, x=164+Math.sin(i*2.1+layer)*12+Math.sin(t*3+i)*p*9-(p*8),y=331-p*(24+u*48)-layer*4;
      const r=8+u*8+p*12, gradient=c.createRadialGradient(x-r*.1,y-r*.12,0,x,y,r);
      gradient.addColorStop(0,`rgba(216,224,213,${opacity*.062})`);gradient.addColorStop(.45,`rgba(189,205,194,${opacity*.035})`);gradient.addColorStop(1,'rgba(168,189,181,0)');
      c.fillStyle=gradient;c.beginPath();c.ellipse(x,y,r,r*.8,Math.sin(i)*.3,0,Math.PI*2);c.fill();
    }
    c.restore();
  }
  splash(age,strength) {
    if(age<0||age>.46)return;const c=this.context,fade=(1-age/.46)*strength;
    c.save();c.globalAlpha=fade;
    for(let i=0;i<14;i++){
      const angle=(i/13-.5)*2.7,speed=30+(Math.sin(i*8)*.5+.5)*33;
      const x=165+Math.sin(angle)*age*speed,y=334-Math.cos(angle)*age*speed+age*age*120;
      c.fillStyle='rgba(227,243,230,.65)';c.beginPath();c.ellipse(x,y,.55+(i%3)*.25,1.05,-angle,0,Math.PI*2);c.fill();
    }
    c.strokeStyle='rgba(218,237,223,.34)';c.lineWidth=.6;c.beginPath();c.ellipse(165,335,5+age*45,1+age*4,0,0,Math.PI*2);c.stroke();c.restore();
  }
  drop(x,y,size,stretch) {
    const c=this.context;c.save();c.translate(x,y);c.scale(size, size*stretch);
    const glass=c.createRadialGradient(-3,-3,.3,0,1,10);glass.addColorStop(0,'rgba(248,255,242,.88)');glass.addColorStop(.28,'rgba(205,228,213,.25)');glass.addColorStop(.58,'rgba(32,69,57,.20)');glass.addColorStop(1,'rgba(207,233,219,.66)');
    c.fillStyle=glass;c.strokeStyle='rgba(224,245,230,.68)';c.lineWidth=.7;
    c.beginPath();c.moveTo(0,-11);c.bezierCurveTo(-1,-7,-7,-3,-7,2);c.bezierCurveTo(-7,11,7,11,7,2);c.bezierCurveTo(7,-3,1,-7,0,-11);c.fill();c.stroke();
    c.fillStyle='rgba(255,255,245,.82)';c.beginPath();c.ellipse(-3,0,1,3,-.2,0,Math.PI*2);c.fill();
    c.strokeStyle='rgba(239,181,99,.55)';c.lineWidth=.7;c.beginPath();c.arc(0,2,5.2,.35,1.2);c.stroke();c.restore();
  }
}
