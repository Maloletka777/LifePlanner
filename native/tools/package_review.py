from pathlib import Path
import zipfile, hashlib, json
root=Path(__file__).resolve().parents[1]
destination=root.parent/'LivePlanner-Swift-Review.zip'
entries=[]
parts=['Package.swift','.gitignore','README.md','START-HERE-RU.md','AppleApp','AppleUITests','Sources','Tests','Vendor','LivePlanner.xcodeproj','docs']
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as archive:
    for part in parts:
        source=root/part
        if not source.exists(): continue
        files=sorted(source.rglob('*')) if source.is_dir() else [source]
        for file in files:
            if not file.is_file(): continue
            relative=file.relative_to(root).as_posix()
            data=file.read_bytes(); archive.writestr('LivePlanner-Swift/'+relative,data)
            entries.append({'path':relative,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
with zipfile.ZipFile(destination) as check:
    assert check.testzip() is None
    for entry in entries:
        assert hashlib.sha256(check.read('LivePlanner-Swift/'+entry['path'])).hexdigest()==entry['sha256']
report={'archive':destination.name,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'files':entries}
destination.with_suffix('.manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(f'Verified review archive: {len(entries)} files, {destination.stat().st_size} bytes')
