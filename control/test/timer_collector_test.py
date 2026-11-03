import importlib.util,os,time
from pathlib import Path
p=Path(__file__).with_name('team_live_collect_test.py')
s=importlib.util.spec_from_file_location('timer_env',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
e=m.Env()
try:
 proc=e.sleeper();sid='aaaaaaaa-0000-0000-0000-000000000001'
 e.register(proc.pid,sid,'TC-PROD-TIMER-FIXTURE',e.start['TC-PROD'],'busy')
 e.transcript(sid,[('claude-opus-5-5',100)])
 log=Path(e.home)/'projects/proj'/f'{sid}.jsonl';os.utime(log,(time.time()-3600,time.time()-3600))
 teams,doc=e.run();assert teams['TC-PROD']['execution']['state']=='STALE';assert teams['TC-PROD']['execution']['process_alive'] is True
 assert teams['TC-PROD']['execution']['activity_recent'] is False
 print('PASS registry heartbeat cannot refresh old work activity')
 start=teams['TC-PROD']['session']['started_at']
 e.unregister(proc.pid);teams,doc=e.run()
 assert teams['TC-PROD']['execution']['state']=='STALE' and teams['TC-PROD']['execution']['process_alive'] is True
 print('PASS registry missing while same process alive is not STOPPED')
 e.register(proc.pid,sid,'TC-PROD-TIMER-FIXTURE',e.start['TC-PROD'],'busy');os.utime(log,None)
 teams,doc=e.run();assert teams['TC-PROD']['execution']['state']=='RUNNING'
 assert teams['TC-PROD']['session']['started_at']==start
 print('PASS fresh transcript activity observed; confirmed original start retained')
 proc.kill();proc.wait();teams,doc=e.run()
 assert teams['TC-PROD']['execution']['state']=='STOPPED' and teams['TC-PROD']['execution']['process_alive'] is False
 assert teams['TC-PROD']['previous_session']['started_at']==start
 stopped=teams['TC-PROD']['previous_session']['stopped_at']
 teams,doc=e.run();assert teams['TC-PROD']['previous_session']['stopped_at']==stopped
 print('PASS isolated process stop preserves start and fixed confirmed end')
finally:e.close()
