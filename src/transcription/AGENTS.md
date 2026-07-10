# Codex Instructions

이 파일은 `src/transcription` 하위에 적용됩니다.

## 역할

OpenAI STT 호출, chunk transcript 병합, 후처리, 시간코드 부여를 담당하는 모듈입니다.

주요 기능:

- OpenAI audio transcription API 호출
- STT prompt와 이전 chunk context 전달
- local chunk file stream 업로드
- OpenAI 언어 코드 normalize
- chunk별 transcript text 정규화
- chunk 순서 정렬
- forced split overlap에서 발생한 boundary 중복 텍스트 제거
- 문장 경계 기준 paragraph 재구성
- 선택적 OpenAI 텍스트 후처리
- chunk timing 기반 추정 시간코드 부여

## 주요 파일

- `openai-transcription.service.ts`: OpenAI SDK 호출
- `transcript-merge.service.ts`: chunk text 병합과 paragraph 구성
- `transcript-post-processor.service.ts`: 선택적 transcript 보정
- `transcript-timeline.service.ts`: Notion 탐색용 추정 시간코드 생성
- `transcription.module.ts`: transcription provider 구성
- `*.spec.ts`: OpenAI 호출 입력, 언어 normalize, merge behavior 검증

## 주의사항

- `OPENAI_API_KEY`가 없으면 명확한 precondition error를 반환합니다.
- region-qualified language tag는 OpenAI에 그대로 전달하지 않습니다.
- diarize 모델은 prompt를 지원하지 않으므로 prompt payload를 보내지 않습니다.
- overlap 중복 제거는 실제 텍스트 손실 위험이 있으므로 boundary prefix/suffix 기준으로 보수적으로 처리합니다.
- final transcript JSON에는 raw merge 결과, 후처리 결과, 추정 시간코드가 붙은 최종 text를 함께 보존합니다.
