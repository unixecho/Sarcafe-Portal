"""Draw the slides of coffee_workshop.pptx as HTML (one file per slide), so a browser can screenshot them.

The deck is simple (solid fills, rectangles / ellipses / rounded rectangles / one line, shadows, pictures, two tables,
explicit fonts and sizes, RTL paragraphs), so its XML maps straight to absolutely positioned CSS at 1920x1080
(1 pt = 2 px, 12192000 EMU = 1920 px). Input is treated as data: nothing in the file is executed.
"""
import html, os, re, shutil, sys, zipfile
import xml.etree.ElementTree as ET

A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
K = 1920 / 12192000


def px(v):
    return round(int(v) * K, 2)


def colour(el):
    """#rrggbb / rgba() from an element that holds an <a:srgbClr>."""
    if el is None:
        return None
    c = el.find(f'{A}srgbClr')
    if c is None:
        return None
    v = c.get('val')
    al = c.find(f'{A}alpha')
    if al is not None:
        r, g, b = int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
        return f'rgba({r},{g},{b},{int(al.get("val")) / 100000:.3f})'
    return '#' + v


def solid(sp_pr):
    f = sp_pr.find(f'{A}solidFill') if sp_pr is not None else None
    return colour(f)


def font_stack(rpr):
    names = []
    for tag in ('latin', 'cs', 'ea'):
        e = rpr.find(f'{A}{tag}') if rpr is not None else None
        if e is not None and e.get('typeface') and e.get('typeface') not in names:
            names.append(e.get('typeface'))
    names += ['Calibri', 'Segoe UI', 'Arial', 'Segoe UI Emoji', 'sans-serif']
    return ','.join(f"'{n}'" if ' ' in n else n for n in names)


def paragraph_html(p, default_sz=1800):
    ppr = p.find(f'{A}pPr')
    algn = (ppr.get('algn') if ppr is not None else None) or 'l'
    rtl = ppr is not None and ppr.get('rtl') == '1'
    style = [f'direction:{"rtl" if rtl else "ltr"}', 'text-align:' + {'l': 'left', 'r': 'right', 'ctr': 'center', 'just': 'justify'}.get(algn, 'left')]
    ln = ppr.find(f'{A}lnSpc/{A}spcPct') if ppr is not None else None
    style.append(f'line-height:{int(ln.get("val")) / 100000 * 1.2:.3f}' if ln is not None else 'line-height:1.2')
    aft = ppr.find(f'{A}spcAft/{A}spcPts') if ppr is not None else None
    if aft is not None:
        style.append(f'margin-bottom:{int(aft.get("val")) / 100 * 2:.1f}px')
    bef = ppr.find(f'{A}spcBef/{A}spcPts') if ppr is not None else None
    if bef is not None:
        style.append(f'margin-top:{int(bef.get("val")) / 100 * 2:.1f}px')
    parts = []
    last_sz = default_sz
    for child in p:
        if child.tag == f'{A}r':
            rpr = child.find(f'{A}rPr')
            t = child.find(f'{A}t')
            text = html.escape(t.text or '') if t is not None else ''
            # U+F04A is the smiley of the Wingdings symbol font (a private-use code point nothing else can draw).
            text = text.replace('', '🙂')
            sz = int(rpr.get('sz')) if rpr is not None and rpr.get('sz') else default_sz
            last_sz = sz
            css = [f'font-size:{sz / 100 * 2:.2f}px', f'font-family:{font_stack(rpr)}']
            if rpr is not None and rpr.get('b') == '1':
                css.append('font-weight:700')
            if rpr is not None and rpr.get('i') == '1':
                css.append('font-style:italic')
            c = solid(rpr)
            if c:
                css.append(f'color:{c}')
            parts.append(f'<span style="{";".join(css)}">{text}</span>')
        elif child.tag == f'{A}br':
            parts.append('<br>')
    end = p.find(f'{A}endParaRPr')
    if end is not None and end.get('sz'):
        last_sz = int(end.get('sz'))
    if not parts:
        parts.append('&nbsp;')
        style.append(f'font-size:{last_sz / 100 * 2:.2f}px')
    return f'<div style="{";".join(style)}">{"".join(parts)}</div>'


