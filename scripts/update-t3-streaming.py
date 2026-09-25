#!/usr/bin/env python3
"""Check or update the pristine T3 streaming sources. Never runs upstream code."""
import argparse, hashlib, json, re, urllib.request, os, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'t3-streaming.lock.json'
def sha(data):return hashlib.sha256(data).hexdigest()
def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Relay-source-updater'}),timeout=30) as response:
        data=response.read(4*1024*1024+1)
    if len(data)>4*1024*1024:raise ValueError('Upstream file exceeds the update limit')
    return data
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref',help='Exact upstream commit; defaults to current main for a read-only check')
    parser.add_argument('--update',action='store_true',help='Replace pristine sources and update the lock (requires --ref)')
    args=parser.parse_args()
    if args.update and not args.ref:parser.error('--update requires an explicit commit via --ref')
    if args.ref and not re.fullmatch('[a-f0-9]{40}',args.ref):parser.error('--ref must be a full commit SHA')
    lock=json.loads(MANIFEST.read_text())
    ref=args.ref or json.loads(fetch('https://api.github.com/repos/pingdotgg/t3code/commits/main'))['sha']
    catalog=fetch(f'https://raw.githubusercontent.com/pingdotgg/t3code/{ref}/pnpm-workspace.yaml').decode()
    match=re.search(r'^  effect: [\"\']?(4[^\s\"\']+)',catalog,re.M)
    if not match:raise SystemExit('Cannot identify upstream Effect version. Check the upstream dependency layout before updating.')
    effect=match.group(1)
    installed=json.loads((ROOT/'package.json').read_text())['dependencies']['effect']
    if effect!=installed:
        print(f'Upstream requires effect@{effect}; app pins {installed}.')
        if args.update:raise SystemExit(f'Update the dependency deliberately (npm install --save-exact effect@{effect}), then rerun this command and the regression checks.')
    replacements=[]
    for entry in lock['files']:
        local=ROOT/entry['local']
        if sha(local.read_bytes())!=entry['sha256']:raise SystemExit(f'Local edits detected in {entry["local"]}. Move adapters outside vendored source before updating.')
        data=fetch(f'https://raw.githubusercontent.com/pingdotgg/t3code/{ref}/{entry["upstream"]}')
        replacements.append((entry,local,data))
        print(('changed ' if sha(data)!=entry['sha256'] else 'same    ')+entry['local'])
    print(f'Pinned {lock["commit"]}; candidate {ref}')
    if not args.update:
        print('Read-only check. To update, rerun with --update --ref '+ref)
        return
    # Fetch and validate everything before replacing anything. Keep originals so
    # an I/O failure cannot leave half of an update installed.
    originals={local:local.read_bytes() for _,local,_ in replacements}
    originals[MANIFEST]=MANIFEST.read_bytes()
    def atomic(path,data):
        with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as tmp:
            tmp.write(data);temp=Path(tmp.name)
        try:os.replace(temp,path)
        finally:temp.unlink(missing_ok=True)
    try:
        for entry,local,data in replacements:
            atomic(local,data);entry['sha256']=sha(data)
        lock['commit']=ref;lock['effect']=effect
        atomic(MANIFEST,(json.dumps(lock,indent=2)+'\n').encode())
    except Exception:
        for path,data in originals.items():atomic(path,data)
        raise
    print('Sources updated. Run npm run test:streaming and npm run build before accepting this update. Check upstream Effect compatibility if transport types changed.')
if __name__=='__main__':main()
