import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHall, buildBathroom, buildStudy, buildPhone, material, idle, run, batchStatic } from './world.js';

import { Score } from './music.js';
import { buildHG } from './architecture.js';

const score=new Score();
const canvas=document.getElementById('scene');
const stage=document.getElementById('stage');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene=new THREE.Scene();
scene.background=new THREE.Color('#eeece6');
const camera=new THREE.PerspectiveCamera(34,innerWidth/innerHeight,.05,180);
let renderer;
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
}catch(error){
  document.getElementById('curtain').hidden=true;
  document.getElementById('error').hidden=false;
  throw error;
}
const lowQuality=new URLSearchParams(location.search).get('quality')==='low';
renderer.setPixelRatio(Math.min(devicePixelRatio,lowQuality?1:1.25));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=false;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=.94;
const pmrem=new THREE.PMREMGenerator(renderer);
const roomEnvironment=new RoomEnvironment();
scene.environment=pmrem.fromScene(roomEnvironment,.025).texture;
roomEnvironment.dispose();pmrem.dispose();
scene.environmentIntensity=.3;
scene.add(new THREE.HemisphereLight('#ffffff','#89927d',1.5));
const key=new THREE.DirectionalLight('#fff3df',2.6);
key.position.set(-9,19,12);key.castShadow=true;key.shadow.mapSize.set(1024,1024);
Object.assign(key.shadow.camera,{left:-19,right:19,top:19,bottom:-19,near:1,far:55});
key.shadow.normalBias=.025;key.shadow.radius=3;scene.add(key);
const fill=new THREE.DirectionalLight('#d9e8ee',1.4);fill.position.set(12,9,-6);scene.add(fill);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(180,180),new THREE.ShadowMaterial({color:'#70786b',opacity:.13}));
ground.rotation.x=-Math.PI/2;ground.position.y=-.3;ground.receiveShadow=true;scene.add(ground);

const hall=buildHall(scene),bathroom=buildBathroom(scene),study=buildStudy(scene),phone=buildPhone(scene);
const exterior=buildHG(scene);
const sets=[exterior.root,hall.root,bathroom.root,study.root];
batchStatic(hall.root,hall.student);batchStatic(bathroom.root,bathroom.student);batchStatic(study.root,study.student);
const cssScene=new THREE.Scene();
const cssRenderer=new CSS3DRenderer({element:document.getElementById('screens')});cssRenderer.setSize(innerWidth,innerHeight);
const screenElement=document.createElement('div');screenElement.className='phone-screen';
const appFrame=document.createElement('iframe');appFrame.title='Study Spaces live booking app';appFrame.allow='camera';
const requestedApp=new URLSearchParams(location.search).get('app');
let appUrl='http://localhost:5173/map';
if(requestedApp){try{const url=new URL(requestedApp);if(['http:','https:'].includes(url.protocol))appUrl=url.href;}catch{ /* Keep the local app if the URL is malformed. */ }}
appFrame.src=appUrl;screenElement.append(appFrame);
appFrame.addEventListener('load',()=>{stage.dataset.appLoaded='true';});
const island=document.createElement('div');island.className='island';island.setAttribute('aria-hidden','true');screenElement.append(island);
const phoneCover=document.createElement('button');phoneCover.className='phone-cover';phoneCover.setAttribute('aria-label','Open the phone to reserve a study seat');screenElement.append(phoneCover);
const cssPhone=new THREE.Group();cssScene.add(cssPhone);
const cssScreen=new CSS3DObject(screenElement);cssScreen.scale.setScalar(.001);cssScreen.position.set(0,0,.036);cssPhone.add(cssScreen);

