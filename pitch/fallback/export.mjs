import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const workspaceDir=process.argv[2];
const skillDir=process.argv[3];
const pythonExecutable=process.argv[4];
if(!workspaceDir||!skillDir||!pythonExecutable)throw new Error('Pass workspace directory, presentation skill directory and bundled Python executable.');
const sourceDir=path.join(workspaceDir,'pitch/fallback');
const stagingDir=path.join(workspaceDir,'.runtime-tmp/pitch-fallback');
const outputDir=path.join(sourceDir,'output');
const manifest=JSON.parse(await fs.readFile(path.join(sourceDir,'manifest.json'),'utf8'));
const presentation=Presentation.create({slideSize:{width:1280,height:720}});
await fs.mkdir(path.join(stagingDir,'renders'),{recursive:true});
await fs.mkdir(outputDir,{recursive:true});
for(const item of manifest){
  const slide=presentation.slides.add();
  const bytes=await fs.readFile(path.join(sourceDir,'screenshots',item.file));
  slide.images.add({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:'image/png',alt:item.title,fit:'contain',position:{left:0,top:0,width:1280,height:720}});
  slide.speakerNotes.text=item.notes;
}
const candidatePath=path.join(stagingDir,'candidate.pptx');
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
const {finalizePresentation}=await import(pathToFileURL(path.join(skillDir,'container_tools/artifact_tool_utils.mjs')).href);
await finalizePresentation({
  workspaceDir,candidatePath,finalPath:path.join(outputDir,'Study-Spaces-Pitch-Fallback.pptx'),pythonExecutable,
  integrityValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(skillDir,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000'],
  explicitTotalSlideCount:manifest.length,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],
  verifyArtifactToolImport:true,receiptPath:path.join(stagingDir,'validation.json'),
});
for(const [i,slide] of presentation.slides.items.entries()){
  const render=await presentation.export({slide,format:'png',scale:1});
  await fs.writeFile(path.join(stagingDir,'renders',manifest[i].file),new Uint8Array(await render.arrayBuffer()));
}
console.log(`Exported and rendered ${manifest.length} slides.`);
