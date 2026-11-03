import importlib.util,json,tempfile,os
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'scripts/team_live_collect.py'
s=importlib.util.spec_from_file_location('collector_scope',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp)
 for key in ['approved','unrelated']:
  folder=root/'projects'/key;folder.mkdir(parents=True)
  (folder/'a.jsonl').write_text(json.dumps({'type':'assistant','timestamp':'2026-11-03T00:00:00Z','message':{'id':key,'model':'claude-opus-5-5','usage':{'input_tokens':10,'output_tokens':2}}})+'\n')
 cache={};rows=m.scan_tokens(str(root),cache,['approved'])
 assert len(rows)==1 and rows[0][1]=='approved'
 assert all('unrelated' not in x for x in cache['files'])
 assert m.PRICES['claude-sonnet-5-5']['cache_read']==0.1
 try:m.transcript_paths(str(root),['../unrelated'])
 except ValueError:pass
 else:raise AssertionError('escaped allowlist accepted')
 print('PASS approved project-only scan; excluded project untouched; traversal blocked; official Sonnet cache rate')
