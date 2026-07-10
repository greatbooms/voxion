# Codex Instructions

이 파일은 `src/web` 하위에 적용됩니다.

## 역할

개인용 브라우저 업로드 화면을 제공하는 모듈입니다.

주요 기능:

- `GET /`: `/upload`로 redirect
- `GET /upload`: 녹음 파일 업로드 화면 렌더링
- 브라우저에서 기존 `POST /recordings`, `GET /jobs/:id`, `GET /recordings/:id/transcript` API 호출

## 주요 파일

- `web.controller.ts`: upload 화면 route
- `upload-page.ts`: 서버 렌더링 HTML/CSS/JS
- `web.module.ts`: web controller 등록

## 주의사항

- 업로드 처리는 기존 recordings API를 사용하고, web 모듈에서 파일 저장/큐 등록 로직을 중복 구현하지 않습니다.
- 화면은 관리자용 도구이므로 과한 랜딩 페이지 구성을 피하고 업로드/상태/결과 확인에 집중합니다.
- `/upload`은 전역 auth guard 보호를 받습니다. 공개 화면이 필요할 때만 의도적으로 `@Public()`을 붙입니다.
