import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHall, buildBathroom, buildPhone, idle, run, defeated, resetExpression, batchStatic } from './world.js';

import { Score } from './music.js';
import { buildHG } from './architecture.js';
import { buildClosing, buildSlides } from './closing.js';

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

const hall=buildHall(scene),bathroom=buildBathroom(scene),phone=buildPhone(scene);
const exterior=buildHG(scene);
const closing=await buildClosing(scene,exterior.root),slides=buildSlides();
const sets=[exterior.root,hall.root,bathroom.root,closing.features.root,closing.friends,closing.friendTable.root,closing.campus,closing.campusMap,closing.adoption.root];
batchStatic(hall.root,hall.student);batchStatic(bathroom.root,bathroom.student);
const cssScene=new THREE.Scene();
const cssRenderer=new CSS3DRenderer({element:document.getElementById('screens')});cssRenderer.setSize(innerWidth,innerHeight);
// Focus inside a transformed iframe must not scroll the phone away from its 3D frame.
cssRenderer.domElement.style.overflow='clip';
const screenElement=document.createElement('div');screenElement.className='phone-screen';
const appFrame=document.createElement('iframe');appFrame.title='Study Spaces live booking app';appFrame.allow='camera';
const requestedApp=new URLSearchParams(location.search).get('app');
let appUrl='http://localhost:5173/';
if(requestedApp){try{const url=new URL(requestedApp);if(['http:','https:'].includes(url.protocol)){url.pathname=url.pathname.replace(/\/map\/?$/,'/');appUrl=url.href;}}catch{ /* Keep the local app if the URL is malformed. */ }}
appFrame.src=appUrl;screenElement.append(appFrame);
appFrame.addEventListener('load',()=>{stage.dataset.appLoaded='true';});
const island=document.createElement('div');island.className='island';island.setAttribute('aria-hidden','true');screenElement.append(island);
const phoneCover=document.createElement('button');phoneCover.className='phone-cover';phoneCover.setAttribute('aria-label','Open the phone to reserve a study seat');screenElement.append(phoneCover);
const cssPhone=new THREE.Group();cssScene.add(cssPhone);
const cssScreen=new CSS3DObject(screenElement);cssScreen.scale.setScalar(.001);cssScreen.position.set(0,0,.036);cssPhone.add(cssScreen);

const names=['ETH main building','The student enters the hall','Looking for an available study seat','The student gives up','Book a seat from the toilet','Live booking on the phone','Live teammate check-in','Your session','Study together','Built for ETH','One library, entire ETH, other universities','Q&A at a happy ETH campus'];
const featureNames=['QR check-in starts your session','Session limits and priority to extend','Handovers','Timed breaks'];
// The opening is one film. The toilet and real app are deliberate presenter holds.
const durations=[6200,1200,11700,3600,5200,1050,0];
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
const cameraFrom=new THREE.Vector3(),lookFrom=new THREE.Vector3(),cameraTo=new THREE.Vector3(),lookTo=new THREE.Vector3();
const look=new THREE.Vector3(0,1,-1);
const handheldPosition=new THREE.Vector3(.29,1.28,-.27);
const handheldRotation=new THREE.Vector3(-1.18,-.08,-.12);
const handheldScale=.38;
const zoomStartPosition=new THREE.Vector3(),zoomStartRotation=new THREE.Vector3();
const flyCurve=new THREE.CatmullRomCurve3([
  new THREE.Vector3(22,14,24),new THREE.Vector3(17,9,16),new THREE.Vector3(12,5,6),
  new THREE.Vector3(exterior.entry.x+4.8,2.1,exterior.entry.z+1),
  new THREE.Vector3(exterior.entry.x+.48,1.24,exterior.entry.z),
]);
const droneCurve=new THREE.CatmullRomCurve3([
  new THREE.Vector3(0,.13,1.55),new THREE.Vector3(0,1.2,1.6),new THREE.Vector3(0,2.7,1.4),
  new THREE.Vector3(0,4.0,.8),new THREE.Vector3(.08,4.8,.3),
]);
const curvePoint=new THREE.Vector3();
const finalPhonePosition=new THREE.Vector3(0,2.5,0);
const finalPhoneScale=4.65;
let current=0,elapsed=0,last=performance.now(),transition=0,filmPlaying=false,paused=true,exteriorStarted=false,cut=null;
let featureStep=0;
let rolloutStep=0;
let qaExpanded=false;
const qaPhonePosition=new THREE.Vector3();
let clickDown=null,impactTime=-1000,lastDraw=0,forceDraw=true,frameSamples=0,frameTotal=0,resumeAfterVisibility=false;
const impacts=new Set();
const taken=document.getElementById('taken'),blackout=document.getElementById('blackout'),liveLayer=document.getElementById('live');
const advanceButton=document.getElementById('advance');
let liveFrame=null;
const requestedLive=new URLSearchParams(location.search).get('live');
if(requestedLive){try{
  const url=new URL(requestedLive);
  if(['http:','https:'].includes(url.protocol)){
    liveFrame=document.createElement('iframe');liveFrame.title='Live teammate walking to the reserved seat';
    // Keep the source connected off-screen before the handoff.
    liveFrame.src=url.href;liveFrame.allow='autoplay; fullscreen';liveLayer.append(liveFrame);
    liveLayer.hidden=false;liveLayer.style.transform='translateY(110vh)';
  }
}catch{ /* Without a stream URL, the handoff holds on black for the video operator. */ }}

