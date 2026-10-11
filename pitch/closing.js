import * as THREE from 'three';
import { group, box, mesh, cylinder, roundedBox, roundedShape, person, chair, laptop, backpack, buildPhone, idle, run, batchStatic } from './world.js';
import plannerUrl from './assets/party-planner.jpg';
import qrUrl from './assets/seat-qr.svg';
import campusMapUrl from './assets/campus-map-phone.jpg';
import scannerUrl from './assets/session-scanner.jpg';
import adminUrl from './assets/admin-room-setup.jpg';
import priorityUrl from './assets/session-priority.jpg';
import handoverUrl from './assets/session-handover.jpg';
import breakUrl from './assets/session-break.jpg';

function staticPhone(parent,texture){
  const phone=buildPhone(parent);
  const geometry=new THREE.ShapeGeometry(roundedShape(.392,.810,.028));
  const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++)uv.setXY(i,(positions.getX(i)+.196)/.392,(positions.getY(i)+.405)/.810);
  mesh(phone.root,geometry,new THREE.MeshBasicMaterial({map:texture,toneMapped:false}),[0,-.017,.038]);
  roundedBox(phone.root,[.108,.023,.012],[0,.405,.043],'#050706',.008,12);
  return phone.root;
}

function adminLaptop(parent,texture){
  const root=group(parent),body=group(root);
  body.rotation.set(.28,.10,0);
  roundedBox(body,[3.8,.10,1.65],[0,-1.17,.68],'#a9b0ad',.06);
  const lid=group(body,[0,-1.10,-.10]);lid.rotation.x=-.08;
  roundedBox(lid,[3.8,2.42,.10],[0,1.21,0],'#a9b0ad',.06);
  roundedBox(lid,[3.57,2.20,.015],[0,1.22,.061],'#101010',.025);
  // Fit the entire admin capture inside the display without stretching or cropping.
  const screenHeight=2.12,screenWidth=screenHeight*texture.image.width/texture.image.height;
  const display=mesh(lid,new THREE.PlaneGeometry(screenWidth,screenHeight),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}),[0,1.22,.073]);
  display.castShadow=false;
  cylinder(lid,.025,.025,.01,[0,2.34,.067],'#263128',8).rotation.x=Math.PI/2;
  roundedBox(body,[3.13,.018,.75],[0,-1.107,.37],'#46504d',.035);
  for(let row=0;row<4;row++)for(let col=0;col<13;col++)
    roundedBox(body,[.18,.013,.12],[-1.42+col*.236,-1.09,.10+row*.18],'#7f8985',.012);
  roundedBox(body,[1.1,.012,.44],[0,-1.109,1.02],'#959f9b',.025);
  batchStatic(root,null);
  root.traverse(object=>{if(object.isMesh){object.castShadow=false;object.receiveShadow=false;}});
  return root;
}

