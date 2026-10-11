"""Build a fully offline, 16:9 PDF from the captured pitch frames."""
import json
import sys
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

root=Path(__file__).resolve().parent
items=json.loads((root/'manifest.json').read_text())
high_res='--4k' in sys.argv
image_dir=root/('screenshots-4k' if high_res else 'screenshots')
out=root/'output'/('Study-Spaces-Pitch-Fallback-4K.pdf' if high_res else 'Study-Spaces-Pitch-Fallback.pdf')
out.parent.mkdir(parents=True,exist_ok=True)
pdf=canvas.Canvas(str(out),pagesize=(960,540),pageCompression=1)
pdf.setTitle('Study Spaces pitch fallback')
pdf.setAuthor('The Wurst Team')
for index,item in enumerate(items,1):
    key=f'slide-{index}'
    pdf.bookmarkPage(key)
    pdf.addOutlineEntry(f'{index}. {item["title"]}',key,0)
    image_name=item['file'].replace('.png','.jpg') if high_res else item['file']
    pdf.drawImage(ImageReader(str(image_dir/image_name)),0,0,width=960,height=540,preserveAspectRatio=True,mask='auto')
    pdf.showPage()
pdf.save()
print(f'Exported {len(items)} PDF pages.')
