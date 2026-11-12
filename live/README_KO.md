# Thermal Collapse LIVE — 형상 확인용 3D 중계 시제품

- 감독 결정 22에 따른 **독립 시제품**입니다.
- 운영 관제실(/Houdini/), nginx, 운영 컨테이너와는 연결되지 않습니다.
- 이 화면은 **형상 확인용**입니다. Karma 렌더가 아니며, 시각 승인 근거로 쓰지 않습니다.

## 실행 (서버)

```
cd live
LIVE_PORT=18100 LIVE_MESH_DIR=<형상 폴더> LIVE_STATUS_FILE=<① 진행 상태 파일> LIVE_HANDOFF_DIR=<인계 카드 폴더> node server.mjs
```

- **바인딩:** 루프백(127.0.0.1)만 허용합니다. 다른 주소를 주면 서버가 시작하지 않습니다.
- **요청:** GET·HEAD 만 받습니다. 그 밖의 요청은 모두 405 로 거부합니다.
- **테스트 장면:** `node scripts/make-test-data.mjs <출력 폴더> 48` 로 만듭니다. 실제 모델이 아닌 합성 장면이며, 화면에도 "테스트 데이터"로 표시됩니다.
- **시험:** `npm test`

## 사용자 PC 접속 (SSH 포트 전달)

Windows PowerShell 에서 실행합니다. Windows 10/11 에는 OpenSSH 클라이언트가 기본으로 들어 있습니다.

```
ssh -p 2022 -N -L 18100:127.0.0.1:18100 <계정>@<서버 주소>
```

- 창을 열어 둔 채로 브라우저에서 `http://localhost:18100/` 을 엽니다.
- 접속을 끝내려면 PowerShell 창에서 Ctrl+C 를 누릅니다.

## 형상 폴더 형식 (`tc-live-frames/1`)

- `index.json`:

```
{ "schema": "tc-live-frames/1", "model_sha256": "<64자>", "label": "…",
  "frames": [ { "frame": 1, "file": "f0001.bin", "source": "production | viewer | test", "sha256": "<64자>" } ] }
```

- `fNNNN.bin`: TCM1 이진 메시 형식입니다.
  - 꼭짓점 위치(f32)
  - 꼭짓점별 요소 번호(u8): 0 분홍, 1 회색, 2 파란 몸체, 3 파란 기저 조각
  - 삼각형 색인(u32)
  - 자세한 형식은 `lib/mesh.mjs` 머리말에 있습니다.

## ① 진행 상태 파일 형식 (`tc-live-status/1`) — 설계안, ① 과 합의 전

감독 결정 22 4항의 항목을 따로 기록합니다.

```
{ "schema": "tc-live-status/1",
  "task_id": "TC-VIS-030",                       // 작업 ID
  "candidate": "br1 9b60ced",                    // 후보 이름(+커밋)
  "model_sha256": "<64자>",                      // 후보 모델 파일 해시
  "stage": "idle | computing | checking | done | failed | stopped",   // 현재 실행 단계
  "frames_total": 300,
  "last_completed_frame": 112,                   // 마지막 완료 프레임
  "current_frame": 113,                          // 진행 중인 프레임
  "completed_frames": [1, 2, …, 112],            // ① 이 계산을 마친 프레임 목록
  "updated_at": "2026-11-12T11:20:00+09:00",     // 최종 갱신 시각
  "checks": { "source": "selfcheck | p2check rev4 | …", "state": "running | done | none",
              "items": { "D1": { "value": 0.0091, "limit": 0.01, "result": "PASS", "frame": 230 } } } }   // 검사 결과의 출처와 상태
```

- **원자적 갱신:** ① 의 후속 실행기가 프레임 하나를 끝낼 때마다 이렇게 갱신합니다.
  1. 같은 폴더의 임시 파일(`status.json.tmp`)에 씁니다.
  2. `fsync` 합니다.
  3. `rename` 으로 바꿉니다.

  그래서 뷰어는 반쯤 쓰인 파일을 읽지 않습니다.
- **현재 시험 8 실행 스크립트는 수정하지 않습니다.** 시험 8 이 끝난 뒤 후속 실행기에만 적용합니다(감독 결정 22 4항).
- **"① 계산 완료" 표시 조건:** 아래 두 가지가 모두 맞을 때만 그렇게 표시합니다.
  - 상태 파일의 `model_sha256` 이 형상 폴더의 해시와 같음
  - 그 프레임이 `completed_frames` 에 있음

  뷰어가 계산한 프레임은 "뷰어 계산 — ① 계산 완료 아님"으로 표시합니다. 테스트 프레임은 "테스트 데이터"로 표시합니다.
- **시간 표시:** 갱신 시각이 10 분보다 오래되었거나 미래 시각이면 "지금 상태 미확인"으로 표시합니다.

## QA 판정

- 인계 카드 폴더의 `TC-QA/` 카드 가운데, 진행 상태 파일의 후보 이름과 같은 카드만 읽기 전용으로 보여 줍니다.
- 판정·범위·시각·제목을 표시하며, 최대 8 건입니다.
- 판정을 바꾸거나 새로 쓰는 기능은 없습니다.
