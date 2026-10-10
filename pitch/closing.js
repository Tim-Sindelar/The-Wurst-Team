import * as THREE from 'three';
import { group, box, mesh, cylinder, roundedBox, person, chair, laptop, backpack, batchStatic } from './world.js';

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

export function buildClosing(scene,hgRoot){
  const friends=group(scene);
  sharedTable(friends,[0,0,0]);batchStatic(friends,null);

  const campus=group(scene);
  box(campus,[33,.16,32],[0,-.23,-1],'#d5dfbd');
  box(campus,[23,.055,14],[0,-.11,7],'#e0d6bc');
  const hg=hgRoot.clone(true);hg.position.set(0,0,-9);campus.add(hg);
  // Keep the recognisable HG building; the final foreground is an imagined campus.
  sharedTable(campus,[-4.1,0,3.2],1.1);
  sharedTable(campus,[4.2,0,5.4],.95);
  sharedTable(campus,[9.5,0,2],.7);
  for(const [x,z,size] of [[-11,4,1.7],[11,9,1.5],[-10,10,1.4],[12,-5,1.3],[-12,-8,1.5]])tree(campus,x,z,size);
  // A pair chatting and waving, with no one still searching for somewhere to sit.
  happyStudent(campus,[-.8,0,7.1],{color:'#c18f71',rotation:-.3,wave:true});
  happyStudent(campus,[.3,0,7],{color:'#8dabb0',rotation:.4});
  for(const [x,z] of [[-8.4,5.8],[-9.1,6.5],[10.8,7.3],[11.2,6.5],[-8.8,10.7]]){
    cylinder(campus,.018,.022,.24,[x,.12,z],'#829a68',5);
    mesh(campus,new THREE.IcosahedronGeometry(.07,0),'#d8ad79',[x,.27,z]);
  }
  batchStatic(campus,null);
  return {friends,campus};
}

export function buildSlides(){
  const root=document.getElementById('slides');
  root.innerHTML=`
    <section class="pitch-slide session-slide" data-slide="0" hidden aria-label="Session rules">
      <h1>Sessions</h1>
      <div class="session-copy"><p>Limited sessions</p><p>Extension priority</p><p>Handovers</p><p>Timed breaks</p></div>
    </section>
    <section class="pitch-slide friends-slide" data-slide="1" hidden aria-label="Study with friends"><h1>Study together</h1></section>
    <section class="pitch-slide eth-slide" data-slide="2" hidden aria-label="ETH fit">
      <h1>Built for ETH</h1><div class="eth-copy"><p>Campus map</p><p>ETH sign-in</p><p>Free for students</p></div>
    </section>
    <section class="pitch-slide pilot-slide" data-slide="3" hidden aria-label="Library pilot then faculty expansion">
      <div class="pilot-copy"><h1>One library</h1><span aria-hidden="true">→</span><p>Then the faculty</p></div>
    </section>
    <section class="pitch-slide future-slide" data-slide="4" hidden aria-label="An imagined ETH where everyone has a study seat"></section>`;
  const pages=[...root.querySelectorAll('[data-slide]')];
  return {show(index){root.hidden=index<0;pages.forEach((page,i)=>{page.hidden=i!==index;});}};
}
