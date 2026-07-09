# Health Module

## 책임

컨테이너와 외부 배포 시스템이 호출하는 얕은 헬스체크 엔드포인트입니다.

## 주요 컴포넌트

- `health.controller.ts` — `GET /health` 요청에 `{ status: 'ok', timestamp }` 응답

## 외부 의존성

- 없음. DB, Redis, OpenAI, Notion 상태를 확인하지 않습니다.

## 주의사항

- 별도 module 없이 `AppModule.controllers`에 직접 등록합니다.
- 인증이 필요 없는 public endpoint로 유지합니다.
- 비밀값, 내부 파일 경로, 외부 API 상태를 응답에 포함하지 않습니다.
