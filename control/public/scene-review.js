// Local visual proposal only. No production writes or simulation controls.
(() => {
  const root=document.getElementById('scene-review');
  const toggle=document.getElementById('theme-toggle');
  function setTheme(dark){document.documentElement.dataset.theme=dark?'dark':'light';toggle.textContent=dark?'라이트 모드':'다크 모드';toggle.setAttribute('aria-pressed',String(dark));}
  setTheme(false);
  toggle.addEventListener('click',()=>setTheme(document.documentElement.dataset.theme!=='dark'));
  const el=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k==='text')n.textContent=v;else if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else n.setAttribute(k,String(v));}for(const c of children.flat())if(c)n.append(c);return n;};
  let scene='A',source='pc_houdini',revision='',frame='',manifest={assets:[]},failure=false;
  const sourceLabels={pc_houdini:'PC Houdini 생성물 · 물리 검증 별도',server_proxy:'서버 프록시 · Houdini 결과 아님'};
  const sceneNames={A:'변형 전',B:'초기 인장',C:'파열',D:'이동'};
  const safeMedia=s=>typeof s==='string'&&/^media\/[a-z0-9_-]{1,60}$/.test(s);
  const label=t=>el('span',{class:'tag',text:t});
  function render(){
    const items=manifest.assets.filter(x=>x.scene===scene&&x.source_kind===source);
    const versions=[...new Set(items.map(x=>x.version))];
    if(!versions.includes(revision))revision=versions[0]||'';
    const selector=el('select',{'aria-label':'제작 버전',onchange:e=>{revision=e.target.value;render();}},...versions.map(v=>el('option',{value:v,text:v})));
    if(!versions.length){selector.append(el('option',{text:'결과 미수신',value:''}));selector.disabled=true;}selector.value=revision;
    const origin=el('select',{'aria-label':'결과 출처',onchange:e=>{source=e.target.value;render();}},...Object.entries(sourceLabels).map(([value,text])=>el('option',{value,text})));origin.value=source;
    const frames=[...new Set(items.filter(x=>x.version===revision).map(x=>x.frame_label))];
    if(!frames.includes(frame))frame=frames[0]||'';
    const frameSelector=el('select',{'aria-label':'검수 프레임',onchange:e=>{frame=e.target.value;render();}},...frames.map(v=>el('option',{value:v,text:v})));
    if(!frames.length){frameSelector.append(el('option',{value:'',text:'프레임 미확인'}));frameSelector.disabled=true;}frameSelector.value=frame;
    const cameras=['front','three_quarter'];
    const cards=cameras.map(camera=>{
      const matches=items.filter(x=>x.camera===camera&&x.version===revision&&x.frame_label===frame);
      const a=matches.length===1?matches[0]:null;
      const verified=a&&a.integrity==='verified'&&a.decoded===true&&safeMedia(a.media_url)&&
        (source!=='pc_houdini'||a.pc_execution_verified===true);
      const cameraName=camera==='front'?'정면':'3/4';
      let visual=el('div',{class:'shot-screen'},el('span',{class:'waiting-mark',text:camera==='front'?'FRONT':'¾ VIEW'}),el('strong',{text:failure?'자료 확인 불가':matches.length>1?'중복 등록 · 확인 필요':a?'미디어 검증 대기':'실제 프리뷰 미수신'}),el('small',{text:'장면 이미지를 임의로 생성하거나 대신 표시하지 않습니다.'}));
      if(verified){visual=el(a.kind==='video'?'video':'img',a.kind==='video'?{src:a.media_url,controls:'',preload:'metadata','aria-label':`${scene} ${cameraName} ${a.version}`}:{src:a.media_url,alt:`${scene} ${cameraName} ${a.version}`});visual.addEventListener('error',()=>visual.replaceWith(el('div',{class:'shot-screen',text:'파일 표시 실패 · 재검증 필요'})));}
      const values=['제작 버전',a?.version||'미수신','프레임',a?.frame_label||'미확인','원래 FPS',a?.fps!=null?String(a.fps):'미확인','파일 근거',verified?'존재·해시·디코드 확인':a?'검증 대기':'미등록','생성 시각',a?.generated_at||'미확인'];
      return el('figure',{class:'shot'},el('div',{class:'shot-head'},el('h3',{text:`장면 ${scene} · ${cameraName}`}),label(verified?(a.representation==='viewport_proxy'?'PC Houdini 뷰포트 · 절차적 프록시':sourceLabels[source]):'미수신 / 미검증')),visual,el('figcaption',{},el('dl',{class:'shot-meta'},...values.map((text,i)=>el(i%2?'dd':'dt',{text})))));
    });
    root.replaceChildren(
      el('div',{class:'scene-top'},el('div',{},el('small',{class:'eyebrow',text:'DIRECTOR REVIEW / SHOT COMPARISON'}),el('h2',{text:'Thermal Collapse · 장면 검수'}),el('p',{class:'scene-subtitle',text:'A–D의 카메라·프레임·버전을 비교합니다. 파일 검증과 감독의 시각 판정은 별개입니다.'})),label('첫 박스 블로킹 수신 대기')),
      el('nav',{class:'scene-nav','aria-label':'장면 선택'},...['A','B','C','D'].map(id=>el('button',{'aria-pressed':id===scene,onclick:()=>{scene=id;render();}},el('strong',{text:id}),el('span',{text:`장면 ${id} · ${sceneNames[id]}`}),el('small',{text:manifest.assets.some(a=>a.scene===id)?'등록 자료 있음':'검수 자료 미수신'})))),
      el('article',{class:'panel'},el('div',{class:'scene-toolbar'},el('div',{},el('h2',{text:`장면 ${scene} · 동일 버전 카메라 비교`}),el('p',{text:'버전·프레임이 다른 자료를 동일 조건으로 간주하지 않습니다.'})),el('label',{},el('span',{text:'출처'}),origin),el('label',{},el('span',{text:'버전'}),selector),el('label',{},el('span',{text:'프레임'}),frameSelector)),el('div',{class:'scene-grid'},...cards)),
      el('div',{class:'review-bottom'},el('article',{class:'panel'},el('div',{class:'panel-head'},el('h2',{text:'장면별 시각 검수 기준'}),label('첫 결과 도착 후 판정')),el('ul',{class:'review-checks'},...[
        ['색상','층별 색 구분과 장면 간 일관성'],['지층 노출','절개·침식 면의 층서 가독성'],['산맥 연속성','프레임 간 지형 연결과 팝 현상'],['브레치아 이동','조각의 접촉·이동·최종 위치']
      ].map(([b,s])=>el('li',{},el('b',{text:b}),el('span',{text:s+' · 미검수'}))))),
      el('article',{class:'panel'},el('div',{class:'panel-head'},el('h2',{text:'감독 의견 · 우선순위'}),label('감독 기록')),el('p',{class:'director-note',text:items.find(x=>x.version===revision)?.director_note||'이 장면에 대한 감독의 이미지 판정은 아직 등록되지 않았습니다.'}),el('p',{text:'다음: 실제 정면·3/4 프리뷰 수신 → 장면별 결함 비교 → 수정 우선순위 전달'}))),
      el('p',{class:'review-status',text:failure?'등록 목록을 읽지 못했습니다. 이전 자료를 현재 결과로 표시하지 않습니다.':'출처 정책: 서버 프록시는 PC Houdini 결과로 표시하지 않습니다. 실제 PC 실행 증거·산출물 해시·디코드 확인 후에만 결과를 연결합니다. 원본 경로는 이 화면에 노출하지 않습니다.'})
    );
  }
  render();
  fetch('static/scene-review.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(d.schema!=='tc-scene-review/1'||!Array.isArray(d.assets))throw Error();manifest=d;render();}).catch(()=>{failure=true;render();});
})();
