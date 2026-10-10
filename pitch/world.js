import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const materials = new Map();
const geometries = new Map();
export function material(color, options = {}) {
  const key = color + JSON.stringify(options);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({color, roughness:.7, flatShading:true, ...options}));
  return materials.get(key);
}
export function group(parent, at=[0,0,0]) {const g=new THREE.Group();g.position.set(...at);parent.add(g);return g;}
export function mesh(parent, geometry, mat, at=[0,0,0], rotate=[0,0,0]) {
  const m=new THREE.Mesh(geometry, typeof mat==='string'?material(mat):mat);m.position.set(...at);m.rotation.set(...rotate);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
export function box(parent,size,at,color,rotate) {
  const key='box'+size.join(',');if(!geometries.has(key))geometries.set(key,new THREE.BoxGeometry(...size));
  return mesh(parent,geometries.get(key),color,at,rotate);
}
export function cylinder(parent,top,bottom,height,at,color,segments=10) {return mesh(parent,new THREE.CylinderGeometry(top,bottom,height,segments),color,at);}
export function roundedShape(width,height,radius) {
  const s=new THREE.Shape(),x=-width/2,y=-height/2,r=radius;
  s.moveTo(x+r,y);s.lineTo(x+width-r,y);s.quadraticCurveTo(x+width,y,x+width,y+r);
  s.lineTo(x+width,y+height-r);s.quadraticCurveTo(x+width,y+height,x+width-r,y+height);
  s.lineTo(x+r,y+height);s.quadraticCurveTo(x,y+height,x,y+height-r);
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;
}
export function roundedBox(parent,size,at,color,r=.05,details=4) {
  const key=`round${size.join(',')},${r},${details}`;
  if(!geometries.has(key)){
    const geo=new THREE.ExtrudeGeometry(roundedShape(size[0]-r,size[1]-r,r),{depth:size[2]-r,bevelEnabled:true,bevelSegments:details>4?4:2,steps:1,bevelSize:r/2,bevelThickness:r/2,curveSegments:details});
    geo.translate(0,0,-(size[2]-r)/2);geometries.set(key,geo);
  }
  return mesh(parent,geometries.get(key),color,at);
}
export function label(parent,text,at,width=1.4,height=.33){
  const c=document.createElement('canvas');c.width=768;c.height=160;
  const ctx=c.getContext('2d');ctx.fillStyle='#e9e7dd';ctx.fillRect(0,0,768,160);
  ctx.fillStyle='#3d4844';ctx.font='500 64px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,384,80);
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
  mesh(parent,new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map}),at);
}
export function backpack(parent,at,color='#c6774c'){
  const b=group(parent,at);roundedBox(b,[.44,.59,.3],[0,.28,0],color,.08);
  roundedBox(b,[.33,.22,.09],[0,.18,.16],'#af613e',.04);
  box(b,[.17,.025,.1],[0,.6,0],'#725142');
  for(const x of [-.12,.12])box(b,[.035,.48,.04],[x,.31,-.16],'#6d5c49');return b;
}
function limb(parent,at,color,length=.43){
  const l=group(parent,at);const upper=roundedBox(l,[.18,length,.19],[0,-length/2,0],color,.025);
  return {pivot:l,upper};
}
export function person(parent,at,{color='#859678',skin='#d0a486',seated=false,bag=false,rotation=0}={}){
  const p=group(parent,at);p.rotation.y=rotation;
  const hips=group(p,[0,seated?.66:.84,0]);
  const torso=group(hips,[0,.3,0]);
  const hoodie=mesh(torso,new THREE.CylinderGeometry(.25,.31,.59,6),color,[0,0,0]);hoodie.scale.z=.72;
  roundedBox(torso,[.25,.18,.05],[0,-.1,.23],color,.025);
  box(torso,[.012,.31,.02],[0,.075,.222],'#b7c3a0');
  const neck=cylinder(torso,.085,.09,.14,[0,.35,0],skin,8);
  const head=group(torso,[0,.59,0]);
  const face=mesh(head,new THREE.SphereGeometry(.28,8,6),skin);face.scale.set(.88,1.05,.88);
  const hair=mesh(head,new THREE.SphereGeometry(.287,8,4,0,Math.PI*2,0,Math.PI*.53),'#3d302c',[0,.075,-.025]);hair.scale.set(.95,.84,.93);
  mesh(head,new THREE.ConeGeometry(.13,.15,4),'#3d302c',[-.16,.2,.14],[0,0,-.4]);
  for(const x of [-.09,.09]){
    box(head,[.034,.028,.035],[x,.015,.248],'#2d3436');
    box(head,[.08,.018,.03],[x,.078,.236],'#3d302c');
  }
  box(head,[.085,.012,.025],[0,-.105,.24],'#986b57');
  const arms=[];
  for(const side of [-1,1]){
    const arm=limb(torso,[side*.31,.24,0],color,.37);
    const elbow=group(arm.pivot,[0,-.37,0]);
    roundedBox(elbow,[.14,.25,.15],[0,-.11,0],color,.025);
    const hand=roundedBox(elbow,[.13,.15,.14],[0,-.285,0],skin,.025);
    if(seated){arm.pivot.rotation.x=-.7;elbow.rotation.x=-.7;}
    arms.push({shoulder:arm.pivot,elbow,hand});
  }
  const legs=[];
  for(const side of [-1,1]){
    const thigh=limb(hips,[side*.15,-.1,0],'#424c50',.36);
    const knee=group(thigh.pivot,[0,-.36,0]);
    roundedBox(knee,[.17,seated?.51:.36,.18],[0,seated?-.255:-.18,0],'#424c50',.025);
    roundedBox(knee,[.21,.12,.35],[0,seated?-.535:-.39,.07],'#deded4',.035);
    if(seated){thigh.pivot.rotation.x=-Math.PI/2;knee.rotation.x=Math.PI/2;}
    legs.push({hip:thigh.pivot,knee});
  }
  if(bag)backpack(torso,[0,-.2,-.33]);
  p.userData={hips,torso,head,arms,legs,seated};return p;
}
function chair(parent,x,z,rotation=0){
  const c=group(parent,[x,0,z]);c.rotation.y=rotation;
  roundedBox(c,[.65,.12,.66],[0,.58,0],'#859489',.06);
  roundedBox(c,[.62,.58,.095],[0,.93,-.28],'#859489',.045);
  for(const a of [-.22,.22])for(const b of [-.23,.23])box(c,[.045,.55,.045],[a,.27,b],'#717a76');
}
function laptop(parent,x,y,z,rotation=0){
  const l=group(parent,[x,y,z]);l.rotation.y=rotation;
  roundedBox(l,[.68,.025,.43],[0,.02,0],'#a9b0ad',.02);
  const lid=roundedBox(l,[.68,.43,.025],[0,.24,-.2],'#a9b0ad',.02);lid.rotation.x=-.15;
  const screen=box(l,[.61,.35,.009],[0,.24,-.176],material('#d2d9cf',{emissive:'#b9c7bb',emissiveIntensity:.12}));screen.rotation.x=-.15;
  for(let i=0;i<3;i++)box(l,[.3-i*.04,.009,.007],[-.07,.32-i*.06,-.151],'#7c988a');return l;
}
function plant(parent,at){
  cylinder(parent,.27,.22,.43,[at[0],.22,at[2]],'#c8b49d');
  for(let i=0;i<7;i++){
    const a=i*2.4;
    const leaf=mesh(parent,new THREE.ConeGeometry(.16,.76,5),'#7e9279',[at[0]+Math.sin(a)*.17,.8+(i%3)*.1,at[2]+Math.cos(a)*.17]);leaf.rotation.z=Math.sin(a)*.3;
  }
}
function desk(parent,x,z,{empty=false,bags=false}={}){
  roundedBox(parent,[2.8,.12,1.15],[x,1.04,z],'#d4c5ad',.04);
  for(const dx of [-1.1,1.1])for(const dz of [-.4,.4])box(parent,[.065,1,.065],[x+dx,.5,z+dz],'#9eaaa3');
  for(const dx of [-.65,.65]){
    chair(parent,x+dx,z+.97,Math.PI);
    if(!empty){
      if(bags&&dx>0)backpack(parent,[x+dx,.65,z+.95]);
      else person(parent,[x+dx,0,z+.97],{seated:true,rotation:Math.PI,color:['#a5a593','#94a5a4','#b59889'][Math.abs(Math.round(x*2+dx))%3]});
    }
    laptop(parent,x+dx,1.12,z,Math.PI);
    cylinder(parent,.055,.055,.19,[x+dx+.4,1.22,z+.15],'#c6ad8e');
  }
}
export function buildHall(scene){
  const hall=group(scene);
  box(hall,[25,.25,12],[0,-.17,-1],'#d6d5c9');
  box(hall,[25,.11,.18],[0,-.04,5.0],'#dad8ce');
  // Cutaway of two study rooms opening onto the same corridor.
  box(hall,[25,4.1,.17],[0,2,-6.9],'#c9cec6');
  box(hall,[.17,4.1,8.4],[-12.5,2,-2.8],'#c9cec6');
  box(hall,[.17,4.1,8.4],[0,2,-2.8],'#c9cec6');
  for(const cx of [-6.25,6.25]){
    for(const off of [-3.6,0,3.6]){
      box(hall,[2.8,2.5,.06],[cx+off,2.4,-6.78],material('#e6e8df',{emissive:'#e4e7db',emissiveIntensity:.16}));
      box(hall,[.05,2.6,.08],[cx+off,2.4,-6.73],'#a8b2a7');
      box(hall,[2.85,.05,.08],[cx+off,2.4,-6.72],'#a8b2a7');
    }
    for(const dx of [-3,3])for(const z of [-4.5,-1.2])desk(hall,cx+dx,z,{bags:cx>0&&z>-2});
    // Door posts suggest the room boundary without blocking the student.
    for(const dx of [-1.15,1.15])box(hall,[.12,3.4,.16],[cx+dx,1.65,1.3],'#a6b0a8');
    box(hall,[2.42,.12,.16],[cx,3.4,1.3],'#a6b0a8');
    label(hall,cx<0?'HG E 51':'HG E 52',[cx,3.1,1.41],1.25,.28);
    plant(hall,[cx+4.8,0,.5]);
    for(const x of [cx-3,cx+3]){
      cylinder(hall,.008,.008,.7,[x,4,-2.9],'#a9aaa2',6);
      cylinder(hall,.24,.4,.13,[x,3.57,-2.9],'#dddcd0');
    }
  }
  for(let x=-12;x<=12;x+=2)box(hall,[.018,.005,12],[x,-.025,-1],'#c7c9bf');
  box(hall,[25,.006,.035],[0,-.023,1.8],'#c7c9bf');
  const student=person(hall,[-10.9,0,3.1],{bag:true,color:'#859678',rotation:Math.PI/2});
  return {root:hall,student};
}
export function buildBathroom(scene){
  const root=group(scene);
  // A real-sized, closed stall seen through its open roof.
  box(root,[1.95,.18,2.65],[0,-.12,-.6],'#d9d7ca');
  for(let x=-.8;x<1;x+=.4)for(let z=-1.75;z<.7;z+=.4)box(root,[.389,.006,.389],[x,-.025,z],'#e6e2d7');
  box(root,[1.95,2.2,.075],[0,1.1,-1.925],'#bcc7bd');
  for(const x of [-.975,.975]){
    box(root,[.075,2.2,2.65],[x,1.1,-.6],'#bec9bf');
    box(root,[.085,.05,2.65],[x,2.21,-.6],'#9fac9e');
  }
  // Front door, jamb and latch. The overhead camera sees into the enclosure.
  roundedBox(root,[1.78,1.88,.055],[0,1.28,.725],'#c6cfc2',.025);
  box(root,[.05,2.24,.085],[-.93,1.12,.725],'#9fac9e');
  box(root,[.05,2.24,.085],[.93,1.12,.725],'#9fac9e');
  box(root,[.13,.045,.06],[.65,1.22,.765],'#7c8981');
  const t=group(root,[0,0,-1]);
  roundedBox(t,[.73,1.0,.31],[0,.64,-.45],'#e7e8df',.08);
  cylinder(t,.3,.23,.58,[0,.32,.01],'#e7e8df',12);
  const bowl=mesh(t,new THREE.SphereGeometry(.4,12,7),'#f0f0e8',[0,.65,.12]);bowl.scale.set(1,.45,1.22);
  const seat=mesh(t,new THREE.TorusGeometry(.3,.055,5,16),'#d1d7cd',[0,.74,.12],[Math.PI/2,0,0]);seat.scale.y=1.2;
  box(t,[.13,.035,.045],[.2,1.15,-.28],'#aab4ae');
  const student=person(root,[0,.005,-.8],{seated:true,color:'#859678'});
  backpack(root,[-.66,0,-.42]);
  box(root,[.06,.04,.1],[-.92,1.1,-.65],'#99a79c');
  const roll=cylinder(root,.1,.1,.17,[-.82,1.1,-.65],'#ecece1',12);roll.rotation.z=Math.PI/2;
  return {root,student};
}
export function buildStudy(scene){
  const root=group(scene);
  box(root,[8,.22,6],[0,-.15,-.5],'#d8c8b0');
  box(root,[8,4,.12],[0,1.96,-3.5],'#d5c8b4');
  box(root,[5.8,2.7,.045],[-.3,2.3,-3.405],material('#f3e0b9',{emissive:'#efce96',emissiveIntensity:.15}));
  for(const x of [-3.1,-.3,2.5])box(root,[.065,2.85,.08],[x,2.3,-3.37],'#b8a183');
  box(root,[5.8,.065,.08],[-.3,2.3,-3.37],'#b8a183');
  // Abstract roof line seen through the window.
  for(let i=0;i<9;i++)box(root,[.51,.4+(i%4)*.13,.03],[-2.7+i*.58,1.2,-3.365],'#d9bd95');
  desk(root,0,0,{empty:true});
  const student=person(root,[0,0,.97],{seated:true,color:'#859678',rotation:Math.PI});
  for(const x of [-.25,.25])roundedBox(student.userData.head,[.09,.22,.19],[x,.02,0],'#48584e',.025);
  mesh(student.userData.head,new THREE.TorusGeometry(.27,.024,4,12,Math.PI),'#48584e',[0,.04,0]);
  plant(root,[2.8,0,-2]);backpack(root,[.95,0,1.1]);
  const lamp=group(root,[-1,1.13,-.3]);cylinder(lamp,.14,.18,.025,[0,0,0],'#86957b');
  cylinder(lamp,.012,.012,.58,[0,.29,0],'#86957b',8);cylinder(lamp,.08,.23,.18,[0,.64,0],'#9faa89');
  return {root,student};
}
export function buildPhone(scene){
  const root=group(scene);
  const metal=material('#4a4e4d',{roughness:.3,metalness:.8,flatShading:false});
  roundedBox(root,[.449,.929,.057],[0,0,0],metal,.055,16);
  roundedBox(root,[.432,.915,.059],[0,0,.002],material('#141715',{roughness:.3,flatShading:false}),.047,16);
  const screen=mesh(root,new THREE.ShapeGeometry(roundedShape(.392,.848,.033)),material('#070a09',{roughness:.12,flatShading:false}),[0,0,.034]);
  box(root,[.011,.13,.028],[-.226,.13,0],metal);box(root,[.011,.07,.028],[-.226,.24,0],metal);
  box(root,[.011,.12,.028],[.226,.16,0],metal);
  return {root,screen};
}
export function run(person,time,strength=1){
  const rig=person.userData;
  const phase=time*12;
  rig.hips.position.y=.84+Math.abs(Math.sin(phase))*.065*strength;
  rig.torso.rotation.x=.12*strength;rig.torso.rotation.z=Math.sin(phase)*.035*strength;
  rig.legs.forEach((leg,i)=>{const swing=Math.sin(phase+i*Math.PI);leg.hip.rotation.x=swing*.7*strength;leg.knee.rotation.x=Math.max(0,-swing)*.85*strength;});
  rig.arms.forEach((arm,i)=>{arm.shoulder.rotation.x=-Math.sin(phase+i*Math.PI)*.65*strength;arm.elbow.rotation.x=-.7*strength;});
}
export function idle(person,time){
  const rig=person.userData;
  if(!rig.seated)run(person,time,0);
  rig.torso.rotation.z=Math.sin(time*1.7)*.008;
  rig.head.rotation.y=Math.sin(time*.8)*.055;
}

// Merge immobile props by material. The lead student's articulated rig stays separate.
export function batchStatic(root, animated){
  root.updateMatrixWorld(true);
  const inverse=new THREE.Matrix4().copy(root.matrixWorld).invert();
  const batches=new Map(),remove=[];
  root.traverse(object=>{
    if(!object.isMesh)return;
    for(let ancestor=object;ancestor;ancestor=ancestor.parent)if(ancestor===animated)return;
    if(Array.isArray(object.material))return;
    const key=object.material.uuid;
    if(!batches.has(key))batches.set(key,{material:object.material,geometries:[]});
    const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone();
    const transform=new THREE.Matrix4().multiplyMatrices(inverse,object.matrixWorld);
    geometry.applyMatrix4(transform);batches.get(key).geometries.push(geometry);remove.push(object);
  });
  for(const object of remove)object.removeFromParent();
  for(const batch of batches.values()){
    const merged=mergeGeometries(batch.geometries,false);
    if(!merged)throw new Error('Could not batch presentation scenery');
    merged.computeBoundingSphere();
    mesh(root,merged,batch.material);
    for(const geometry of batch.geometries)geometry.dispose();
  }
}
