# Codex Instructions

이 파일은 `src/auth` 하위에 적용됩니다.

## 역할

관리자 로그인, 세션 쿠키, API token 기반 인증을 제공하는 모듈입니다.

주요 기능:

- `GET /login`: 관리자 로그인 화면
- `POST /auth/login`: 환경변수 기반 관리자 로그인
- `POST /auth/logout`: 관리자 세션 쿠키 삭제
- 전역 guard로 보호된 route 인증
- 브라우저는 HttpOnly 세션 쿠키, 외부 API는 bearer token 또는 `X-API-Key` 사용

## 주요 파일

- `admin-auth.service.ts`: credential 검증, HMAC session token 생성/검증, API token 검증
- `admin-auth.guard.ts`: 전역 인증 guard와 HTML 요청 redirect 처리
- `auth.controller.ts`: 로그인/로그아웃 route
- `auth.module.ts`: 전역 guard 등록
- `public.decorator.ts`: 인증 제외 route marker

## 주의사항

- `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `API_ACCESS_TOKEN` 값을 로그나 응답에 노출하지 않습니다.
- 보호 대상 API를 새로 추가할 때는 기본적으로 guard가 적용되도록 두고, 공개 endpoint만 `@Public()`을 붙입니다.
- 세션 쿠키는 HttpOnly를 유지합니다.
- API token 비교는 timing-safe 비교를 유지합니다.
