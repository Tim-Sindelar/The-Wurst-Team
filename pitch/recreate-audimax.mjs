// Reconstruct the screenshot's curved Audimax seating inside its saved ETH outline.
// Emit a normal admin layout; saving it through the local admin API creates real seats.
import { readFileSync, writeFileSync } from 'node:fs';
import geometry from '../frontend/src/features/admin/geometry.js';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node pitch/recreate-audimax.mjs <space-response.json> <layout.json>');
const {space}=JSON.parse(readFileSync(input,'utf8'));
if(space.name!=='HG F 30'||space.seats.length||space.layout.objects.length)
  throw Error('Only reconstruct the empty HG F 30 room; preserve existing seats and layouts.');
const room=space.layout.room;
const center={x:-131,y:743},size=.72;
const row={id:'audimax-main-rows',type:'row',label:'Row 1',x:center.x+367.2,y:center.y,
  width:272,height:100,angle:-90,scale:size,count:15,rows:11,sweep:80,radius:367.2/size,
  seatSpacing:80,rowSpacing:90,seatSpacingVersion:2};
const objects=[row];
let number=0;
function addSeats(parent){
  for(const slot of geometry.slots(parent))objects.push({id:`audimax-seat-${++number}`,type:'seat',
    width:32,height:36,...slot,number,badges:[]});
}
addSeats(row);
for(const [i,degrees] of [-12,0,12,-24,25].entries()){
  const a=degrees*Math.PI/180,radius=i>=3?875:889;
  const table={id:`audimax-rear-${i}`,type:'table',shape:'curved',label:String.fromCharCode(65+i),
    x:center.x+radius*Math.cos(a),y:center.y+radius*Math.sin(a),angle:90+degrees,
    width:i<3?340:300,height:10,curvature:9,scale:i<3?.52:.65};
  objects.push(table);addSeats(table);
}
geometry.assertLayout(room,objects);
if(number!==303)throw Error(`Expected 303 seats, got ${number}`);
writeFileSync(output,JSON.stringify({layout:{...space.layout,objects}},null,2));
console.log(`Recreated ${number} seats in the existing Audimax room outline.`);
