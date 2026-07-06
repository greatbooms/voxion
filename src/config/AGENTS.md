# Codex Instructions

이 파일은 `src/config` 하위에 적용됩니다.

## 역할

환경변수를 검증하고 애플리케이션 설정 객체로 노출하는 모듈입니다.

주요 기능:

- Zod schema로 `.env` 값 검증
- PostgreSQL, Redis, OpenAI, Notion, storage, upload limit 설정 관리
- 문자열 boolean과 숫자 환경변수를 안전하게 변환
- Nest provider에서 사용할 `AppConfigService` 제공

## 주요 파일

- `env.schema.ts`: 환경변수 schema와 기본값
- `app-config.service.ts`: typed config accessor
- `app-config.module.ts`: ConfigModule 구성

## 주의사항

- `.env.example`에는 실제 API key나 비밀번호를 넣지 않습니다.
- OpenAI STT chunk 기본값은 25MB 제한보다 낮게 유지합니다.
- Redis key prefix는 다른 프로젝트와 공유될 수 있으므로 기본값 변경 시 README도 함께 갱신합니다.
- 환경변수 추가/변경 시 `env.schema.spec.ts`, `app-config.service.spec.ts`, `.env.example`, README를 함께 확인합니다.