function featureRenders(scene,qr,screens){
  const root=group(scene),variants=Array.from({length:4},()=>group(root));
  const scan=group(variants[0],[-.9,0,.2]);scan.scale.setScalar(.95);
  const student=happyStudent(scan,[-.6,0,-.35],{rotation:.65});
  const rig=student.userData;rig.torso.rotation.x=.12;rig.head.rotation.x=.35;
  rig.arms[1].shoulder.rotation.x=-1.1;rig.arms[1].elbow.rotation.x=-.9;
  roundedBox(scan,[1.8,.1,1.3],[.65,1.04,.55],'#d4c5ad',.045);
  for(const x of [-.1,1.4])for(const z of [0,1.1])box(scan,[.06,1,.06],[x,.5,z],'#88998c');
  roundedBox(scan,[.62,.015,.62],[.55,1.10,.63],'#f5f3e8',.015);
  mesh(scan,new THREE.PlaneGeometry(.58,.58),new THREE.MeshBasicMaterial({map:qr,toneMapped:false}),[.55,1.111,.63],[-Math.PI/2,0,0]);
  const held=buildPhone(scan).root;held.scale.setScalar(.33);held.position.set(-.08,1.36,.12);held.rotation.set(-.85,.15,-.1);
  backpack(scan,[-1.0,0,-.3]);

  const handover=group(variants[2],[-.5,0,0]);handover.scale.setScalar(.95);
  happyStudent(handover,[-.9,0,.25],{rotation:-.45,wave:true});
  chair(handover,.4,-.3);happyStudent(handover,[.4,0,-.3],{seated:true,color:'#8dabb0'});
  roundedBox(handover,[1.5,.1,1],[.5,1.04,.8],'#d4c5ad',.04);
  for(const x of [0,1])for(const z of [.5,1.1])box(handover,[.055,1,.055],[x,.5,z],'#88998c');
  laptop(handover,.5,1.12,.65);backpack(handover,[-1.1,0,.75]);

  const coffee=group(variants[3],[-.60,.15,0]);coffee.scale.setScalar(1.05);
  const mug=group(coffee,[-.35,0,0]);mug.scale.setScalar(.85);
  cylinder(mug,.57,.49,1.1,[0,.7,0],'#d5b49a',16);
  cylinder(mug,.50,.50,.015,[0,1.258,0],'#765744',16);
  mesh(mug,new THREE.TorusGeometry(.55,.045,5,20),'#e9d6bd',[0,1.265,0],[Math.PI/2,0,0]);
  mesh(mug,new THREE.TorusGeometry(.29,.095,6,16),'#d5b49a',[.61,.78,0]);
  for(const x of [-.18,0,.18]){
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x,1.4,0),new THREE.Vector3(x-.05,1.63,0),new THREE.Vector3(x+.05,1.85,0)]);
    mesh(mug,new THREE.TubeGeometry(curve,8,.015,4,false),'#d8ddd2');
  }
  const watch=group(coffee,[.95,.8,.18]);watch.rotation.y=-.2;
  const caseBody=cylinder(watch,.55,.55,.16,[0,0,0],'#84947e',24);caseBody.rotation.x=Math.PI/2;
  const face=cylinder(watch,.47,.47,.02,[0,0,.09],'#f1eee0',24);face.rotation.x=Math.PI/2;
  cylinder(watch,.055,.06,.15,[0,.60,0],'#84947e',8);
  roundedBox(watch,[.22,.07,.13],[0,.69,0],'#84947e',.02);
  for(let i=0;i<12;i++){
    const angle=i*Math.PI/6;
    box(watch,[.018,i%3===0?.07:.04,.018],[Math.sin(angle)*.40,Math.cos(angle)*.40,.11],'#6a7a66',[0,0,-angle]);
  }
  const minute=group(watch,[0,0,.125]);minute.rotation.z=-.55;
  box(minute,[.022,.35,.02],[0,.15,0],'#435346');
  const second=group(watch,[0,0,.15]);second.rotation.z=1.9;
  box(second,[.014,.41,.012],[0,.15,0],'#bd795b');
  const pin=cylinder(watch,.035,.035,.025,[0,0,.16],'#435346',8);pin.rotation.x=Math.PI/2;
  variants.forEach((variant,i)=>{
    const device=staticPhone(variant,screens[i]);
    const readableScreen=i===1||i===2;
    device.scale.setScalar(readableScreen?4.2:3.5);
    device.position.set(i===1?.8:2.0,2,0);
    device.rotation.set(readableScreen?-Math.atan2(1.6,9):0,readableScreen?0:-.1,readableScreen?0:-.025);
    batchStatic(variant,null);
  });
  return {root,show(step){variants.forEach((variant,i)=>{variant.visible=i===step;});}};
}

function happyStudent(root,at,{color='#859678',rotation=0,seated=false,scale=1,wave=false}={}){
  const student=person(root,at,{color,rotation,seated});student.scale.setScalar(scale);
  const rig=student.userData;rig.mouth.visible=false;
  const smile=mesh(rig.head,new THREE.TorusGeometry(.055,.009,3,10,Math.PI),'#986b57',[0,-.07,.244]);
  smile.rotation.z=Math.PI;
  rig.brows.forEach(brow=>{brow.position.y+=.015;});
  if(wave){rig.arms[0].shoulder.rotation.z=-2.4;rig.arms[0].elbow.rotation.x=-.3;}
  if(seated){rig.arms.forEach(arm=>{arm.shoulder.rotation.x=-.6;arm.elbow.rotation.x=-1;});}
  return student;
}

