#!/usr/local/bin/python3
"""Offline desktop handoff regression; writes fixtures/evidence only below --pilot.
Run before and after edits. No live clipboard, network, or X input is used.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import time
import zlib


def run(argv, **kw):
    return subprocess.run([str(a) for a in argv], text=True, capture_output=True, **kw)


def fixtures(root):
    root.mkdir(parents=True, exist_ok=True)
    (root / 'text space "quote" \\slash [x]*?.txt').write_text('Synthetic desktop workflow fixture.\n')
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 32, 32, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress((b'\0' + b'\x20\x80\xc0' * 32) * 32)) + chunk(b'IEND', b'')
    (root / 'image space.png').write_bytes(png)
    (root / ' image [x]*? "quote" \\slash.png ').write_bytes(png)
    for name in ['extensionless [x]*? \\name', '.hidden [x]*? \\name.png',
                 '.hidden extensionless', 'literal [x]*? \\name.png']:
        (root / name).write_bytes(png)
    for suffix, codec in [('jpg', 'mjpeg'), ('bmp', 'bmp'), ('tiff', 'tiff')]:
        p = run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', root / 'image space.png', '-frames:v', '1', '-c:v', codec, root / ('image space.' + suffix)])
        if p.returncode:
            raise RuntimeError(p.stderr)
    shutil.copyfile(root / 'image space.jpg', root / 'image space.jpe')
    p = run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-loop', '1', '-i', root / 'image space.png', '-t', '0.4', '-an', '-c:v', 'mpeg4', root / 'silent space.mp4'])
    if p.returncode:
        raise RuntimeError(p.stderr)
    (root / 'vector space.svg').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>\n')
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>', b'<< /Length 24 >>\nstream\n0 0 1 rg 0 0 50 50 re f\nendstream']
    pdf = b'%PDF-1.4\n'; offsets = [0]
    for n, obj in enumerate(objects, 1):
        offsets.append(len(pdf)); pdf += f'{n} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(pdf)
    pdf += b'xref\n0 5\n0000000000 65535 f \n' + b''.join(f'{off:010} 00000 n \n'.encode() for off in offsets[1:])
    pdf += f'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    (root / 'document space.pdf').write_bytes(pdf)
    for name in ['literal[x].txt', 'literalx.txt', 'star*.txt', 'starOTHER.txt', 'question?.txt', 'questionX.txt', ' leading trailing .txt']:
        (root / name).write_text(name + '\n')
    (root / 'folder space "quote" \\slash [x]*?').mkdir(exist_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--pilot', type=Path, required=True)
    parser.add_argument('--label', default='after')
    args = parser.parse_args()
    source, pilot = args.source.resolve(), args.pilot.resolve()
    pilot.mkdir(parents=True, exist_ok=True)
    data, stubs = pilot / 'fixtures', pilot / 'stubs'
    fixtures(data)
    stubs.mkdir(exist_ok=True)
    log = pilot / (args.label + '-argv.jsonl')
    log.write_text('')
    stub = '''#!/usr/local/bin/python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
record = {'cmd': name, 'argv': sys.argv[1:]}
if name == 'nsxiv': record['stdin'] = sys.stdin.read()
if name == 'xclip' and '-o' not in sys.argv:
    f = pathlib.Path(sys.argv[-1])
    record['payload_hex'] = f.read_bytes().hex() if f.is_file() else sys.stdin.buffer.read().hex()
with open(os.environ['WORKFLOW_LOG'], 'a') as out: out.write(json.dumps(record) + '\\n')
if name == 'xclip' and '-o' in sys.argv:
    print('https://clipboard.invalid/' if 'clipboard' in sys.argv else 'https://primary.invalid/', end='')
if name == 'detach': os.execvp(sys.argv[1], sys.argv[1:])
'''
    for name in ['xclip', 'detach', 'workflow-browser', 'workflow-editor', 'nsxiv', 'mpv', 'zathura', 'notify-send', 'lf']:
        (stubs / name).write_text(stub); (stubs / name).chmod(0o700)
    env = dict(os.environ, PATH=str(stubs) + ':' + str(source / '.local/bin') + ':' + os.environ['PATH'], WORKFLOW_LOG=str(log), BROWSER='workflow-browser', EDITOR='workflow-editor', TERMINAL='xterm', id='fixture', DISPLAY='', WAYLAND_DISPLAY='', XDG_CACHE_HOME=str(pilot / 'cache'))
    results = []
    def events():
        time.sleep(.12)
        return [json.loads(line) for line in log.read_text().splitlines()]
    def check(name, ok, evidence):
        results.append({'test': name, 'pass': bool(ok), 'evidence': evidence})
    jpg = data / 'image space.jpg'
    p = run([source / '.config/nsxiv/exec/key-handler', 'x'], input=str(jpg) + '\n', env=env)
    es = [e for e in events() if e['cmd'] == 'xclip' and 'payload_hex' in e]
    mime = run(['file', '-b', '--mime-type', jpg]).stdout.strip()
    check('image clipboard MIME matches JPEG bytes', bool(es) and es[-1]['argv'][-2] == mime and es[-1]['payload_hex'].startswith('ffd8'), [{'argv': e['argv'], 'signature': e['payload_hex'][:16]} for e in es])
    for name in ['image space.png', 'image space.bmp', 'image space.tiff', ' image [x]*? "quote" \\slash.png ']:
        image = data / name
        start = len(events())
        run([source / '.config/nsxiv/exec/key-handler', 'x'], input=name + '\n', cwd=data, env=env)
        es = [e for e in events()[start:] if e['cmd'] == 'xclip' and 'payload_hex' in e]
        mime = run(['file', '-b', '--mime-type', image]).stdout.strip()
        check('nsxiv exact path and MIME ' + name, len(es) == 1 and es[0]['argv'] == ['-selection', 'clipboard', '-target', mime, name] and es[0]['payload_hex'] == image.read_bytes().hex(), [{'argv': e['argv'], 'signature': e['payload_hex'][:16]} for e in es])
    for names in [['image space.jpg', 'image space.png'], ['image space.png', 'image space.jpg']]:
        start = len(events())
        run([source / '.config/nsxiv/exec/key-handler', 'x'], input='\n'.join(names) + '\n', cwd=data, env=env)
        es = [e for e in events()[start:] if e['cmd'] == 'xclip' and 'payload_hex' in e]
        check('nsxiv first marked only ' + names[0], len(es) == 1 and es[0]['argv'][-1] == names[0], es)
    start = len(events())
    run([source / '.config/nsxiv/exec/key-handler', 'x'], input='missing synthetic image\n', cwd=data, env=env)
    es = events()[start:]
    check('nsxiv missing file does not publish', not any(e['cmd'] == 'xclip' for e in es), es)
    lfrc = (source / '.config/lf/lfrc').read_text()
    body = lfrc.split('cmd open ${{\n', 1)[1].split('\n}}', 1)[0]
    lfopen = pilot / 'lf-open-body.sh'; lfopen.write_text("IFS='\n'\n" + body)
    for name in ['literal[x].txt', 'star*.txt', 'question?.txt', 'text space "quote" \\slash [x]*?.txt', ' leading trailing .txt', 'document space.pdf', 'silent space.mp4']:
        f = data / name
        start = len(events())
        p = run(['/bin/sh', '-eu', lfopen], cwd=data, env=dict(env, f=str(f), fx=str(f), IFS='\n'), timeout=10)
        es = events()[start:]
        expected = 'workflow-editor' if name.endswith('.txt') else ('zathura' if name.endswith('.pdf') else 'mpv')
        check('LF exact argv ' + name, any(e['cmd'] == expected and e['argv'] == ([str(f), '-quiet'] if expected == 'mpv' else [str(f)]) for e in es), {'events': es, 'stderr': p.stderr})
    for name in ['image space.png', 'image space.jpg', 'image space.bmp', 'image space.tiff', 'image space.jpe',
                 'extensionless [x]*? \\name', '.hidden [x]*? \\name.png',
                 '.hidden extensionless', 'literal [x]*? \\name.png', ' image [x]*? "quote" \\slash.png ']:
        f = data / name
        start = len(events())
        p = run(['/bin/sh', '-eu', lfopen], cwd=data, env=dict(env, f=str(f), fx=str(f)), timeout=10)
        es = events()[start:]
        import re
        ordered = run(['ls', '-1A', data]).stdout.splitlines()
        pos = ordered.index(name)
        expected = [entry for entry in ordered[pos:] + ordered[:pos]
                    if entry == name or re.search(r'\.(png|jpg|jpe|jpeg|gif|webp|avif|bmp|tif|tiff|ico)(_large)*$', entry, re.I)]
        viewers = [e.get('stdin', '').splitlines() for e in es if e['cmd'] == 'nsxiv']
        check('LF selected image first once and directory order ' + name,
              viewers == [expected] and expected[0] == name and expected.count(name) == 1, es)
    f = data / 'vector space.svg'; start = len(events())
    p = run(['/bin/sh', '-eu', lfopen], cwd=data, env=dict(env, f=str(f), fx=str(f)), timeout=10)
    es = events()[start:]
    check('LF SVG installed browser route', any(e['cmd'] == 'workflow-browser' and e['argv'] == [str(f)] for e in es), {'events': es, 'stderr': p.stderr})
    first, second = data / 'literal[x].txt', data / 'text space "quote" \\slash [x]*?.txt'
    start = len(events())
    run(['/bin/sh', '-eu', lfopen], cwd=data, env=dict(env, f=str(first), fx=str(first) + '\n' + str(second)))
    es = events()[start:]
    check('LF multiple exact argv', any(e['cmd'] == 'workflow-editor' and e['argv'] == [str(first), str(second)] for e in es), es)
    check('ordinary LF Enter stays shell', 'map <enter> shell' in lfrc, 'map <enter> shell')
    for name in ['image space.png', 'image space.jpg', 'image space.bmp', 'image space.tiff', 'document space.pdf', 'silent space.mp4']:
        p = run([source / '.config/lf/scope', data / name, '80', '20', '0', '0'], env=env, timeout=20)
        check('metadata preview without ueberzug ' + name, 'no image preview installed' in p.stdout or 'General' in p.stdout or 'Image' in p.stdout, {'status': p.returncode, 'stdout': p.stdout[:240], 'stderr': p.stderr[:240]})
    (pilot / (args.label + '-results.json')).write_text(json.dumps(results, indent=2) + '\n')
    for r in results: print(('PASS ' if r['pass'] else 'FAIL ') + r['test'])
    print(f"{sum(r['pass'] for r in results)}/{len(results)} passed; {pilot / (args.label + '-results.json')}")
    return 0 if all(r['pass'] for r in results) else 1


if __name__ == '__main__':
    sys.exit(main())
