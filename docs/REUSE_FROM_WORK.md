# Work 프로토타입 재사용 내역

출처: Work의 로컬 프로토타입. 원본 저장소 작업 폴더의 `dashboard/`에 있으며 아직 커밋되지 않았습니다. 2026-11-02에 읽기 전용으로 확인했고, 원본 파일은 고치거나 옮기지 않았습니다. 필요한 부분만 이 브랜치에 다시 작성했습니다.

| Work 원본 | 여기서 | 처리 |
|---|---|---|
| `server.mjs` `clean()` | `control/lib/sanitize.mjs` | **재사용 + 보강**. v0.1.1에서 경로 규칙을 다시 작성함(시스템 경로는 항상 가리고 프로젝트 상대 경로는 남김. 실제 보고서의 가림이 67곳에서 14곳으로 줄었고 유출 0). 실제 보고서로 시험하다 찾은 빈틈 2개를 막음(하이픈 들어간 호스트 이름, 가린 경로 앞에 붙은 폴더 이름). 공개 소스에 적을 수 없는 이름은 런타임 `HPC_REDACT_TERMS`로 가림 |
| `readBounded()` | `control/lib/sanitize.mjs` | 재사용 (심볼릭 링크·크기 제한) |
| `snapshot()` | `control/lib/collector.mjs` | 재사용 + 확장. 오래된 자료(180초 초과)면 실행 주장을 지우는 규칙은 그대로. 추가: `reported_state`(마지막 값), `waiting`, 예시 모드 |
| `reportText()` | `collectorReport()` + 저장소 대체 | 재사용 + 확장. 수집기 사본이 없으면 제작 저장소의 가림 처리된 보고서로 대체 |
| 미디어 manifest·해시 확인 | `control/lib/media.mjs` | 재사용 + 확장. 출처·샘플링·주의 문구 항목, Range(영상 탐색), 해시 확인 캐시 |
| 보안 헤더·CSP | `control/server.mjs` | 재사용 + 강화. `default-src 'none'`, `Referrer-Policy`, `Permissions-Policy`, `form-action 'none'` |
| `records.json` | `control/data/records.json` | 재사용 + 갱신. 2026-11-02 결정(코드 이전, 웹서비스 지시, 관측 장치 미승인)을 추가하고, TC-00 아래 단계(02·03·03R·04)를 표시 |
| `OBSERVER_RESEARCH.md` | 반영만 | 관측 장치는 구현하지 않음(미승인). 원칙(관측 ≠ 계산 증명, 최신이 아니면 '확인 불가')은 화면 문구에 반영 |
| 시험 9개 | `control/test/collector.test.mjs` W1–W7, `http.test.mjs` W8–W9 | 옮겨서 새 구조에 맞춤. 모두 통과 |
| `public/*` 화면 | — | **재사용 안 함**. 새로 디자인함(스튜디오 관제 화면). 색 토큰 몇 개만 참고 |

## 프로토타입에서 바꾼 점

| 항목 | 프로토타입 | 이 서비스 |
|---|---|---|
| 호스트 | `localhost`만 허용 | 허용 목록(`HPC_ALLOWED_HOSTS`) |
| 리슨 주소 | `127.0.0.1` 고정 | 설정 가능. 컨테이너는 `0.0.0.0`이지만 바깥 포트는 루프백에만 엶 |
| 경로 | 절대 경로(`/api/...`) | 상대 경로. `/Houdini/` 접두어를 붙여도 떼어도 받음 |
| 권한 | 없음 | healthz를 뺀 전부에 HTTP Basic + 비동기 scrypt, 횟수 제한 적용. 설정이 없으면 잠금. 운영은 HTTPS 전제 |
| 기능 | — | 추가: 헬스 체크, 컨테이너, compose, Nginx 조각, 배포·롤백 문서 |
