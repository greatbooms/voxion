# Codex Instructions

이 파일은 `src/jobs` 하위에 적용됩니다.

## 역할

녹음 전사 작업을 BullMQ로 비동기 처리하는 모듈입니다.

주요 기능:

- recording id 기반 job enqueue
- durable `JobRun.id`와 BullMQ job id 연결
- 워커에서 전체 전사 파이프라인 orchestration
- 처리 상태와 실패 사유를 PostgreSQL에 기록
- BullMQ 재시도 상태에 맞춰 recording/job 상태 갱신

## 주요 파일

- `transcription.queue.ts`: queue enqueue와 job 상태 조회
- `transcription.processor.ts`: 오디오 정규화, 청킹, STT, 병합, Notion 업로드, cleanup orchestration
- `jobs.module.ts`: producer module과 worker module 분리
- `jobs.constants.ts`: queue/job 이름 상수

## 처리 순서

1. recording 조회
2. duration probing
3. normalized MP3 생성
4. chunk 생성 및 `RecordingChunk` metadata 저장
5. chunk별 OpenAI STT
6. transcript 병합과 final JSON 저장
7. Notion page 생성/재사용 및 transcript append
8. `Recording`/`JobRun` 완료 처리
9. 완료된 recording artifact cleanup

## 주의사항

- cleanup은 반드시 완료 상태 저장 뒤에 best-effort로 실행합니다.
- 재시도 시 completed chunk metadata가 현재 계획과 같으면 STT를 재호출하지 않습니다.
- metadata가 바뀐 completed chunk는 transcriptPath/text를 초기화하고 다시 전사합니다.
- BullMQ retry가 남아 있으면 recording을 `FAILED`로 확정하지 않습니다.
- `removeOnFail`을 무한 보존으로 두지 않습니다. 개인용 로컬 Redis라도 실패 job이 계속 쌓일 수 있습니다.
