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
  cylinder(root,1.12,1.2,.34,[dx,2.58,dz],'#c7b99d',16);
  const dome=mesh(root,new THREE.SphereGeometry(1.14,16,8,0,Math.PI*2,0,Math.PI/2),material('#7f8c84',{roughness:.5,metalness:.12}),[dx,2.75,dz]);
  dome.scale.y=.73;
  cylinder(root,.07,.1,.22,[dx,3.69,dz],'#768479',8);
  for(let i=0;i<12;i++){
    const angle=i*Math.PI*2/12;
    box(root,[.12,.22,.055],[dx+Math.sin(angle)*1.13,2.59,dz+Math.cos(angle)*1.13],glass,[0,angle,0]);
  }
  const [ex,ez]=hg.entry;
  for(let i=0;i<5;i++)box(root,[3.2,.055,1.3-i*.18],[ex,.015+i*.055,ez+.55-i*.07],'#d2c8b3');
  box(root,[.65,1.02,.09],[ex,.78,ez+.06],'#71817b');
  label(root,'ETH',[ex,1.78,ez+.08],1.08,.31);
  for(const [x,z] of [[-10,8.7],[9.8,8.7],[-10,-8.8],[10,-8.8]]){
    cylinder(root,.07,.09,.7,[x,.35,z],'#8d8973',6);
    mesh(root,new THREE.IcosahedronGeometry(.58,0),'#8fa18a',[x,1.0,z]);
  }
  batchStatic(root,null);
  return {root,entry:new THREE.Vector3(ex,1.16,ez+.12)};
}
