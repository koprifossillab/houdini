# Houdini Production Control

Thermal Collapse 영상 제작 관제실입니다. 다크 테마의 조회 전용 웹서비스이고, `/Houdini/` 하위 경로에서 독립 컨테이너로 돌아갑니다.

> 상태 (2026-11-02): v0.1.1 배포 후보입니다(독립 검증 F1–F4 반영). push, `main` 병합, 운영 컨테이너, Nginx·포털 연결은 승인 전입니다.

## 화면이 보여 주는 것

| 화면 | 내용 | 자료 출처 |
|---|---|---|
| 상단 | 수집 자료 연결 상태, 마지막 수집 시각과 경과 시간, 열람 권한 | 수집기 |
| 계산 실행 | **계산 실행 여부는 늘 '미확인'**(계산 전용 근거가 없음). 따로 표시: 관련 프로세스 감지 / 없음 / 확인 불가(자료가 3분 넘게 오래됨), Blender PC 워커 큐 개수 | 수집기 |
| 제작 단계 | TC-00(02·03·03R·04) → TC-01 → TC-02 → TC-03 → TERRAIN | 수동 기록 |
| 관제 개요 | Houdini 제작, 독립 검증, Blender, Work, 총괄 감독의 상태와 근거 | 수집기 + 기록 메모 |
| 검증·승인 | V2·V3·V5 진단, 독립 검증 의견, 남은 문제, 감독 판정 시간순 기록 | 수동 기록 |
| 미리보기 | 해시가 맞는 이미지·영상만 표시. 출처(물리 계산·절차적·렌더·예시)와 샘플링·주의 문구 | 미디어 목록(git 밖) |
| 보고서 | 수집기 사본을 먼저 쓰고, 없으면 제작 저장소의 가림 처리된 사본을 씀. 일반 글자로만 표시 | 수집기 / 저장소 |
| 실험·재현 | 실험 묶음별 결과 수, 코드 해시 대조(일치 / 일부 없음 / 불일치 · 재현성 미확보 / 검증 불가 / 없음), 무효·대체 표시, 고정된 Python·패키지 판 | 제작 저장소 manifest |
| 데이터 상태 | 출처별 상태(정상·지연·누락·오류)와 출처 종류(수집·기록·저장소·예시) | 전체 |

실제 데이터와 예시 데이터는 다음과 같이 구분합니다.
- 응답마다 `provenance`(`collected`, `recorded`, `repository`, `example`) 값이 붙습니다.
- `HPC_DEMO=1`일 때만 예시 값을 내보냅니다. 이때 화면 맨 위에 줄무늬 경고 띠가 고정으로 뜹니다.

## 구조

```
control/            웹서비스 (Node.js 22, 외부 의존성 없음)
  server.mjs        라우팅 · 하위 경로 · 호스트 허용 목록 · 권한 · 보안 헤더 · /healthz
  lib/collector.mjs 기존 1분 수집기 출력 읽기(읽기 전용)
  lib/ledger.mjs    제작 저장소 manifest → 실험 이력 · 재현 정보
  lib/media.mjs     미디어 허용 목록 · SHA-256 확인 · Range
  lib/auth.mjs      HTTP Basic + scrypt (설정이 없으면 잠금)
  lib/sanitize.mjs  내부 경로·주소·비밀값 가리기
  data/records.json 감독 판정 · 단계 · V2/V3/V5 수동 기록
  public/           화면 (HTML · CSS · JS, 인라인 스크립트 없음)
  test/             node:test 자동 시험
deploy/
  srv/              운영 compose · env 예시
  nginx/            HTTPS server 블록(새 파일) · HTTP→HTTPS 이동 조각(include 한 줄)
  www/              서비스가 멈췄을 때 보여 줄 안내 페이지
  portal/           포털 카드 제안 (적용 안 함)
  README.md         배포 · 롤백 · 승인 항목
```

## 로컬 실행

```bash
cd control
npm test                                       # 자동 시험
HPC_DEMO=1 HPC_AUTH=off PORT=18097 node server.mjs   # 예시 데이터로 보기
# 실제 자료: HPC_COLLECTOR_DIR, HPC_LEDGER_DIR, HPC_MEDIA_DIR, HPC_MEDIA_MANIFEST 를 로컬에서만 지정
```

`HPC_AUTH=off`는 루프백(127.0.0.1)에서만 허용됩니다. 그 외 주소에서 켜면 서버가 시작을 거부합니다.

## 경계

- 이 서비스는 아무 데도 쓰지 않습니다. 수집기, cron, 제작 저장소, NAS, 포털 파일 모두 마찬가지입니다.
- 계산 실행, 승인 기록, 세션 조작, 초 단위 관측 기능은 없습니다. 3–5초 관측 장치는 미승인입니다.
- `/healthz`를 뺀 모든 화면과 API는 인증이 필요합니다. 운영에서는 HTTPS(신뢰 프록시와 토큰)가 전제이고, 평문 요청에는 인증을 묻지 않고 403으로 거절합니다.
- 인증(scrypt)은 비동기로 처리합니다. 동시 처리와 실패 횟수에 상한이 있고, 넘으면 해싱 없이 429를 돌려줍니다.
- 이 저장소는 공개 저장소입니다. 서버 경로, 계정, 호스트 이름은 런타임 설정(`.env`)에만 둡니다.

Work 프로토타입에서 가져온 부분은 [`docs/REUSE_FROM_WORK.md`](docs/REUSE_FROM_WORK.md)에 정리했습니다.
사람이 브라우저로 확인할 항목은 [`docs/VERIFICATION_CHECKLIST.md`](docs/VERIFICATION_CHECKLIST.md)에 있습니다.
