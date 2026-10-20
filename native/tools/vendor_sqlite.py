"""Pin an official SQLite amalgamation, verifying its published SHA3-256."""
from pathlib import Path
import urllib.request, re, hashlib, zipfile, io, json
root = Path(__file__).resolve().parents[1]
page = urllib.request.urlopen('https://www.sqlite.org/download.html').read().decode()
row = re.search(r'PRODUCT,([^,]+),([^,]*sqlite-amalgamation-[^,]+),([^,]+),([a-f0-9]{64})', page)
if not row:
    raise SystemExit('Official download metadata not found')
version, relative, size, expected = row.groups()
url = 'https://www.sqlite.org/' + relative
data = urllib.request.urlopen(url).read()
assert len(data) == int(size)
assert hashlib.sha3_256(data).hexdigest() == expected
out = root / 'Vendor' / 'SQLite'
(out / 'include').mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    for name in ('sqlite3.c', 'sqlite3.h'):
        entry = next(p for p in archive.namelist() if p.endswith('/' + name))
        (out / ('include/' if name.endswith('.h') else '') / name).write_bytes(archive.read(entry))
(out / 'PROVENANCE.json').write_text(json.dumps({'version': version, 'source': url, 'archive_sha3_256': expected,
    'licence': 'Public domain; see source header and https://www.sqlite.org/copyright.html'}, indent=2))
print(f'SQLite {version}: official SHA3-256 verified')