const names=['ETH main building','The student enters the hall','Looking for an available study seat','A moment to sit down','Live booking on the phone','Studying at the reserved seat'];
const durations=[6200,1200,12000,6500,3000,0];
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const cameraFrom=new THREE.Vector3(),lookFrom=new THREE.Vector3(),cameraTo=new THREE.Vector3(),lookTo=new THREE.Vector3();
const look=new THREE.Vector3(0,1,-1);
const initialPhonePosition=new THREE.Vector3(.25,1.18,-.18);
const flyCurve=new THREE.CatmullRomCurve3([
  new THREE.Vector3(22,14,24),new THREE.Vector3(17,9,16),new THREE.Vector3(12,5,6),
  new THREE.Vector3(exterior.entry.x+4.8,2.1,exterior.entry.z+1),
  new THREE.Vector3(exterior.entry.x+.48,1.24,exterior.entry.z),
]);
const droneCurve=new THREE.CatmullRomCurve3([
  new THREE.Vector3(0,.13,1.55),new THREE.Vector3(0,1.2,1.6),new THREE.Vector3(0,2.7,1.4),
  new THREE.Vector3(0,4.2,.8),new THREE.Vector3(.08,5.65,-.05),
]);
const curvePoint=new THREE.Vector3();
const finalPhonePosition=new THREE.Vector3(0,2.5,0);
const finalPhoneScale=4.65;
let current=0,elapsed=0,last=performance.now(),transition=0,autoplay=false,paused=false,exteriorStarted=false;
let clickDown=null,impactTime=-1000,lastDraw=0,forceDraw=true,frameSamples=0,frameTotal=0;
const impacts=new Set();
const taken=document.getElementById('taken');

