# Codex Instructions

이 파일은 `src/recordings` 하위에 적용됩니다.

## 역할

외부 HTTP API를 통해 녹음 업로드, 녹음 조회, 전사 결과 조회, job 상태 조회를 제공하는 모듈입니다.

주요 기능:

- `POST /recordings`: multipart audio upload 처리
- `GET /recordings/:id`: 녹음 metadata와 chunk 상태 조회
- `GET /recordings/:id/transcript`: 완료된 최종 transcript 조회
- `GET /jobs/:id`: DB job 상태와 BullMQ 실시간 상태 조회
- 업로드 파일 MIME/크기 검증
- upload temp file을 storage originals 경로로 이동
- queue handoff 실패 시 recording/job 상태 정리

## 주요 파일

- `recordings.controller.ts`: recording API route
- `jobs.controller.ts`: job 상태 API route
- `recordings.service.ts`: upload validation, DB 생성, storage 저장, queue enqueue, response mapping
- `recording-upload.interceptor.ts`: multer disk storage 기반 multipart 처리
- `dto/create-recording.dto.ts`: upload form field DTO

## 주의사항

- 큰 파일 업로드를 고려해 multer disk storage를 유지합니다. 메모리 buffering으로 되돌리지 않습니다.
- validation 실패 또는 DB/storage 초기 실패 시 temp upload를 best-effort로 삭제합니다.
- API 응답에는 서버 내부 파일 경로(`originalPath`, `normalizedPath`, chunk path, transcriptPath)를 노출하지 않습니다.
- transcript endpoint는 `COMPLETED` 전에는 `409 Conflict`를 반환해야 합니다.
- language는 OpenAI 호환을 위해 primary subtag로 normalize합니다.