function ease(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function lerp(a,b,t){return a+(b-a)*t;}
function captureCamera(){cameraFrom.copy(camera.position);lookFrom.copy(look);transition=0;}
function positionCamera(pos,target){cameraTo.set(...pos);lookTo.set(...target);}
function snapCamera(){camera.position.copy(cameraTo);look.copy(lookTo);cameraFrom.copy(cameraTo);lookFrom.copy(lookTo);}
function updateAccessibleState(){
  stage.dataset.scene=String(current+1);stage.dataset.interactive=String((current===5&&elapsed>=durations[5])||(current===11&&!cut));
  stage.dataset.playing=String(filmPlaying&&!paused);stage.dataset.liveSource=liveFrame?'browser':'external';
  canvas.setAttribute('aria-label',current===0?'Play opening film':current===4?'Open the phone to reserve a seat':current===5?'Start live teammate handoff':current===11?'Happy ETH campus':current>=7?'Pitch slide':'Opening film playing');
  advanceButton.hidden=current<6||current===11;
  advanceButton.setAttribute('aria-label',current===6?'Continue to pitch slides':'Next pitch slide');
  stage.dataset.slide=current>=7?String(current-6):'0';
  stage.dataset.feature=current===7?String(featureStep+1):'0';
  stage.dataset.rollout=current===10?String(rolloutStep+1):'0';
  document.getElementById('status').textContent=current===7?featureNames[featureStep]:names[current];
}
function slam(id){
  if(impacts.has(id))return;
  impacts.add(id);impactTime=elapsed;taken.classList.remove('slam');
  void taken.offsetWidth;taken.classList.add('slam');score.impact();stage.dataset.peek=String(id);
}
function go(index,snap=false){
  if(index===7)featureStep=current===8?3:0;
  if(index===10)rolloutStep=current===11?2:0;
  if(index===5){zoomStartPosition.copy(phone.root.position);zoomStartRotation.set(phone.root.rotation.x,phone.root.rotation.y,phone.root.rotation.z);}
  captureCamera();current=Math.max(0,Math.min(11,index));elapsed=0;paused=false;impacts.clear();impactTime=-1000;
  // Start each live segment on Home; saved bookings are restored by the app.
  if(current===4||current===11)appFrame.src=appUrl;
  taken.classList.remove('slam');delete stage.dataset.peek;forceDraw=true;renderer.shadowMap.needsUpdate=true;
  delete stage.dataset.holding;
  sets.forEach(root=>{root.visible=false;root.position.set(0,0,0);root.scale.setScalar(1);});
  exterior.root.visible=current===0;hall.root.visible=current>=1&&current<=3;
  closing.campusMap.visible=current===9;closing.adoption.root.visible=current===10;
  if(current===10){closing.adoption.show(rolloutStep);slides.revealRollout(rolloutStep);}
  closing.friends.visible=current===8;closing.campus.visible=current===11;
  closing.friendTable.root.visible=current===8;
  closing.features.root.visible=current===7;
  if(current===7){closing.features.show(featureStep);slides.revealFeature(featureStep);}
  slides.show(current>=7?current-7:-1);
  bathroom.root.visible=current===4||current===5;phone.root.visible=current===4||current===5||current===11;
  const showApp=current===5||current===11;
  screenElement.classList.toggle('visible',showApp);screenElement.inert=!showApp;
  screenElement.setAttribute('aria-hidden',String(!showApp));screenElement.classList.remove('interactive');phoneCover.hidden=current===11;
  screenElement.classList.toggle('qa-phone',current===11);
  phone.root.traverse(object=>{if(object.isMesh)object.castShadow=current!==11;});
  cssPhone.visible=true;if(!phone.root.visible){cssPhone.position.set(0,-60,0);cssPhone.scale.setScalar(1);}
  if(liveFrame){liveLayer.style.transform=current===6?'none':'translateY(110vh)';liveLayer.hidden=false;}
  else liveLayer.hidden=current!==6;
  if(current===6){filmPlaying=false;score.stop();blackout.style.opacity=liveFrame?'0':'1';}
  else blackout.style.opacity='0';
  if(current>=7)filmPlaying=false;
  scene.background.set(current===11?'#e6eddf':'#eeece6');
  key.color.set('#fff3df');fill.intensity=1.4;
  key.intensity=current===11?3.1:2.6;
  if(current>=3)score.stop();
  if(current===0){
    resetExpression(hall.student);exteriorStarted=false;filmPlaying=false;paused=true;score.stop();
    positionCamera([22,14,24],[0,1,0]);snapCamera();
  }else if(current===1){
    hallMotion();score.start();
  }else if(current===2){
    resetExpression(hall.student);positionCamera([-8.2,2.25,7],[-10.9,1.05,2.4]);score.start();
  }else if(current===3){
    hall.student.position.set(6.25,0,3.1);hall.student.rotation.y=0;
    defeated(hall.student,0);positionCamera([6.75,2.08,5.7],[6.25,1.4,3.1]);score.giveUp();
  }else if(current===4){
    filmPlaying=false;
    positionCamera(reducedMotion?[.08,4.8,.3]:[0,.13,1.55],reducedMotion?[0,.6,-.6]:[0,.10,-.32]);
    snapCamera();phone.root.position.copy(handheldPosition);phone.root.scale.setScalar(handheldScale);phone.root.rotation.set(...handheldRotation.toArray());
    bathroom.student.userData.arms[1].shoulder.rotation.set(-1.1,0,-.2);
    bathroom.student.userData.arms[1].elbow.rotation.x=-1.5;
  }else if(current===5){filmPlaying=false;positionCamera([0,2.5,8.1],[0,2.5,0]);}
  else if(current===7){positionCamera([0,3.1,9],[0,1.5,0]);}
  else if(current===8){closing.friends.position.x=2.4;closing.friendTable.root.position.set(-2.2,.1,0);positionCamera([0,2.65,9.1],[0,2.1,0]);}
  else if(current===9){positionCamera([0,2.65,9.1],[0,2.1,0]);}
  else if(current===10)rolloutCamera();
  else if(current===11){qaExpanded=false;positionCamera([24,17,28],[0,1,-4]);}
  fitClosingLayout();if(snap&&current!==5)snapCamera();updateAccessibleState();
}
function cutTo(index){if(cut)return;paused=false;cut={index,elapsed:0,switched:false};}
function updateCut(delta){
  if(!cut)return;
  cut.elapsed+=delta;
  const out=190,hold=100,inTime=230;
  if(cut.elapsed>=out&&!cut.switched){go(cut.index,true);cut.switched=true;}
  const opacity=cut.elapsed<out?cut.elapsed/out:cut.elapsed<out+hold?1:1-(cut.elapsed-out-hold)/inTime;
  blackout.style.opacity=String(Math.max(0,Math.min(1,opacity)));
  if(cut.elapsed>=out+hold+inTime){cut=null;blackout.style.opacity=current===6&&!liveFrame?'1':'0';if(current>=6&&current<11&&current!==8&&current!==10)paused=true;}
}
function startFilm(){
  filmPlaying=true;exteriorStarted=true;paused=false;elapsed=0;transition=0;score.start();forceDraw=true;updateAccessibleState();
}
function openPhone(){if(current!==4||elapsed<durations[4]||cut)return;go(5);}
function handoff(){if(current===5&&elapsed>=durations[5])cutTo(6);}
function showFeature(step){
  if(cut)return;
  featureStep=step;closing.features.show(step);slides.revealFeature(step);forceDraw=true;renderer.shadowMap.needsUpdate=true;updateAccessibleState();
}
function rolloutCamera(){
  const views=[[[3,8,17],[-3,1.7,0]],[[22,16,31],[0,6,0]],[[42,32,60],[0,9,-2]]];
  positionCamera(...views[rolloutStep]);
}
function showRollout(step){
  if(cut)return;
  captureCamera();rolloutStep=step;paused=false;
  closing.adoption.show(step);slides.revealRollout(step);rolloutCamera();
  forceDraw=true;renderer.shadowMap.needsUpdate=true;updateAccessibleState();
}
function nextSlide(){
  if(current===7&&featureStep<3){showFeature(featureStep+1);return;}
  if(current===10&&rolloutStep<2){showRollout(rolloutStep+1);return;}
  if(current>=6&&current<11)cutTo(current+1);
}
function previousSlide(){
  if(current===7&&featureStep>0){showFeature(featureStep-1);return;}
  if(current===10&&rolloutStep>0){showRollout(rolloutStep-1);return;}
  if(current>=7)cutTo(current-1);
}
function exteriorMotion(){
  if(!exteriorStarted)return;
  flyCurve.getPoint(reducedMotion?1:ease(Math.min(elapsed/durations[0],1)),curvePoint);cameraTo.copy(curvePoint);
  const aim=ease(Math.min(elapsed/4600,1));lookTo.set(lerp(0,exterior.entry.x,aim),lerp(1,exterior.entry.y,aim),lerp(0,exterior.entry.z,aim));
}
function droneMotion(){
  const p=reducedMotion?1:ease(Math.max(0,Math.min((elapsed-1000)/3900,1)));
  droneCurve.getPoint(p,curvePoint);cameraTo.copy(curvePoint);lookTo.set(0,lerp(.10,.6,p),lerp(-.32,-.6,p));
}
function hallMotion(){
  const t=Math.min(elapsed/durations[1],1),x=lerp(-12.5,-10.9,t);
  hall.student.position.set(x,0,3.1);hall.student.rotation.y=Math.PI/2;
  if(reducedMotion)idle(hall.student,elapsed*.001);else run(hall.student,elapsed*.001+.18,.85);
  positionCamera([x+2.7,2.25,7],[x,1.05,2.4]);
}
function searchMotion(){
  const t=elapsed/1000;
  let x=-10.9,z=3.1,strength=0,peek=0,room=-6.25;
  if(t<2.6){const p=Math.min(t/2.6,1);x=lerp(-10.9,-6.25,1-Math.pow(1-p,1.2));strength=.85*(1-ease(Math.max(0,(p-.7)/.3)));}
  else if(t<5.3){
    x=-6.25;peek=ease(Math.min((t-2.6)/1.15,1));z=lerp(3.1,1.85,peek);
    if(t>=4)slam(1);
    if(t>4.8){peek=1-ease(Math.min((t-4.8)/.5,1));z=lerp(3.1,1.85,peek);}
  }else if(t<8.5){const p=(t-5.3)/3.2;x=lerp(-6.25,6.25,ease(p));strength=Math.sin(Math.PI*p)*.8+.15;}
  else{x=6.25;room=6.25;peek=ease(Math.min((t-8.5)/1.15,1));z=lerp(3.1,1.85,peek);if(t>=9.9)slam(2);}
  hall.student.position.set(x,0,z);hall.student.rotation.y=peek>0?Math.PI:Math.PI/2;
  if(reducedMotion)idle(hall.student,t);else run(hall.student,t+durations[1]/1000+.18,strength);
  if(peek>0){hall.student.userData.torso.rotation.x=.22*peek;hall.student.userData.head.rotation.y=Math.sin(t*1.6)*.08;hall.student.userData.head.rotation.x=.04;}
  const followPos=[x+2.65,2.3,7.1],followLook=[x,.95,2.25];
  const peekPos=[room+.82,2.48,4],peekLook=[room,1.1,-2.8];
  positionCamera(followPos.map((v,i)=>lerp(v,peekPos[i],peek)),followLook.map((v,i)=>lerp(v,peekLook[i],peek)));
}
function updatePhone(){
  if(!phone.root.visible)return;
  if(current===4){
    const breath=reducedMotion?0:Math.sin(elapsed*.0017)*.004;
    phone.root.position.copy(handheldPosition);phone.root.position.y+=breath;
    phone.root.rotation.set(handheldRotation.x+breath,handheldRotation.y,handheldRotation.z);
    const shown=reducedMotion||elapsed>=3700;
    screenElement.classList.toggle('visible',shown);screenElement.inert=!shown;screenElement.setAttribute('aria-hidden',String(!shown));
    stage.dataset.holding=String(elapsed>=durations[4]);
  }else if(current===5){
    const p=reducedMotion?1:ease(Math.min(elapsed/durations[5],1));
    phone.root.position.copy(zoomStartPosition).lerp(finalPhonePosition,p);phone.root.scale.setScalar(lerp(handheldScale,finalPhoneScale,p));
    phone.root.rotation.set(lerp(zoomStartRotation.x,0,p),lerp(zoomStartRotation.y,0,p),lerp(zoomStartRotation.z,0,p));
    bathroom.root.position.y=-8*p*p;bathroom.root.visible=p<.85;
    const ready=p>=1;screenElement.classList.toggle('interactive',ready);phoneCover.hidden=ready;
    if(stage.dataset.interactive!==String(ready)){stage.dataset.interactive=String(ready);forceDraw=true;}
  }else if(current===11){
    // Place the existing live phone in camera space so it stays fixed in the corner.
    const depth=6,viewHeight=2*depth*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),viewWidth=viewHeight*camera.aspect;
    const heightPx=Math.min(innerHeight*(qaExpanded?.90:.68),qaExpanded?960:700);
    const scale=(heightPx/innerHeight)*viewHeight/.929;
    const height=.929*scale,width=.449*scale;
    const marginX=Math.max(24,innerWidth*.04)/innerWidth*viewWidth,marginY=Math.max(20,innerHeight*.04)/innerHeight*viewHeight;
    qaPhonePosition.set(qaExpanded?0:viewWidth/2-marginX-width/2,qaExpanded?0:viewHeight/2-marginY-height/2,-depth);
    qaPhonePosition.applyQuaternion(camera.quaternion).add(camera.position);
    phone.root.position.copy(qaPhonePosition);phone.root.quaternion.copy(camera.quaternion);phone.root.scale.setScalar(scale);
    const ready=!cut;screenElement.classList.toggle('interactive',ready);screenElement.inert=!ready;phoneCover.hidden=true;
    stage.dataset.interactive=String(ready);stage.dataset.qaPhone=qaExpanded?'expanded':'corner';
  }
  cssPhone.position.copy(phone.root.position);cssPhone.quaternion.copy(phone.root.quaternion);cssPhone.scale.copy(phone.root.scale);
}
function fitClosingLayout(){
  const width=2*9*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect;
  if(current===7){
    const scale=Math.min(1,width*.40/4.6);
    closing.features.root.scale.setScalar(scale);
    closing.features.root.position.set(width*.24-.60*scale,0,0);
  }else if(current===9){
    closing.campusMap.position.set(width*.24,0,0);
    closing.campusMap.scale.setScalar(Math.min(1,width*.40/2.0));
  }
}
function resize(){
  renderer.setSize(innerWidth,innerHeight);cssRenderer.setSize(innerWidth,innerHeight);
  camera.aspect=innerWidth/innerHeight;camera.fov=innerWidth<700?43:34;camera.updateProjectionMatrix();fitClosingLayout();forceDraw=true;renderer.shadowMap.needsUpdate=true;
}
function render(now){
  const rawDelta=now-last,delta=Math.min(rawDelta,100);last=now;
  if(current===2&&rawDelta>0&&rawDelta<180){frameTotal+=rawDelta;frameSamples++;if(frameSamples===90&&frameTotal/frameSamples>28&&!lowQuality){renderer.setPixelRatio(1);forceDraw=true;}}
  if(!paused){elapsed+=delta;transition+=delta;updateCut(delta);}
  if(current===0)exteriorMotion();
  else if(current===1)hallMotion();
  else if(current===2)searchMotion();
  else if(current===3)defeated(hall.student,elapsed*.001);
  else if(current===4){droneMotion();idle(bathroom.student,elapsed*.001);bathroom.student.userData.head.rotation.x=.15;}
  else if(current===8)closing.friendTable.animate(elapsed*.001,reducedMotion);
  else if(current===11){const p=reducedMotion?1:ease(Math.min(elapsed/9000,1));positionCamera([lerp(24,19,p),lerp(17,13,p),lerp(28,23,p)],[0,1,-4]);closing.animate(elapsed*.001,reducedMotion);}
  if(filmPlaying&&!paused&&current<4&&elapsed>=durations[current]){
    // Keep the hallway walk continuous; location changes pass through black.
    if(current===1)go(2);else cutTo(current+1);
  }
  const t=reducedMotion?1:ease(Math.min(transition/(current===5?durations[5]:current===10?1100:950),1));
  if(current===0||current===3||current===4||(current>=7&&current!==10)){camera.position.copy(cameraTo);look.copy(lookTo);}
  else if(current===2&&transition>=950&&!reducedMotion){const follow=1-Math.exp(-delta*.006);camera.position.lerp(cameraTo,follow);look.lerp(lookTo,follow);}
  else{camera.position.copy(cameraFrom).lerp(cameraTo,t);look.copy(lookFrom).lerp(lookTo,t);}
  camera.lookAt(look);
  const impactAge=(elapsed-impactTime)/1000;
  if(current===2&&impactAge>=0&&impactAge<.24&&!reducedMotion)camera.rotateZ(Math.sin(impactAge*65)*.022*Math.exp(-impactAge*14));
  updatePhone();
  const settledPhone=current===5&&elapsed>=durations[5];
  const animated=!paused&&current!==6&&!settledPhone&&(current<7||current===10&&transition<1150||((current===8||current===11)&&(!reducedMotion||elapsed<1000)));
  if(forceDraw||(animated&&now-lastDraw>=1000/(current===8||current===11?30:45))){
    renderer.shadowMap.needsUpdate=forceDraw||current===1||current===2||current===3||current===8||current===11||(current===5&&!settledPhone);
    renderer.render(scene,camera);cssRenderer.render(cssScene,camera);lastDraw=now;forceDraw=false;stage.dataset.drawCalls=String(renderer.info.render.calls);
  }
  requestAnimationFrame(render);
}
function phoneClicked(event){
  const rect=canvas.getBoundingClientRect();pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
  raycaster.setFromCamera(pointer,camera);return phone.root.visible&&raycaster.intersectObject(phone.root,true).length>0;
}
canvas.addEventListener('pointerdown',event=>{score.unlock();clickDown=[event.clientX,event.clientY];});
canvas.addEventListener('pointerup',event=>{
  if(!clickDown||Math.hypot(event.clientX-clickDown[0],event.clientY-clickDown[1])>10)return;
  clickDown=null;if(cut)return;
  if(current===0&&!exteriorStarted)startFilm();
  else if(current===4&&phoneClicked(event))openPhone();
  else if(current===5)handoff();
  else if(current===11){canvas.focus();if(phoneClicked(event)){qaExpanded=!qaExpanded;forceDraw=true;}}
});
phoneCover.addEventListener('click',()=>{score.unlock();openPhone();});
advanceButton.addEventListener('click',nextSlide);
for(const surface of [canvas,advanceButton])surface.addEventListener('contextmenu',event=>{
  if(current>=7){event.preventDefault();previousSlide();}
});
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{ /* A browser preview may restrict full screen. */ }}
window.addEventListener('keydown',event=>{
  if(event.target.closest('input,textarea,[contenteditable=true]'))return;
  const key=event.key.toLowerCase();
  if(![' ','arrowright','arrowleft','home','escape','f','r','s','l','p','e','d','1','2','3','4','5','6','7'].includes(key))return;
  event.preventDefault();score.unlock();
  if(key==='home'||key==='r'){cut=null;go(0);}
  else if(key==='f')void fullscreen();
  else if(key==='s')score.toggle();
  else if(key==='l')handoff();
  else if(key==='p'){if(current>=5)cutTo(7);}
  else if(key==='e'){if(current>=6)cutTo(11);}
  else if(key==='d'&&current===11){qaExpanded=!qaExpanded;forceDraw=true;}
  else if(key==='arrowright')nextSlide();
  else if(key==='arrowleft')previousSlide();
  else if(key==='escape'){paused=true;score.stop();updateAccessibleState();}
  else if(key===' '){
    if(current===0&&!exteriorStarted)startFilm();
    else if(current<4){paused=!paused;if(paused)score.stop();else if(current<3)score.start();updateAccessibleState();}
    else if(current===4)openPhone();else if(current===5)handoff();else nextSlide();
  }else if(/^[1-7]$/.test(key)){
    // Rehearsal jumps remain available, but the film requires no scene advances.
    cut=null;filmPlaying=false;go(Number(key)-1,true);
    if(current===5){zoomStartPosition.copy(handheldPosition);zoomStartRotation.copy(handheldRotation);}
  }
});
window.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{
  last=performance.now();
  if(document.hidden){resumeAfterVisibility=!paused;paused=true;score.stop();}
  else{paused=!resumeAfterVisibility;forceDraw=true;if(!paused&&current<3&&exteriorStarted)score.start();}
});
camera.position.set(22,14,24);look.set(0,1,0);camera.lookAt(look);cameraFrom.copy(camera.position);lookFrom.copy(look);
cssPhone.position.set(0,-60,0);cssRenderer.render(cssScene,camera);
sets.forEach(root=>{root.visible=true;});phone.root.visible=true;
try{await renderer.compileAsync(scene,camera);}catch{renderer.compile(scene,camera);}
go(0);resize();renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);cssRenderer.render(cssScene,camera);
document.getElementById('curtain').classList.add('ready');last=performance.now();requestAnimationFrame(render);