function sharedTable(root,at,scale=1){
  const table=group(root,at);table.scale.setScalar(scale);
  roundedBox(table,[3.4,.12,1.55],[0,1.04,0],'#d4c5ad',.05);
  for(const x of [-1.45,1.45])for(const z of [-.55,.55])box(table,[.07,1,.07],[x,.5,z],'#88998c');
  for(const [i,x] of [-1.1,0,1.1].entries()){
    chair(table,x,-1.1);happyStudent(table,[x,0,-1.1],{seated:true,color:['#859678','#b58f75','#8dabb0'][i]});
    laptop(table,x,1.12,-.24);
    cylinder(table,.055,.055,.18,[x+.35,1.2,.2],'#c99b78');
  }
  backpack(table,[-1.8,0,-.75]);return table;
}

function conversationTable(scene){
  const root=group(scene),motion=group(root);
  roundedBox(root,[2.5,.12,1.6],[0,1.04,0],'#d4c5ad',.05);
  for(const x of [-1,1])for(const z of [-.55,.55])box(root,[.07,1,.07],[x,.5,z],'#88998c');
  const placements=[[-.65,-1.12,0],[.65,-1.12,0],[-1.65,.35,Math.PI/2],[1.65,.35,-Math.PI/2]];
  const talkers=placements.map(([x,z,rotation],i)=>{
    chair(root,x,z,rotation);
    const student=happyStudent(motion,[x,0,z],{rotation,seated:true,color:['#859678','#b58f75','#8dabb0','#b8a38d'][i]});
    student.userData.arms[i%2].shoulder.rotation.x=-1.0;
    cylinder(root,.055,.055,.16,[x*.5,1.2,z*.4],'#c99b78');
    return student;
  });
  backpack(root,[-1.5,0,-1]);
  batchStatic(root,motion);
  return {root,animate(time,reducedMotion){
    if(reducedMotion)return;
    talkers.forEach((student,i)=>{
      idle(student,time+i*1.7);
      student.userData.head.rotation.y=Math.sin(time*.8+i*1.7)*.15;
      student.userData.arms[i%2].elbow.rotation.x=-1+Math.sin(time*1.1+i*2)*.12;
    });
  }};
}

function tree(root,x,z,size=1){
  cylinder(root,.08*size,.12*size,1.1*size,[x,.55*size,z],'#a28b70',6);
  mesh(root,new THREE.IcosahedronGeometry(.85*size,0),'#91ab7e',[x,1.55*size,z]);
  mesh(root,new THREE.IcosahedronGeometry(.58*size,0),'#b0c295',[x+.35*size,1.88*size,z]);
}

function mapRender(scene,texture){
  const root=group(scene);
  const phone=staticPhone(root,texture);phone.scale.setScalar(4.2);phone.position.y=2.1;phone.rotation.set(0,-.12,-.045);
  batchStatic(root,null);return root;
}

function adoptionRender(scene,hgRoot,adminTexture){
  const root=group(scene),library=group(root),eth=group(root),universities=group(root);
  const admin=adminLaptop(root,adminTexture);
  roundedBox(library,[5.3,.18,4],[0,-.12,0],'#d5dfbd',.15);
  // An open library room remains visible as the camera pulls back to ETH.
  box(library,[5.3,2.5,.16],[0,1.15,-1.8],'#c9cec6');
  for(const x of [-1.7,1.7]){
    box(library,[1.15,1.8,.32],[x,.9,-1.55],'#a9987e');
    for(const y of [.35,.9,1.45]){
      box(library,[1.08,.05,.4],[x,y,-1.45],'#d4c5ad');
      for(let i=0;i<6;i++)box(library,[.10,.37,.17],[x-.43+i*.17,y+.22,-1.39],['#859678','#b58f75','#8dabb0'][i%3]);
    }
  }
  sharedTable(library,[0,0,.4],.85);
  const hg=hgRoot.clone(true);hg.scale.setScalar(.5);hg.position.set(0,0,-9);eth.add(hg);
  for(const [x,z] of [[-8,0],[8,0],[-9,-11],[9,-11]]){
    box(eth,[3.5,1.6,3.2],[x,.8,z],'#d1c7b4');
    for(const dx of [-1,0,1])box(eth,[.3,.55,.04],[x+dx,1,z+1.62],'#8dabb0');
    tree(eth,x-2,z+2,.85);
  }
  for(const [x,color] of [[-25,'#b5c6cf'],[25,'#c9b99b']]){
    const campus=group(universities,[x,0,-5]);
    cylinder(campus,8,8,.14,[0,-.17,0],'#d5dfbd',32);
    for(const dx of [-3.5,3.5])box(campus,[3.4,2,4],[dx,1,-.5],color);
    box(campus,[8.5,2.6,2],[0,1.3,-3.2],color);
    for(const dx of [-3,-1,1,3])cylinder(campus,.18,.18,2.3,[dx,1.15,-2.1],'#e9e4d7',8);
    tree(campus,-5,4,1.3);tree(campus,5,4,1.1);
  }
  [library,eth,universities].forEach(part=>batchStatic(part,null));
  return {root,admin,show(step){eth.visible=step>=1;universities.visible=step>=2;admin.visible=step===1;},placeAdmin(camera){
    if(!admin.visible)return;
    const depth=5,viewHeight=2*depth*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),viewWidth=viewHeight*camera.aspect;
    const scale=Math.min(viewWidth*.41/3.9,viewHeight*.52/2.9);
    admin.scale.setScalar(scale);admin.quaternion.copy(camera.quaternion);
    admin.position.set(-viewWidth*.225,-viewHeight*.065,-depth).applyQuaternion(camera.quaternion).add(camera.position);
  }};
}

