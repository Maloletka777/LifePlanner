"""Read this migration's GitHub Actions evidence using local Git authentication.
Credentials are used only in memory and never written to logs or files.
"""
from pathlib import Path
import urllib.request, json, subprocess, sys
root = Path(__file__).resolve().parents[1]
repo = 'Maloletka777/LifePlanner'
class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None:
            redirected.remove_header('Authorization')
        return redirected
opener = urllib.request.build_opener(SafeRedirect())
def request(path, authenticated=False):
    headers={'Accept':'application/vnd.github+json','User-Agent':'LivePlanner-validation'}
    if authenticated:
        result=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=True)
        credentials=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
        headers['Authorization']='Bearer '+credentials['password']
    return opener.open(urllib.request.Request('https://api.github.com/repos/'+repo+path,headers=headers))
runs=json.load(request('/actions/runs?branch=swift-migration&per_page=1'))['workflow_runs']
if not runs: raise SystemExit('No validation runs yet')
run=runs[0]
print(json.dumps({k:run[k] for k in ('id','status','conclusion','html_url')}))
jobs=json.load(request(f"/actions/runs/{run['id']}/jobs"))['jobs']
for job in jobs:
    print(json.dumps({'job':job['id'],'status':job['status'],'steps':[(s['name'],s['status'],s['conclusion']) for s in job['steps']]}))
    if job['status']=='completed':
        log=request(f"/actions/jobs/{job['id']}/logs",True).read().decode('utf-8','replace')
        out=root/'.tools'; out.mkdir(exist_ok=True)
        (out/f"github-job-{job['id']}.log").write_text(log,encoding='utf-8')
        for line in log.splitlines():
            if any(word in line for word in ('error:', 'failed', '** BUILD', '** TEST','Executed ')):
                print(line[:1000])
