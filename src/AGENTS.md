# Codex Instructions

이 파일은 `src` 하위 코드 전체에 적용되는 작업 지침입니다.
더 가까운 하위 디렉터리의 `AGENTS.md`가 있으면 해당 지침도 함께 적용합니다.

## 공통 NestJS 구조

- 모듈은 `*.module.ts`, 서비스는 `*.service.ts`, 컨트롤러는 `*.controller.ts` 패턴을 유지합니다.
- 테스트는 구현 파일 옆에 `*.spec.ts`로 둡니다.
- 외부 시스템(OpenAI, Notion, Redis, PostgreSQL, ffmpeg)은 단위 테스트에서 직접 호출하지 않고 mock/stub 처리합니다.
- API 응답에서 서버 내부 파일 경로, raw transcript payload, 비밀값을 노출하지 않습니다.

## 상태 흐름

녹음 처리 상태는 대략 아래 순서를 따릅니다.

`UPLOADED` -> `QUEUED` -> `PROBING` -> `CHUNKING` -> `TRANSCRIBING` -> `MERGING` -> `UPLOADING_TO_NOTION` -> `COMPLETED`

실패 시 BullMQ 재시도가 남아 있으면 `QUEUED`로 되돌리고, 최종 실패에서만 `FAILED`로 둡니다.

## 변경 시 주의사항

- 워커 처리 중에는 재시도를 위해 원본/정규화/청크 파일이 필요합니다.
- 완료 이후 cleanup은 가능하지만, 완료 상태와 job 상태가 DB에 먼저 저장된 뒤 실행해야 합니다.
- chunk metadata가 바뀌면 기존 completed chunk text를 재사용하면 안 됩니다.
- Notion append는 중간 실패 후 재시도해도 중복 block을 만들지 않아야 합니다.