export async function buildClosing(scene,hgRoot){
  const loader=new THREE.TextureLoader();
  const [planner,qr,map,admin,...screens]=await Promise.all([plannerUrl,qrUrl,campusMapUrl,adminUrl,scannerUrl,priorityUrl,handoverUrl,breakUrl].map(url=>loader.loadAsync(url)));
  [planner,qr,map,admin,...screens].forEach(texture=>{texture.colorSpace=THREE.SRGBColorSpace;});
  const features=featureRenders(scene,qr,screens),campusMap=mapRender(scene,map),adoption=adoptionRender(scene,hgRoot,admin);
  const qaAdmin=adminLaptop(scene,admin);
  const friends=group(scene);
  const partyPhone=staticPhone(friends,planner);partyPhone.scale.setScalar(4.2);partyPhone.position.y=2.1;partyPhone.rotation.set(0,-.12,-.045);
  batchStatic(friends,null);
  const friendTable=conversationTable(scene);

  const campus=group(scene);
  box(campus,[33,.16,32],[0,-.23,-1],'#d5dfbd');
  box(campus,[23,.055,14],[0,-.11,7],'#e0d6bc');
  const hg=hgRoot.clone(true);hg.position.set(0,0,-9);campus.add(hg);
  // Keep the recognisable HG building; the final foreground is an imagined campus.
  sharedTable(campus,[-4.1,0,3.2],1.1);
  sharedTable(campus,[4.2,0,5.4],.95);
  sharedTable(campus,[9.5,0,2],.7);
  for(const [x,z,size] of [[-11,4,1.7],[11,9,1.5],[-10,10,1.4],[12,-5,1.3],[-12,-8,1.5]])tree(campus,x,z,size);
  // Keep the moving characters outside the static scenery batches.
  const motion=group(campus);
  const chatters=[happyStudent(motion,[-.8,0,7.1],{color:'#c18f71',rotation:-.3,wave:true}),happyStudent(motion,[.3,0,7],{color:'#8dabb0',rotation:.4})];
  const walkers=[
    {points:[[-8,7],[-6,8.5],[-3.5,10],[-6.5,11],[-9,9]],color:'#b8a38d'},
    {points:[[7,9.5],[9.2,10],[10,6],[8,5]],color:'#a3b68f'},
  ].map(({points,color})=>({
    student:happyStudent(motion,[points[0][0],0,points[0][1]],{color,scale:.8}),
    path:new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,0,z)),true),
    phase:Math.random(),speed:.018+Math.random()*.009,
  }));
  for(const [x,z] of [[-8.4,5.8],[-9.1,6.5],[10.8,7.3],[11.2,6.5],[-8.8,10.7]]){
    cylinder(campus,.018,.022,.24,[x,.12,z],'#829a68',5);
    mesh(campus,new THREE.IcosahedronGeometry(.07,0),'#d8ad79',[x,.27,z]);
  }
  batchStatic(campus,motion);
  const point=new THREE.Vector3(),tangent=new THREE.Vector3();
  return {features,friends,friendTable,campus,campusMap,adoption,qaAdmin,placeQaAdmin(camera,phoneExpanded){
    qaAdmin.visible=!phoneExpanded;
    if(!qaAdmin.visible)return;
    const depth=5,viewHeight=2*depth*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),viewWidth=viewHeight*camera.aspect;
    qaAdmin.scale.setScalar(Math.min(viewWidth*.28/3.9,viewHeight*.28/2.9));
    qaAdmin.quaternion.copy(camera.quaternion);
    qaAdmin.position.set(-viewWidth*.32,-viewHeight*.30,-depth).applyQuaternion(camera.quaternion).add(camera.position);
  },animate(time,reducedMotion){
    if(reducedMotion)return;
    chatters.forEach((student,i)=>{idle(student,time+i*2.1);});
    chatters[0].userData.arms[0].elbow.rotation.z=Math.sin(time*1.3)*.15;
    for(const walker of walkers){
      const p=(time*walker.speed+walker.phase)%1;
      walker.path.getPoint(p,point);walker.path.getTangent(p,tangent);
      walker.student.position.copy(point);walker.student.rotation.y=Math.atan2(tangent.x,tangent.z);
      run(walker.student,time*.45+walker.phase*10,.35);
    }
  }};
}

