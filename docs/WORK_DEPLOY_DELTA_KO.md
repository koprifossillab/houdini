# Work 운영 통합 보완
운영 기준 521b1c1과 QA 705377a를 no-ff 병합했다. main 및 제작 worktree는 변경하지 않았다.
운영 설정은 승인된 Houdini/TC 작업 경로의 토큰·세션만 관측한다. 다른 프로젝트 기록은 열지 않는다.
관측 범위 전체는 서버 전체 연구 사용량이 아니다. 설정 scope_label을 화면에 표시한다.
공식 pricing 문서의 Sonnet 5.5 캐시 읽기 $0.10/M을 반영했다.
가격 출처: https://platform.claude.com/docs/en/about-claude/pricing (2026-11-03 확인).
기존 UI·보고서·미디어·인증·Nginx는 보존한다. Production Link는 미포함이다.
