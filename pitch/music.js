// An original, synthesized suspense cue. No external audio assets or downloads.
export class Score {
  constructor(){this.enabled=true;this.context=null;this.timer=null;this.tick=0;this.next=0;this.running=false;}
  unlock(){
    if(!this.context){
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)return;
      this.context=new Audio();
      this.master=this.context.createGain();this.master.gain.value=.65;
      const limiter=this.context.createDynamicsCompressor();limiter.threshold.value=-15;limiter.ratio.value=8;
      this.master.connect(limiter);limiter.connect(this.context.destination);
      this.music=this.context.createGain();this.music.gain.value=0;this.music.connect(this.master);
      const samples=this.context.sampleRate*.3;
      this.noise=this.context.createBuffer(1,samples,this.context.sampleRate);
      const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.6;
    }
    void this.context.resume();
    if(this.running)this.schedule();
  }
  note(frequency,when,length,volume,type='triangle',bus=this.music,end=frequency){
    if(!this.context||!this.enabled)return;
    const osc=this.context.createOscillator(),gain=this.context.createGain(),filter=this.context.createBiquadFilter();
    osc.type=type;osc.frequency.setValueAtTime(frequency,when);osc.frequency.exponentialRampToValueAtTime(end,when+length);
    filter.type='lowpass';filter.frequency.value=type==='sawtooth'?650:2200;
    gain.gain.setValueAtTime(.0001,when);gain.gain.linearRampToValueAtTime(volume,when+.012);gain.gain.exponentialRampToValueAtTime(.0001,when+length);
    osc.connect(filter);filter.connect(gain);gain.connect(bus);osc.start(when);osc.stop(when+length+.02);
  }
  hiss(when,volume=.025){
    if(!this.context||!this.enabled)return;
    const source=this.context.createBufferSource(),filter=this.context.createBiquadFilter(),gain=this.context.createGain();
    source.buffer=this.noise;filter.type='highpass';filter.frequency.value=2200;
    gain.gain.setValueAtTime(volume,when);gain.gain.exponentialRampToValueAtTime(.0001,when+.13);
    source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start(when);source.stop(when+.15);
  }
  start(){
    this.running=true;this.tick=0;
    if(!this.context)return;
    this.next=this.context.currentTime+.035;
    this.music.gain.cancelScheduledValues(this.context.currentTime);this.music.gain.setTargetAtTime(this.enabled?1:0,this.context.currentTime,.035);
    this.schedule();if(!this.timer)this.timer=setInterval(()=>this.schedule(),60);
  }
  schedule(){
    if(!this.running||!this.context||this.context.state!=='running')return;
    const now=this.context.currentTime;
    if(this.next<now-.2)this.next=now+.035;
    const melody=[146.83,220,293.66,311.13,293.66,220,164.81,220];
    while(this.next<now+.18){
      const i=this.tick++,t=this.next;
      this.note(melody[i%8],t,.19,.055);
      this.note(melody[i%8]*1.003,t,.22,.027,'sawtooth');
      if(i%4===0){this.note(i%8===0?73.42:65.41,t,.72,.08,'sawtooth');this.note(95,t,.22,.11,'sine',this.music,38);}
      if(i%2===1)this.hiss(t,.014);
      this.next+=60/148/2;
    }
  }
  impact(){
    if(!this.context||!this.enabled)return;
    const t=this.context.currentTime;
    this.note(110,t,.55,.24,'sine',this.master,28);
    this.note(58.27,t,.4,.09,'sawtooth',this.master,36.7);this.hiss(t,.12);
  }
  giveUp(){
    if(!this.context||!this.enabled)return;
    const t=this.context.currentTime;
    this.note(220,t,.9,.09,'triangle',this.master,146.83);
    this.note(146.83,t+.35,1.25,.07,'triangle',this.master,73.42);
  }
  stop(){
    this.running=false;if(this.timer){clearInterval(this.timer);this.timer=null;}
    if(this.context){this.music.gain.cancelScheduledValues(this.context.currentTime);this.music.gain.setTargetAtTime(0,this.context.currentTime,.025);}
  }
  toggle(){this.enabled=!this.enabled;if(this.context){this.master.gain.setTargetAtTime(this.enabled?.65:0,this.context.currentTime,.025);}return this.enabled;}
}
