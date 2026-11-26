#!/usr/bin/env python3
"""Independent minimal OOXML/ODF packages; stdlib only, no Pandoc generation."""
from pathlib import Path
import hashlib, struct, sys, zlib
from zipfile import ZipFile, ZipInfo, ZIP_STORED, ZIP_DEFLATED
from xml.etree import ElementTree as ET
if len(sys.argv) != 2:
    raise SystemExit('usage: docimport.py OUTPUT_DIRECTORY')
ROOT = Path(sys.argv[1])
ROOT.mkdir(parents=True, exist_ok=True)
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB',1,1,8,6,0,0,0)) + chunk(b'IDAT',zlib.compress(b'\x00\xff\x00\x00\xff')) + chunk(b'IEND',b'')
def package(name, parts, odt=False):
    with ZipFile(ROOT/name, 'w', compression=ZIP_DEFLATED) as z:
        if odt:
            info = ZipInfo('mimetype', (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_STORED
            z.writestr(info, 'application/vnd.oasis.opendocument.text')
        for path, data in parts.items():
            if path.endswith(('.xml','.rels')) or path == '[Content_Types].xml':
                ET.fromstring(data)
            info = ZipInfo(path, (2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            z.writestr(info, data)
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
def p(text, style=None):
    return '<w:p>' + (f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else '') + f'<w:r><w:t>{text}</w:t></w:r></w:p>'
styles=f'''<w:styles xmlns:w="{W}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ForeignSubhead"><w:name w:val="Foreign Subhead"/><w:basedOn w:val="Heading1"/></w:style>
<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ForeignBody"><w:name w:val="Foreign Body"/><w:basedOn w:val="Normal"/></w:style>
</w:styles>'''
body=p('Fixture heading','Heading1')+p('Inherited heading','ForeignSubhead')
body+='''<w:p><w:r><w:t xml:space="preserve">Unicode café Ω 中文 — </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>direct italic</w:t></w:r><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>direct bold</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>styled italic</w:t></w:r><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>styled bold</w:t></w:r></w:p>'''+p('Custom body text','ForeignBody')
for text in ('First bullet','Second bullet'):
    body+=f'<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>'
body+='<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>'
for row in (('Name','Value'),('alpha','42')):
    body+='<w:tr>'+('<w:trPr><w:tblHeader/></w:trPr>' if row[0] == 'Name' else '')+''.join('<w:tc><w:tcPr/>'+p(t)+'</w:tc>' for t in row)+'</w:tr>'
body+='</w:tbl>'
body+='''<w:p><w:r><w:t xml:space="preserve">Review: </w:t></w:r><w:del w:id="1" w:author="Fixture Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>old phrase</w:delText></w:r></w:del><w:ins w:id="2" w:author="Fixture Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t>new phrase</w:t></w:r></w:ins><w:commentRangeStart w:id="0"/><w:r><w:t xml:space="preserve"> annotated text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>
<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Pixel" descr="red pixel"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="pixel.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'''
CT='http://schemas.openxmlformats.org/package/2006/content-types'
contenttypes=f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
for part,kind in [('document','document.main'),('styles','styles'),('numbering','numbering'),('comments','comments')]:
    contenttypes+=f'<Override PartName="/word/{part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"/>'
contenttypes+='</Types>'
REL='http://schemas.openxmlformats.org/package/2006/relationships'
rels=f'<Relationships xmlns="{REL}">'
for id,typ,target in [('rIdStyles','styles','styles.xml'),('rIdNum','numbering','numbering.xml'),('rIdComments','comments','comments.xml'),('rIdImage','image','media/pixel.png')]:
    rels+=f'<Relationship Id="{id}" Type="{R}/{typ}" Target="{target}"/>'
rels+='</Relationships>'
package('foreign.docx', {
'[Content_Types].xml': contenttypes,
'_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="{R}/officeDocument" Target="word/document.xml"/></Relationships>',
'word/document.xml': f'<w:document xmlns:w="{W}" xmlns:r="{R}"><w:body>{body}<w:sectPr/></w:body></w:document>',
'word/styles.xml':styles,
'word/numbering.xml':f'<w:numbering xmlns:w="{W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>',
'word/comments.xml':f'<w:comments xmlns:w="{W}"><w:comment w:id="0" w:author="Fixture Reviewer" w:date="2026-01-01T00:00:00Z">{p("Fixture comment")}</w:comment></w:comments>',
'word/_rels/document.xml.rels':rels, 'word/media/pixel.png':png})
ns='''xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"'''
auto='''<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style><style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style><text:list-style style:name="Bullets"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/></text:list-style>'''
odtbody='''<text:h text:outline-level="1">Fixture heading</text:h><text:h text:outline-level="2">Second heading</text:h><text:p>Unicode café Ω 中文 — <text:span text:style-name="Italic">styled italic</text:span> / <text:span text:style-name="Bold">styled bold</text:span></text:p><text:list text:style-name="Bullets"><text:list-item><text:p>First bullet</text:p></text:list-item><text:list-item><text:p>Second bullet</text:p></text:list-item></text:list>'''
odtbody+='<table:table table:name="Fixture"><table:table-column table:number-columns-repeated="2"/><table:table-header-rows><table:table-row>'+''.join(f'<table:table-cell office:value-type="string"><text:p>{t}</text:p></table:table-cell>' for t in ('Name','Value'))+'</table:table-row></table:table-header-rows><table:table-row>'+''.join(f'<table:table-cell office:value-type="string"><text:p>{t}</text:p></table:table-cell>' for t in ('alpha','42'))+'</table:table-row></table:table>'
odtbody+='''<text:p><draw:frame draw:name="red pixel" text:anchor-type="as-char" svg:width="0.01in" svg:height="0.01in"><draw:image xlink:href="Pictures/pixel.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/><svg:title>red pixel</svg:title></draw:frame></text:p>'''
package('foreign.odt', {
'content.xml':f'<office:document-content {ns} office:version="1.2"><office:automatic-styles>{auto}</office:automatic-styles><office:body><office:text>{odtbody}</office:text></office:body></office:document-content>',
'styles.xml':f'<office:document-styles {ns} office:version="1.2"><office:styles/></office:document-styles>',
'META-INF/manifest.xml':'''<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Pictures/pixel.png" manifest:media-type="image/png"/></manifest:manifest>''',
'Pictures/pixel.png':png},odt=True)
for f in ROOT.glob('foreign.*'):
    print(f.name, len(f.read_bytes()), hashlib.sha256(f.read_bytes()).hexdigest())
