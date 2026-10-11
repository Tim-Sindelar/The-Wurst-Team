import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import geometry from '../frontend/src/features/admin/geometry.js';

const room=geometry.roomFromCoordinates({
  id:'pitch-room',label:'Study room',kind:'Library',coordinateUnit:'m',
  coordinateAxis:'screen',approximate:true,boundary:[[0,0],[10,0],[10,10],[0,10]],
});
let objects=[];
for(const [i,[x,y]] of [[190,190],[500,190],[190,450],[500,450]].entries()){
  const table={id:`table-${i}`,type:'table',shape:'rect',label:String.fromCharCode(65+i),x,y,width:192,height:64,angle:0};
  objects.push(table);
  for(const [j,slot] of geometry.slots(table).entries())objects.push({
    id:`seat-${i}-${j}`,type:'seat',width:32,height:36,...slot,
    badges:i===0?['outlet']:i===3?['quiet']:[],
  });
}
objects=geometry.place(room,objects,'window',180,28,'window-1');
objects=geometry.place(room,objects,'window',500,28,'window-2');
objects=geometry.place(room,objects,'door',348,668,'door-1');
objects=geometry.renumber(objects);
geometry.assertLayout(room,objects);
const layout={schemaVersion:1,unitsPerMeter:geometry.UNITS_PER_METER,room,objects};
const code=['seed-crowd.py','seed-friends.py','seed-demo.py'].map(file=>readFileSync(new URL(file,import.meta.url),'utf8')).join('\n');
const result=spawnSync('docker',['compose','exec','-T','backend','python','-c',code],{
  cwd:new URL('../',import.meta.url),input:JSON.stringify(layout),encoding:'utf8',maxBuffer:1024*1024,
});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
if(result.error)throw result.error;
process.exitCode=result.status??1;
