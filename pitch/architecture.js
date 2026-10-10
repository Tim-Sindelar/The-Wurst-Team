import * as THREE from 'three';
import hg from './assets/hg.json';
import { group, box, mesh, cylinder, label, material, batchStatic } from './world.js';

function shapeFor(polygon){
  const shape=new THREE.Shape();
  polygon.forEach((ring,index)=>{
    const path=index===0?shape:new THREE.Path();
    ring.forEach(([x,z],i)=>i===0?path.moveTo(x,-z):path.lineTo(x,-z));path.closePath();
    if(index>0)shape.holes.push(path);
  });return shape;
}
function slab(root,polygon,y,height,color){
  const geometry=new THREE.ExtrudeGeometry(shapeFor(polygon),{depth:height,bevelEnabled:false,curveSegments:1,steps:1});
  geometry.rotateX(-Math.PI/2);return mesh(root,geometry,color,[0,y,0]);
}
export function buildHG(scene){
  const root=group(scene);
  box(root,[24,.18,22],[0,-.16,0],'#d6d4c8');
  const sandstone=material('#c8b99d',{roughness:.82});
  const trim=material('#e2d6bd',{roughness:.8});
  const glass=material('#6e8282',{roughness:.3,metalness:.08});
  // These floor silhouettes and courtyards come from HG's actual PolyMaps geometry.
  for(const level of hg.levels){
    const y=.08+level.floor*.44;
    for(const polygon of level.polygons){
      slab(root,polygon,y,.415,sandstone);slab(root,polygon,y+.415,.025,trim);
      const ring=polygon[0];
      for(let i=0;i<ring.length-1;i++){
        const a=ring[i],b=ring[i+1],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
        if(length<.55)continue;
        const yaw=-Math.atan2(dz,dx),count=Math.floor(length/.48);
        for(let j=0;j<count;j++){
          const t=(j+.5)/count,x=a[0]+dx*t,z=a[1]+dz*t;
          box(root,[.23,.31,.075],[x,y+.225,z],trim,[0,yaw,0]);
          box(root,[.145,.225,.09],[x,y+.225,z],glass,[0,yaw,0]);
        }
      }
    }
  }
  const top=hg.levels[hg.levels.length-1];
  for(const polygon of top.polygons)slab(root,polygon,2.28,.09,'#8e9789');
  const [dx,dz]=hg.dome;
  // The KO outline isolates the rotunda; K also contains the adjoining hall.
  cylinder(root,1.5,1.56,.34,[dx,2.58,dz],'#c7b99d',24);
  const dome=mesh(root,new THREE.SphereGeometry(1.53,24,10,0,Math.PI*2,0,Math.PI/2),material('#7f8c84',{roughness:.5,metalness:.12}),[dx,2.75,dz]);
  dome.scale.y=.73;
  cylinder(root,.1,.14,.24,[dx,3.95,dz],'#768479',8);
  for(let i=0;i<16;i++){
    const angle=i*Math.PI*2/16;
    box(root,[.16,.22,.055],[dx+Math.sin(angle)*1.51,2.59,dz+Math.cos(angle)*1.51],glass,[0,angle,0]);
  }
  // Tall columns follow the curved east facade, with a gap for the entrance.
  for(const side of [-1,1])for(let i=0;i<6;i++){
    const angle=side*(.15+i*.255),x=dx+Math.cos(angle)*1.76,z=dz+Math.sin(angle)*1.76;
    cylinder(root,.075,.085,1.55,[x,1.405,z],trim,8);
    cylinder(root,.12,.12,.09,[x,.61,z],trim,8);
    cylinder(root,.12,.1,.11,[x,2.225,z],trim,8);
  }
  const [ex,ez]=hg.entry;
  const entrance=group(root,[ex,0,ez]);entrance.rotation.y=Math.PI/2;
  for(let i=0;i<5;i++)box(entrance,[1.6,.055,1.3-i*.18],[0,.015+i*.055,.55-i*.07],'#d2c8b3');
  box(entrance,[.46,1.02,.09],[0,.78,-.11],'#71817b');
  label(entrance,'ETH',[0,1.78,-.08],.8,.24);
  for(const [x,z] of [[-10,8.7],[9.8,8.7],[-10,-8.8],[10,-8.8]]){
    cylinder(root,.07,.09,.7,[x,.35,z],'#8d8973',6);
    mesh(root,new THREE.IcosahedronGeometry(.58,0),'#8fa18a',[x,1.0,z]);
  }
  batchStatic(root,null);
  return {root,entry:new THREE.Vector3(ex+.12,1.16,ez)};
}
