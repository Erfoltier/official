import sys, re
from docx import Document
from docx.shared import Mm, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
src=open('/home/user/official/wordpress/consent/tattoo-artmake-consent.html').read()
FS=float(sys.argv[2]) if len(sys.argv)>2 else 8.5
d=Document()
s=d.sections[0]; s.page_width=Mm(210); s.page_height=Mm(297)
for a in ('top_margin','bottom_margin','left_margin','right_margin'): setattr(s,a,Mm(7))
st=d.styles['Normal']; st.font.size=Pt(FS); st.font.name='Noto Sans JP'
st.element.rPr.rFonts.set(qn('w:eastAsia'),'Noto Sans JP')
pf=st.paragraph_format; pf.space_before=Pt(0); pf.space_after=Pt(0); from docx.enum.text import WD_LINE_SPACING; pf.line_spacing_rule=WD_LINE_SPACING.EXACTLY; pf.line_spacing=Pt(float(sys.argv[3]) if len(sys.argv)>3 else FS*1.35)
def runs(p,html):
    for part in re.split(r'(<b>.*?</b>)',html):
        if not part: continue
        b=part.startswith('<b>'); t=re.sub(r'<[^>]+>','',part).replace('&amp;','&')
        r=p.add_run(t); r.bold=b
body=re.search(r'<body>(.*)</body>',src,re.S).group(1)
for m in re.finditer(r'<(h1|h2|li|p)([^>]*)>(.*?)</\1>',body,re.S):
    tag,attr,inner=m.groups()
    if tag=='p' and '<br>' in inner:
        lines=[x.strip() for x in inner.split('<br>')]
    else: lines=[inner.strip()]
    for ln in lines:
        p=d.add_paragraph()
        if tag=='h1':
            p.alignment=WD_ALIGN_PARAGRAPH.CENTER; r=p.add_run(re.sub(r'<[^>]+>','',ln)); r.bold=True; r.font.size=Pt(FS+3.5); p.paragraph_format.space_after=Pt(1)
        elif tag=='h2':
            r=p.add_run(re.sub(r'<[^>]+>','',ln)); r.bold=True; r.font.size=Pt(FS+0.5); p.paragraph_format.space_before=Pt(2)
        elif tag=='li':
            p.paragraph_format.left_indent=Mm(4); p.paragraph_format.first_line_indent=Mm(-3)
            p.add_run('・'); runs(p,ln)
        else:
            runs(p,ln)
            if 'margin-top:8pt' in attr: p.paragraph_format.space_before=Pt(10)
            elif 'margin-top' in attr: p.paragraph_format.space_before=Pt(5)
            if 'text-align:right' in attr: p.alignment=WD_ALIGN_PARAGRAPH.RIGHT
d.save(sys.argv[1])