def has_text(tx_body):
    if tx_body is None:
        return False
    return any((t.text or '').strip() for t in tx_body.iter(f'{A}t'))


def text_box(tx_body):
    bp = tx_body.find(f'{A}bodyPr')
    l = int(bp.get('lIns', 91440)); t = int(bp.get('tIns', 45720)); r = int(bp.get('rIns', 91440)); b = int(bp.get('bIns', 45720))
    anchor = bp.get('anchor', 't')
    justify = {'t': 'flex-start', 'ctr': 'center', 'b': 'flex-end'}.get(anchor, 'flex-start')
    paras = ''.join(paragraph_html(p) for p in tx_body.findall(f'{A}p'))
    return f'<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:{justify};padding:{px(t)}px {px(r)}px {px(b)}px {px(l)}px;box-sizing:border-box;overflow:visible">{paras}</div>'


def line_css(ln):
    if ln is None or ln.find(f'{A}solidFill') is None:
        return None
    return f'{max(1, px(ln.get("w", 12700)))}px solid {solid(ln)}'


def shape_html(sp):
    sp_pr = sp.find(f'{P}spPr')
    xf = sp_pr.find(f'{A}xfrm')
    off, ext = xf.find(f'{A}off'), xf.find(f'{A}ext')
    x, y, w, h = int(off.get('x')), int(off.get('y')), int(ext.get('cx')), int(ext.get('cy'))
    geom = sp_pr.find(f'{A}prstGeom')
    prst = geom.get('prst') if geom is not None else 'rect'
    css = [f'position:absolute;left:{px(x)}px;top:{px(y)}px;width:{px(w)}px;height:{px(h)}px;box-sizing:border-box']
    if prst == 'line':
        border = line_css(sp_pr.find(f'{A}ln')) or '2px solid #888'
        side = 'border-top' if h == 0 else 'border-left'
        css.append(f'{side}:{border}')
        return f'<div style="{";".join(css)}"></div>'
    fill = solid(sp_pr)
    if fill:
        css.append(f'background:{fill}')
    if prst == 'ellipse':
        css.append('border-radius:50%')
    elif prst == 'roundRect':
        gd = geom.find(f'{A}avLst/{A}gd')
        adj = int(re.search(r'val (\d+)', gd.get('fmla')).group(1)) if gd is not None else 16667
        css.append(f'border-radius:{min(adj, 50000) / 100000 * min(px(w), px(h)):.2f}px')
    border = line_css(sp_pr.find(f'{A}ln'))
    if border:
        css.append(f'border:{border}')
    sh = sp_pr.find(f'{A}effectLst/{A}outerShdw')
    if sh is not None:
        import math
        dist = int(sh.get('dist', 0)); d = int(sh.get('dir', 5400000)) / 60000
        css.append(f'box-shadow:{px(dist * math.cos(math.radians(d))):.1f}px {px(dist * math.sin(math.radians(d))):.1f}px {px(sh.get("blurRad", 0)):.1f}px {colour(sh) or "rgba(0,0,0,.25)"}')
    body = sp.find(f'{P}txBody')
    inner = text_box(body) if has_text(body) else ''
    return f'<div style="{";".join(css)}">{inner}</div>'


def picture_html(pic, rels, media_prefix):
    xf = pic.find(f'{P}spPr/{A}xfrm')
    off, ext = xf.find(f'{A}off'), xf.find(f'{A}ext')
    rid = pic.find(f'{P}blipFill/{A}blip').get(f'{R}embed')
    src = media_prefix + os.path.basename(rels[rid])
    return f'<img src="{src}" alt="" style="position:absolute;left:{px(off.get("x"))}px;top:{px(off.get("y"))}px;width:{px(ext.get("cx"))}px;height:{px(ext.get("cy"))}px">'


