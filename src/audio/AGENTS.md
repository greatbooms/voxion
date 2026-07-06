# Codex Instructions

이 파일은 `src/audio` 하위에 적용됩니다.

## 역할

오디오 파일을 OpenAI STT에 넣기 좋은 형태로 준비하는 모듈입니다.

주요 기능:

- `ffprobe`로 원본 오디오 길이 확인
- `ffmpeg`로 mono 64k MP3 정규화
- `ffmpeg silencedetect`로 무음 구간 탐지
- 무음 경계를 우선 사용해 청크 계획 생성
- 무음이 없으면 시간 기준으로 강제 분할
- 강제 분할 시 경계 단어 손실을 줄이기 위해 2초 overlap 적용
- 생성된 청크가 목표 용량을 넘으면 더 작은 구간으로 재분할

## 주요 파일

- `audio.service.ts`: duration probing, 정규화, silence 탐지, 청크 생성
- `ffmpeg-runner.ts`: ffmpeg/ffprobe child process 실행 래퍼
- `audio.service.spec.ts`: 청크 계획과 ffmpeg 호출 검증
- `ffmpeg-runner.spec.ts`: command runner 실패/출력 처리 검증

## 주의사항

- OpenAI 업로드 제한보다 낮은 `CHUNK_TARGET_BYTES`를 전제로 청크를 만듭니다.
- 청크 파일 경로는 직접 조립하지 말고 `StorageService.chunkPath()`를 사용합니다.
- forced split overlap은 transcript merge 단계에서 중복 제거 대상이므로 metadata에 보존해야 합니다.
- `-c copy`로 자른 청크가 예상보다 커질 수 있으므로 size check와 재분할 로직을 유지합니다.
