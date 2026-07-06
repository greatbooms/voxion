# Codex Instructions

이 파일은 `src/storage` 하위에 적용됩니다.

## 역할

로컬 파일 저장소의 경로 생성, 업로드 이동, 완료 후 artifact cleanup을 담당하는 모듈입니다.

저장 구조:

```text
storage/
  tmp/uploads/
  originals/{recordingId}/
  normalized/{recordingId}/normalized.mp3
  chunks/{recordingId}/000000.mp3
  transcripts/{recordingId}/chunks/000000.json
  transcripts/{recordingId}/final.json
```

## 주요 파일

- `storage.service.ts`: safe path 생성, 원본 저장/이동, parent directory 생성, artifact cleanup
- `storage.module.ts`: StorageService provider
- `storage.service.spec.ts`: path traversal 방지, filename sanitize, cleanup 보존/삭제 정책 검증

## 주의사항

- 모든 경로는 storage root 안에 있어야 합니다.
- recording id는 UUID 형식만 허용합니다.
- original filename은 sanitize해서 저장합니다.
- 완료 후 cleanup은 원본/정규화/chunk/raw JSON을 삭제하고 `final.json`은 보존합니다.
- 처리 중 실패 복구를 위해 워커가 완료 처리하기 전에는 artifact cleanup을 호출하면 안 됩니다.