def table_html(frame):
    xf = frame.find(f'{P}xfrm')
    off, ext = xf.find(f'{A}off'), xf.find(f'{A}ext')
    tbl = frame.find(f'.//{A}tbl')
    cols = [px(g.get('w')) for g in tbl.findall(f'{A}tblGrid/{A}gridCol')]
    rows = []
    for tr in tbl.findall(f'{A}tr'):
        cells = []
        for i, tc in enumerate(tr.findall(f'{A}tc')):
            pr = tc.find(f'{A}tcPr')
            css = [f'width:{cols[i]}px', 'box-sizing:border-box', 'padding:%spx %spx' % (px(45720), px(91440)), 'vertical-align:' + {'ctr': 'middle', 'b': 'bottom'}.get(pr.get('anchor') if pr is not None else None, 'top')]
            fill = solid(pr) if pr is not None else None
            if fill:
                css.append(f'background:{fill}')
            if pr is not None:
                for tag, side in (('lnL', 'left'), ('lnR', 'right'), ('lnT', 'top'), ('lnB', 'bottom')):
                    b = line_css(pr.find(f'{A}{tag}'))
                    if b:
                        css.append(f'border-{side}:{b}')
            paras = ''.join(paragraph_html(p, 1400) for p in tc.find(f'{P}txBody' if tc.find(f'{P}txBody') is not None else f'{A}txBody').findall(f'{A}p'))
            cells.append(f'<td style="{";".join(css)}">{paras}</td>')
        rows.append(f'<tr style="height:{px(tr.get("h"))}px">{"".join(cells)}</tr>')
    return f'<table style="position:absolute;left:{px(off.get("x"))}px;top:{px(off.get("y"))}px;width:{px(ext.get("cx"))}px;border-collapse:collapse;table-layout:fixed">{"".join(rows)}</table>'


def main(pptx, out_dir):
    z = zipfile.ZipFile(pptx)
    os.makedirs(out_dir, exist_ok=True)
    media_dir = os.path.join(out_dir, 'media')
    os.makedirs(media_dir, exist_ok=True)
    for name in z.namelist():
        if name.startswith('ppt/media/'):
            with open(os.path.join(media_dir, os.path.basename(name)), 'wb') as f:
                f.write(z.read(name))
    slides = sorted((n for n in z.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)), key=lambda n: int(re.findall(r'\d+', n)[0]))
    for n in slides:
        num = int(re.findall(r'\d+', n)[0])
        root = ET.fromstring(z.read(n))
        rel_xml = ET.fromstring(z.read(f'ppt/slides/_rels/slide{num}.xml.rels'))
        rels = {r.get('Id'): r.get('Target') for r in rel_xml}
        bg = root.find(f'{P}cSld/{P}bg/{P}bgPr')
        bg_css = solid(bg) or '#ffffff'
        items = []
        for el in root.find(f'{P}cSld/{P}spTree'):
            if el.tag == f'{P}sp':
                items.append(shape_html(el))
            elif el.tag == f'{P}pic':
                items.append(picture_html(el, rels, 'media/'))
            elif el.tag == f'{P}graphicFrame' and el.find(f'.//{A}tbl') is not None:
                items.append(table_html(el))
        page = f'<!doctype html><html lang="he"><meta charset="utf-8"><body style="margin:0;background:#000"><div id="slide" style="position:relative;width:1920px;height:1080px;overflow:hidden;background:{bg_css}">{"".join(items)}</div></body></html>'
        with open(os.path.join(out_dir, f'slide-{num:02d}.html'), 'w', encoding='utf-8') as f:
            f.write(page)
    # What each slide says (its biggest text is the title), for screen readers and search.
    manifest = []
    for n in slides:
        xml = z.read(n).decode('utf8')
        items = []
        for run in re.findall(r'<a:r>(.*?)</a:r>', xml, flags=re.S):
            t = re.search(r'<a:t>([^<]*)</a:t>', run)
            sz = re.search(r'sz="(\d+)"', run)
            if t and t.group(1).strip():
                items.append((int(sz.group(1)) if sz else 0, html.unescape(t.group(1).strip())))
        title = max(items, key=lambda i: i[0])[1] if items else ''
        text = re.sub(r'\s+', ' ', ' '.join(t for _, t in items)).replace('', '🙂')
        manifest.append({'title': title, 'text': text[:420]})
    with open(os.path.join(out_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        import json
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(len(slides), 'slides')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
