import * as THREE from 'three';
import { group, box, mesh, cylinder, roundedBox, roundedShape, person, chair, laptop, backpack, buildPhone, idle, run, batchStatic } from './world.js';
import plannerUrl from './assets/party-planner.jpg';
import qrUrl from './assets/seat-qr.svg';

function screenTexture(){
  const canvas=document.createElement('canvas');canvas.width=390;canvas.height=844;
  const c=canvas.getContext('2d');c.fillStyle='#111';c.fillRect(0,0,390,844);
  c.fillStyle='#eee';c.font='600 23px Arial';c.fillText('Study Spaces',24,74);
  c.font='500 32px Arial';c.fillText('Your session',24,154);
  c.font='500 70px Arial';c.fillText('15:00',24,255);
  c.fillStyle='#aaa';c.font='21px Arial';c.fillText('HG E 51 · Seat A-1',24,302);
  c.fillStyle='#292d2a';c.beginPath();c.roundRect(20,360,350,195,18);c.fill();
  c.fillStyle='#eee';c.font='600 28px Arial';c.fillText('Your reservation',38,403);c.fillText('is running out',38,439);
  c.fillStyle='#b7c7ac';c.font='23px Arial';c.fillText('Priority to extend',38,490);
  c.fillStyle='#82a6df';c.beginPath();c.roundRect(20,650,350,56,10);c.fill();
  c.fillStyle='#182229';c.font='600 21px Arial';c.textAlign='center';c.fillText('Extend session',195,686);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function staticPhone(parent,texture){
  const phone=buildPhone(parent);
  const geometry=new THREE.ShapeGeometry(roundedShape(.392,.810,.028));
  const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++)uv.setXY(i,(positions.getX(i)+.196)/.392,(positions.getY(i)+.405)/.810);
  mesh(phone.root,geometry,new THREE.MeshBasicMaterial({map:texture,toneMapped:false}),[0,-.017,.038]);
  roundedBox(phone.root,[.108,.023,.012],[0,.405,.043],'#050706',.008,12);
  return phone.root;
}

function featureRenders(scene,qr){
  const root=group(scene),variants=Array.from({length:4},()=>group(root));
  const scan=variants[0];scan.scale.setScalar(1.45);
  const student=happyStudent(scan,[-.6,0,-.35],{rotation:.65});
  const rig=student.userData;rig.torso.rotation.x=.12;rig.head.rotation.x=.35;
  rig.arms[1].shoulder.rotation.x=-1.1;rig.arms[1].elbow.rotation.x=-.9;
  roundedBox(scan,[1.8,.1,1.3],[.65,1.04,.55],'#d4c5ad',.045);
  for(const x of [-.1,1.4])for(const z of [0,1.1])box(scan,[.06,1,.06],[x,.5,z],'#88998c');
  roundedBox(scan,[.62,.015,.62],[.55,1.10,.63],'#f5f3e8',.015);
  mesh(scan,new THREE.PlaneGeometry(.58,.58),new THREE.MeshBasicMaterial({map:qr,toneMapped:false}),[.55,1.111,.63],[-Math.PI/2,0,0]);
  const held=buildPhone(scan).root;held.scale.setScalar(.33);held.position.set(-.08,1.36,.12);held.rotation.set(-.85,.15,-.1);
  backpack(scan,[-1.0,0,-.3]);

  const expiry=variants[1],device=staticPhone(expiry,screenTexture());device.scale.setScalar(3.8);device.position.y=2;device.rotation.set(0,-.12,-.035);

  const handover=variants[2];handover.scale.setScalar(1.45);
  happyStudent(handover,[-.9,0,.25],{rotation:-.45,wave:true});
  chair(handover,.4,-.3);happyStudent(handover,[.4,0,-.3],{seated:true,color:'#8dabb0'});
  roundedBox(handover,[1.5,.1,1],[.5,1.04,.8],'#d4c5ad',.04);
  for(const x of [0,1])for(const z of [.5,1.1])box(handover,[.055,1,.055],[x,.5,z],'#88998c');
  laptop(handover,.5,1.12,.65);backpack(handover,[-1.1,0,.75]);

  const coffee=variants[3];coffee.scale.setScalar(2);
  cylinder(coffee,.57,.49,1.1,[0,.7,0],'#d5b49a',16);
  cylinder(coffee,.50,.50,.015,[0,1.258,0],'#765744',16);
  mesh(coffee,new THREE.TorusGeometry(.55,.045,5,20),'#e9d6bd',[0,1.265,0],[Math.PI/2,0,0]);
  mesh(coffee,new THREE.TorusGeometry(.29,.095,6,16),'#d5b49a',[.61,.78,0]);
  for(const x of [-.18,0,.18]){
    const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(x,1.4,0),new THREE.Vector3(x-.05,1.63,0),new THREE.Vector3(x+.05,1.85,0)]);
    mesh(coffee,new THREE.TubeGeometry(curve,8,.015,4,false),'#d8ddd2');
  }
  variants.forEach(variant=>batchStatic(variant,null));
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

function tree(root,x,z,size=1){
  cylinder(root,.08*size,.12*size,1.1*size,[x,.55*size,z],'#a28b70',6);
  mesh(root,new THREE.IcosahedronGeometry(.85*size,0),'#91ab7e',[x,1.55*size,z]);
  mesh(root,new THREE.IcosahedronGeometry(.58*size,0),'#b0c295',[x+.35*size,1.88*size,z]);
}

export async function buildClosing(scene,hgRoot){
  const loader=new THREE.TextureLoader();
  const [planner,qr]=await Promise.all([loader.loadAsync(plannerUrl),loader.loadAsync(qrUrl)]);
  planner.colorSpace=THREE.SRGBColorSpace;qr.colorSpace=THREE.SRGBColorSpace;
  const features=featureRenders(scene,qr);
  const friends=group(scene);
  const partyPhone=staticPhone(friends,planner);partyPhone.scale.setScalar(4.2);partyPhone.position.y=2.1;partyPhone.rotation.set(0,-.12,-.045);
  batchStatic(friends,null);

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
  return {features,friends,campus,animate(time,reducedMotion){
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
      <div class="pilot-copy"><h1>One library</h1><span aria-hidden="true">→</span><p>Entire ETH</p><span aria-hidden="true">→</span><p>Other universities</p></div>
    </section>
    <section class="pitch-slide future-slide" data-slide="4" hidden aria-label="Questions and answers over a happy ETH campus"><h1>Q&amp;A</h1></section>`;
  const pages=[...root.querySelectorAll('[data-slide]')];
  const features=[...root.querySelectorAll('[data-feature]')];
  return {show(index){root.hidden=index<0;pages.forEach((page,i)=>{page.hidden=i!==index;});},revealFeature(step){
    features.forEach((line,i)=>{line.classList.toggle('revealed',i<=step);line.classList.toggle('active',i===step);line.setAttribute('aria-hidden',String(i>step));});
  }};
}
