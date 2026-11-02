# 포털 카드 추가 제안 (A5 — 포털 운영자 승인 필요, 아직 적용하지 않음)

포털 첫 화면은 그룹(`section.group`) 안에 카드(`a.item`)를 두는 구조입니다. 관제실은 계산 결과를 보여 주는 서비스가 아니라 제작 관제 화면입니다. 그래서 기존 "Coding work" 그룹 옆에 그룹을 새로 하나 만들거나, 그 그룹에 카드 한 장을 더하는 두 가지 방법을 제안합니다.

## 제안 1 — 기존 그룹에 카드 한 장

```html
<a class="item" href="/Houdini/">
  <span class="item-icon">🎬</span>
  <span class="item-title">Houdini Production Control</span>
  <span class="item-desc">Thermal Collapse production board — stages, verification, approvals.</span>
</a>
```

## 제안 2 — 새 그룹 "Production"

```html
<section class="group">
  <div class="group-head">
    <span class="group-title">Production</span>
    <span class="group-sub">Film &amp; simulation control</span>
  </div>
  <div class="items">
    <!-- 제안 1 의 카드 -->
  </div>
</section>
```

## 바탕 그림(선택)

포털의 카드 바탕 스크립트에 `{ href: '/Houdini/', acc, load, draw }`를 추가할 수 있습니다.
- `load`는 `/Houdini/healthz`만 읽습니다. 인증이 필요 없고, 경로를 담지 않으며, 응답이 작습니다.
- 다섯 단계를 막대로 그리고, `degraded`이면 엷게 표시합니다.
- 이 바탕 그림은 운영자가 따로 판단하고, 필수가 아닙니다.

## 적용 순서(운영자)

1. 포털 `index.html`을 백업합니다. 기존 관례대로 `index.html.bak-<날짜>` 이름을 씁니다.
2. 위 카드 한 장(또는 그룹)만 넣습니다. 다른 부분은 고치지 않습니다.
3. Nginx 연결(A4)과 서비스 기동(A3)이 끝난 **뒤에** 넣습니다. 그래야 빈 링크가 생기지 않습니다.
