# Codex Instructions

이 파일은 `src/transcription` 하위에 적용됩니다.

## 역할

OpenAI STT 호출과 chunk transcript 병합을 담당하는 모듈입니다.

주요 기능:

- OpenAI audio transcription API 호출
- local chunk file stream 업로드
- OpenAI 언어 코드 normalize
- chunk별 transcript text 정규화
- chunk 순서 정렬
- forced split overlap에서 발생한 boundary 중복 텍스트 제거
- 문장 경계 기준 paragraph 재구성

## 주요 파일

- `openai-transcription.service.ts`: OpenAI SDK 호출
- `transcript-merge.service.ts`: chunk text 병합과 paragraph 구성
- `transcription.module.ts`: transcription provider 구성
- `*.spec.ts`: OpenAI 호출 입력, 언어 normalize, merge behavior 검증

## 주의사항

- `OPENAI_API_KEY`가 없으면 명확한 precondition error를 반환합니다.
- region-qualified language tag는 OpenAI에 그대로 전달하지 않습니다.
- overlap 중복 제거는 실제 텍스트 손실 위험이 있으므로 boundary prefix/suffix 기준으로 보수적으로 처리합니다.
- merge 결과는 Notion append와 final transcript JSON에 그대로 사용됩니다.