function ease(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function lerp(a,b,t){return a+(b-a)*t;}
function captureCamera(){cameraFrom.copy(camera.position);lookFrom.copy(look);transition=0;}
function positionCamera(pos,target){cameraTo.set(...pos);lookTo.set(...target);}
function updateAccessibleState(){
  stage.dataset.scene=String(current+1);stage.dataset.interactive=String(current===4&&elapsed>=durations[4]);
  canvas.setAttribute('aria-label',current===4?'Continue to the study scene':'Advance presentation scene');
  document.getElementById('status').textContent=names[current];
}
function slam(id){
  if(impacts.has(id))return;
  impacts.add(id);impactTime=elapsed;taken.classList.remove('slam');
  void taken.offsetWidth;taken.classList.add('slam');score.impact();
  stage.dataset.peek=String(id);
}
function go(index){
  captureCamera();current=Math.max(0,Math.min(5,index));elapsed=0;paused=false;impacts.clear();impactTime=-1000;taken.classList.remove('slam');delete stage.dataset.peek;forceDraw=true;renderer.shadowMap.needsUpdate=true;
  sets.forEach(root=>{root.visible=false;root.position.y=0;});
  exterior.root.visible=current===0;
  hall.root.visible=(current===1||current===2);bathroom.root.visible=current===3||current===4;study.root.visible=current===5;
  phone.root.visible=current===3||current===4;
  const phoneShown=phone.root.visible&&current!==3;
  screenElement.classList.toggle('visible',phoneShown);
  screenElement.inert=!phoneShown;screenElement.setAttribute('aria-hidden',String(!phoneShown));
  screenElement.classList.remove('interactive');phoneCover.hidden=false;
  // Keep the real map mounted off-screen from startup, so its data and tiles warm up.
  cssPhone.visible=true;
  if(!phone.root.visible){cssPhone.position.set(0,-60,0);cssPhone.scale.setScalar(1);}
  key.color.set(current===5?'#ffdeb0':'#fff3df');fill.intensity=current===5?.8:1.4;
  if(current>2)score.stop();
  if(current===0){
    exteriorStarted=false;paused=true;score.stop();
    positionCamera([22,14,24],[0,1,0]);
    camera.position.copy(cameraTo);look.copy(lookTo);cameraFrom.copy(cameraTo);lookFrom.copy(lookTo);
  }else if(current===1){
    if(!score.running)score.start();
    hall.student.position.set(-10.9,0,3.1);hall.student.rotation.y=Math.PI/2;
    positionCamera([-8.2,2.25,7],[-10.9,1.05,2.4]);
  }else if(current===2){positionCamera([-8.2,2.25,7],[-10.9,1.05,2.4]);score.start();}
  else if(current===3){
    positionCamera(reducedMotion?[.08,5.65,-.05]:[0,.13,1.55],reducedMotion?[0,.6,-.6]:[0,.10,-.32]);
    // Cut to the shoes under the door before beginning the vertical reveal.
    camera.position.copy(cameraTo);look.copy(lookTo);cameraFrom.copy(cameraTo);lookFrom.copy(lookTo);
    phone.root.position.copy(initialPhonePosition);phone.root.scale.setScalar(1);phone.root.rotation.set(-1.22,-.08,-.1);
    bathroom.student.userData.arms[1].shoulder.rotation.set(-1.1,0,-.2);
    bathroom.student.userData.arms[1].elbow.rotation.x=-1.5;
  }else if(current===4){
    // The device grows out of the character's hand as the room falls away.
    phone.root.position.copy(initialPhonePosition);phone.root.scale.setScalar(1);phone.root.rotation.set(-1.22,-.08,-.1);
    positionCamera([0,2.5,8.1],[0,2.5,0]);
  }else{
    positionCamera([8,5.6,9],[0,1.25,-.5]);autoplay=false;
  }
  updateAccessibleState();
}
function startExterior(){
  exteriorStarted=true;paused=false;elapsed=0;transition=0;score.start();forceDraw=true;
}
function advance(){
  if(current===0&&!exteriorStarted){startExterior();return;}
  if(current===5)go(0);else go(current+1);
}
function exteriorMotion(){
  if(!exteriorStarted)return;
  const p=reducedMotion?1:ease(Math.min(elapsed/durations[0],1));
  flyCurve.getPoint(p,curvePoint);cameraTo.copy(curvePoint);
  const aim=ease(Math.min(elapsed/4600,1));lookTo.set(lerp(0,exterior.entry.x,aim),lerp(1,exterior.entry.y,aim),lerp(0,exterior.entry.z,aim));
}
function droneMotion(){
  const p=reducedMotion?1:ease(Math.max(0,Math.min((elapsed-1100)/4100,1)));
  droneCurve.getPoint(p,curvePoint);cameraTo.copy(curvePoint);
  lookTo.set(0,lerp(.10,.6,p),lerp(-.32,-.6,p));
}
function searchMotion(){
  const t=elapsed/1000;
  let x=-10.9,z=3.1,strength=0,peek=0,room=-6.25;
  if(t<2.6){
    const p=Math.min(t/2.6,1);x=lerp(-10.9,-6.25,ease(p));strength=Math.sin(Math.PI*p)*.8+.15;
  }else if(t<5.3){
    x=-6.25;peek=ease(Math.min((t-2.6)/1.15,1));z=lerp(3.1,1.85,peek);
    if(t>=4.0)slam(1);
    if(t>4.8){peek=1-ease(Math.min((t-4.8)/.5,1));z=lerp(3.1,1.85,peek);}
  }else if(t<8.5){
    const p=(t-5.3)/3.2;x=lerp(-6.25,6.25,ease(p));strength=Math.sin(Math.PI*p)*.8+.15;
  }else{
    x=6.25;room=6.25;peek=ease(Math.min((t-8.5)/1.15,1));z=lerp(3.1,1.85,peek);
    if(t>=9.9)slam(2);
  }
  hall.student.position.set(x,0,z);
  hall.student.rotation.y=peek>0?Math.PI:Math.PI/2;
  if(reducedMotion)idle(hall.student,t);else run(hall.student,t,strength);
  if(peek>0){
    hall.student.userData.torso.rotation.x=.22*peek;
    hall.student.userData.head.rotation.y=Math.sin(t*1.6)*.08;
    hall.student.userData.head.rotation.x=.04;
  }
  // Track at shoulder height, then look past the student through the doorway.
  const followPos=[x+2.65,2.3,7.1],followLook=[x,.95,2.25];
  const peekPos=[room+.82,2.48,4.0],peekLook=[room,1.1,-2.8];
  positionCamera(followPos.map((v,i)=>lerp(v,peekPos[i],peek)),followLook.map((v,i)=>lerp(v,peekLook[i],peek)));
}
function updatePhone(){
  if(!phone.root.visible)return;
  if(current===3){
    const lift=reducedMotion?1:ease(Math.min(elapsed/1400,1));
    phone.root.position.copy(initialPhonePosition);phone.root.position.y=lerp(1.08,1.18,lift);
    // CSS screens have no depth buffer: don't reveal the app through the closed door.
    const shown=reducedMotion||elapsed>=3950;
    if(screenElement.classList.contains('visible')!==shown){
      screenElement.classList.toggle('visible',shown);screenElement.inert=!shown;screenElement.setAttribute('aria-hidden',String(!shown));
    }
  }else if(current===4){
    const p=reducedMotion?1:ease(Math.min(elapsed/durations[4],1));
    phone.root.position.copy(initialPhonePosition).lerp(finalPhonePosition,p);
    phone.root.scale.setScalar(lerp(1,finalPhoneScale,p));
    phone.root.rotation.set(lerp(-1.22,0,p),lerp(-.08,0,p),lerp(-.1,0,p));
    bathroom.root.position.y=-8*p*p;bathroom.root.visible=p<.85;
    const ready=p>=1;
    screenElement.classList.toggle('interactive',ready);phoneCover.hidden=ready;
    if(stage.dataset.interactive!==String(ready)){stage.dataset.interactive=String(ready);forceDraw=true;}
  }
  cssPhone.position.copy(phone.root.position);cssPhone.quaternion.copy(phone.root.quaternion);cssPhone.scale.copy(phone.root.scale);
}
function resize(){
  renderer.setSize(innerWidth,innerHeight);cssRenderer.setSize(innerWidth,innerHeight);
  camera.aspect=innerWidth/innerHeight;camera.fov=innerWidth<700?43:34;camera.updateProjectionMatrix();forceDraw=true;renderer.shadowMap.needsUpdate=true;
}
function render(now){
  const rawDelta=now-last;
  const delta=Math.min(rawDelta,100);last=now;
  // Reduce resolution further on a consistently slow device, once per opening.
  if(current===2&&rawDelta>0&&rawDelta<180){
    frameTotal+=rawDelta;frameSamples++;
    if(frameSamples===90&&frameTotal/frameSamples>28&&!lowQuality){renderer.setPixelRatio(1);forceDraw=true;}
  }
  if(!paused){elapsed+=delta;transition+=delta;}
  if(current===0)exteriorMotion();
  else if(current===2)searchMotion();
  else if(current===1)idle(hall.student,now*.001);
  else if(current===3){droneMotion();idle(bathroom.student,now*.001);bathroom.student.userData.head.rotation.x=.15;}
  else if(current===5){idle(study.student,now*.001);study.student.userData.head.rotation.x=.15;}
  if(current===0&&exteriorStarted&&elapsed>=durations[0])go(1);
  else if(autoplay&&current>0&&current<4&&elapsed>=durations[current])go(current+1);
  if(current===4&&elapsed>=durations[4])autoplay=false;
  const t=reducedMotion?1:ease(Math.min(transition/(current===4?durations[4]:1250),1));
  if(current===0||current===3){
    camera.position.copy(cameraTo);look.copy(lookTo);
  }else if(current===2&&transition>=1250&&!reducedMotion){
    const follow=1-Math.exp(-delta*.006);
    camera.position.lerp(cameraTo,follow);look.lerp(lookTo,follow);
  }else{
    camera.position.copy(cameraFrom).lerp(cameraTo,t);look.copy(lookFrom).lerp(lookTo,t);
  }
  // Preserve the phone's physical size on narrow rehearsal screens.
  camera.lookAt(look);
  const impactAge=(elapsed-impactTime)/1000;
  if(current===2&&impactAge>=0&&impactAge<.24&&!reducedMotion)camera.rotateZ(Math.sin(impactAge*65)*.022*Math.exp(-impactAge*14));
  updatePhone();
  const settledPhone=current===4&&elapsed>=durations[4];
  const settledSearch=current===2&&elapsed>=durations[2];
  const animated=!paused&&(current===1||current===5||(!settledPhone&&!settledSearch));
  // Once the phone is still, the GPU yields to the live map instead of redrawing a static device.
  if(forceDraw||(animated&&now-lastDraw>=1000/45)){
    renderer.shadowMap.needsUpdate=forceDraw||(current===2&&!settledSearch)||(current===4&&!settledPhone)||(current===3&&elapsed<1500);
    renderer.render(scene,camera);cssRenderer.render(cssScene,camera);lastDraw=now;forceDraw=false;
    stage.dataset.drawCalls=String(renderer.info.render.calls);
  }
  requestAnimationFrame(render);
}
function phoneClicked(event){
  const rect=canvas.getBoundingClientRect();pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
  raycaster.setFromCamera(pointer,camera);
  return phone.root.visible&&raycaster.intersectObject(phone.root,true).length>0;
}
canvas.addEventListener('pointerdown',event=>{score.unlock();clickDown=[event.clientX,event.clientY];});
canvas.addEventListener('pointerup',event=>{
  if(!clickDown||Math.hypot(event.clientX-clickDown[0],event.clientY-clickDown[1])>10)return;
  clickDown=null;autoplay=false;
  if(current===3&&phoneClicked(event)){go(4);return;}
  if(current===4&&elapsed<durations[4])return;
  advance();
});
phoneCover.addEventListener('click',()=>{score.unlock();autoplay=false;go(4);});
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{ /* A browser preview may restrict full screen. */ }}
window.addEventListener('keydown',event=>{
  if(event.target.closest('input,textarea,[contenteditable=true]'))return;
  const key=event.key.toLowerCase();
  if([' ','arrowright','arrowleft','1','2','3','4','5','6','s'].includes(key))score.unlock();
  if([' ','arrowright','arrowleft','home','escape','f','r','s','1','2','3','4','5','6'].includes(key))event.preventDefault();
  if(key==='arrowright'){autoplay=false;advance();}
  else if(key==='arrowleft'){autoplay=false;go(current-1);}
  else if(key==='home'||key==='r'){autoplay=false;go(0);}
  else if(key==='escape'){if(current===4)go(5);else{autoplay=false;paused=true;score.stop();}}
  else if(key===' '){
    if(current===4){go(5);return;}
    if(autoplay){autoplay=false;paused=true;score.stop();}else{autoplay=true;paused=false;if(current===5)go(0);if(current===0)startExterior();}
  }else if(key==='f')void fullscreen();
  else if(key==='s'){score.toggle();}
  else if(/^[1-6]$/.test(key)){autoplay=false;go(Number(key)-1);}
});
window.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden){paused=true;score.stop();}else{paused=current===0&&!exteriorStarted;forceDraw=true;if(current===2&&elapsed<durations[2])score.start();}});
camera.position.set(22,14,24);look.set(0,1,0);camera.lookAt(look);cameraFrom.copy(camera.position);lookFrom.copy(look);
// Mount the map before warming the 3D shaders, without showing extra interface.
cssPhone.position.set(0,-60,0);cssRenderer.render(cssScene,camera);
sets.forEach(root=>{root.visible=true;});phone.root.visible=true;
try{await renderer.compileAsync(scene,camera);}catch{renderer.compile(scene,camera);}
go(0);resize();renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);cssRenderer.render(cssScene,camera);
document.getElementById('curtain').classList.add('ready');last=performance.now();requestAnimationFrame(render);