export function buildSlides(){
  const root=document.getElementById('slides');
  root.innerHTML=`
    <section class="pitch-slide session-slide" data-slide="0" hidden aria-label="Session rules">
      <h1>Your session</h1>
      <div class="session-copy">
        <div data-feature="0"><p>QR check-in</p><span>Starts your session</span></div>
        <div data-feature="1"><p>Session limits</p><span>First chance to extend</span></div>
        <div data-feature="2"><p>Handovers</p></div>
        <div data-feature="3"><p>Timed breaks</p></div>
      </div>
    </section>
    <section class="pitch-slide friends-slide" data-slide="1" hidden aria-label="Study with friends"><h1>Study together</h1></section>
    <section class="pitch-slide eth-slide" data-slide="2" hidden aria-label="ETH fit">
      <h1>Built for ETH</h1><div class="eth-copy"><p>Campus map</p><p>ETH sign-in</p><p>Free for students</p></div>
    </section>
    <section class="pitch-slide pilot-slide" data-slide="3" hidden aria-label="One library, entire ETH, other universities">
      <div class="pilot-copy"><h1 data-rollout="0">One library</h1><span aria-hidden="true">→</span><p data-rollout="1">Entire ETH</p><span aria-hidden="true">→</span><p data-rollout="2">Other universities</p></div>
      <p class="pilot-admin">Admin room setup</p>
    </section>
    <section class="pitch-slide future-slide" data-slide="4" hidden aria-label="Study Spaces over a happy ETH campus">
      <h1 class="closing-brand" aria-label="Study Spaces">
        <svg viewBox="72 68 112 120" aria-hidden="true">
          <rect x="72" y="111" width="112" height="34" rx="12" />
          <rect class="brand-free-seat" x="88" y="68" width="34" height="34" rx="9" />
          <rect x="134" y="68" width="34" height="34" rx="9" />
          <rect x="88" y="154" width="34" height="34" rx="9" />
          <rect x="134" y="154" width="34" height="34" rx="9" />
        </svg>
        <span><strong>Study</strong> Spaces</span>
      </h1>
      <p class="qa-admin-copy">Admin</p>
    </section>`;
  const pages=[...root.querySelectorAll('[data-slide]')];
  const features=[...root.querySelectorAll('[data-feature]')];
  const rollout=[...root.querySelectorAll('[data-rollout]')];
  return {show(index){root.hidden=index<0;pages.forEach((page,i)=>{page.hidden=i!==index;});},revealFeature(step){
    features.forEach((line,i)=>{line.classList.toggle('revealed',i<=step);line.classList.toggle('active',i===step);line.setAttribute('aria-hidden',String(i>step));});
  },revealRollout(step){rollout.forEach((line,i)=>{line.classList.toggle('active',i===step);line.classList.toggle('revealed',i<=step);});}};
}
