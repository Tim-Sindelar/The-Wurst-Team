"""Build a fully offline, 16:9 PDF from the captured pitch frames."""
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

root=Path(__file__).resolve().parent
items=json.loads((root/'manifest.json').read_text())
out=root/'output'/'Study-Spaces-Pitch-Fallback.pdf'
out.parent.mkdir(parents=True,exist_ok=True)
pdf=canvas.Canvas(str(out),pagesize=(960,540),pageCompression=1)
pdf.setTitle('Study Spaces pitch fallback')
pdf.setAuthor('The Wurst Team')
for index,item in enumerate(items,1):
    key=f'slide-{index}'
    pdf.bookmarkPage(key)
    pdf.addOutlineEntry(f'{index}. {item["title"]}',key,0)
    pdf.drawImage(ImageReader(str(root/'screenshots'/item['file'])),0,0,width=960,height=540,preserveAspectRatio=True,mask='auto')
    pdf.showPage()
pdf.save()
print(f'Exported {len(items)} PDF pages.')
