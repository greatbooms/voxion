# Codex Instructions

이 파일은 `src/notion` 하위에 적용됩니다.

## 역할

전사 결과를 Notion data source/page에 안전하게 기록하는 모듈입니다.

주요 기능:

- recording metadata로 Notion page 생성
- `Recording Id` 속성이 있으면 기존 page 검색 후 재사용
- `Voxion Transcript` marker 아래 transcript block append
- `Voxion Chunks` marker 아래 chunk timestamp summary append
- 재시도 시 이미 append된 block을 감지해 중복 append 방지
- stale/incomplete block 정리 후 재동기화
- Notion rate limit 계열 오류에서 `Retry-After` 기반 backoff

## 주요 파일

- `notion.service.ts`: Notion client 호출과 retry/idempotency 처리
- `notion-blocks.ts`: Notion rich text 제한에 맞춘 transcript paragraph split
- `notion.service.spec.ts`: page 생성, append 재시도, stale block 정리 검증
- `notion-blocks.spec.ts`: grapheme-safe block split 검증

## 주의사항

- Notion rich text content limit을 넘지 않도록 block split을 유지합니다.
- marker text는 재시도 idempotency의 기준이므로 임의 변경하지 않습니다.
- stale block 삭제에는 Notion integration의 Update content 권한이 필요합니다.
- append가 중간에 실패한 경우를 항상 고려합니다. marker만 있고 본문이 없거나 chunk summary 일부만 있는 상태도 복구해야 합니다.
