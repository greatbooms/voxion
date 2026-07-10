# Codex 작업 지침

이 파일은 저장소 전체에 적용되는 Codex 작업 지침입니다.
하위 디렉터리에 더 가까운 `AGENTS.md`가 생기면 해당 지침도 함께 적용합니다.

## Serena 사용

코드 작업을 시작할 때 Serena initial instructions를 먼저 읽고, 가능한 경우 symbolic tools로 필요한 심볼만 탐색합니다.

단순 텍스트 검색은 `rg`를 우선 사용합니다. 큰 파일을 통째로 읽기보다 필요한 심볼, 테스트, 설정 파일을 좁혀서 확인합니다.

## Git 작업 규칙

작업 전 `git status --short --branch`로 현재 브랜치와 미커밋 변경을 확인합니다.

사용자가 만든 미커밋 변경을 되돌리거나 덮어쓰지 않습니다. 관련 없는 변경은 그대로 두고, 같은 파일에 섞여 있으면 먼저 맥락을 확인합니다.

기본 통합 브랜치는 `main`입니다. 코드 변경 작업을 시작할 때는 `main`을 최신 원격 상태로 pull/fetch 받은 뒤, 그 최신 `main`을 기준으로 작업 브랜치를 생성합니다.

작업 브랜치 이름은 Conventional Commits 타입을 앞에 둔 형태를 사용합니다.
예: `feat/notion-retry-state`, `fix/storage-cleanup`, `chore/update-agent-instructions`

커밋 메시지는 Conventional Commits 형식을 따르되, 설명은 한국어로 작성합니다.
예: `feat: 녹음 업로드 API 추가`, `fix: 완료 후 임시 파일 정리`, `chore: 에이전트 작업 지침 갱신`

`git push`는 사용자가 명시적으로 요청했을 때만 실행합니다. PR 생성도 사용자가 명시적으로 요청했을 때만 진행합니다.

## 프로젝트 개요

Voxion은 개인용 녹음 전사 자동화 서버입니다.

주요 흐름:

1. `POST /recordings`로 오디오 파일을 업로드합니다.
2. API 서버가 원본 파일 메타데이터를 PostgreSQL에 저장하고 BullMQ 작업을 큐에 넣습니다.
3. 워커가 `ffmpeg`/`ffprobe`로 길이를 확인하고 mono 64k MP3로 정규화합니다.
4. OpenAI STT 업로드 제한을 넘지 않도록 정규화 파일을 청크로 나눕니다.
5. 각 청크를 OpenAI STT로 전사하고 문장 단위로 병합합니다.
6. Notion data source에 페이지를 만들고 transcript와 chunk timestamp를 append합니다.
7. 완료 후 큰 로컬 산출물은 정리하고, DB/Notion/final transcript만 남깁니다.

## 주요 디렉터리와 역할

| 경로 | 역할 |
| --- | --- |
| `src/auth` | 관리자 로그인, 세션 쿠키, API token 인증 |
| `src/web` | 브라우저 업로드 화면, job 상태 polling, transcript 표시 |
| `src/recordings` | 업로드 API, 녹음 조회 API, job 조회 API, 업로드 검증 |
| `src/jobs` | BullMQ 큐 설정과 전사 워커 orchestration |
| `src/audio` | ffmpeg 기반 duration probing, MP3 정규화, silence 기반 청킹 |
| `src/transcription` | OpenAI STT 호출과 chunk transcript 병합 |
| `src/notion` | Notion page 생성, transcript block append, 재시도 중복 방지 |
| `src/storage` | storage root 아래 파일 경로 생성, 업로드 이동, 완료 후 artifact cleanup |
| `src/config` | 환경변수 schema와 app config |
| `src/health` | 컨테이너/NAS 배포용 얕은 health endpoint |
| `src/prisma` | Prisma service/module |
| `prisma` | Prisma schema와 migration |

## 코딩 컨벤션

- TypeScript/NestJS 기존 패턴을 우선 따릅니다.
- 파일명은 기존처럼 kebab-case를 사용합니다.
- Nest provider는 module 경계를 유지해서 주입합니다.
- Prisma schema 변경 시 migration과 관련 테스트를 함께 고려합니다.
- 외부 API(OpenAI, Notion, Redis, PostgreSQL)는 테스트에서 mock/stub을 우선 사용합니다.
- 파일 경로는 `StorageService`를 통해 만들고, storage root 밖으로 나가지 않도록 검증합니다.
- 로컬 파일 cleanup은 best-effort로 처리합니다. cleanup 실패가 완료된 전사 작업을 실패로 바꾸면 안 됩니다.
- OpenAI STT 언어 코드는 `ko-KR` 같은 region tag가 아니라 `ko`, `en` 같은 primary subtag로 전달합니다.
- OpenAI 파일 제한을 고려해 chunk size 기본값은 25MB보다 낮게 유지합니다.

## 테스트와 검증

동작 변경은 테스트를 먼저 추가하거나 기존 테스트를 갱신한 뒤 구현합니다.

자주 쓰는 검증 명령:

```sh
npm run build
npm run lint
npx prisma validate
npm test -- --runInBand
```

Supertest 기반 전체 테스트는 로컬 HTTP listen 권한이 필요할 수 있습니다. 샌드박스에서 `listen EPERM`이 발생하면 같은 명령을 권한 상승으로 재실행합니다.

특정 영역만 빠르게 확인할 때:

```sh
npm test -- src/jobs/transcription.processor.spec.ts --runInBand
npm test -- src/storage/storage.service.spec.ts --runInBand
npm test -- src/recordings/recordings.controller.spec.ts --runInBand
```

## 운영상 주의사항

- 업로드 원본은 크기가 클 수 있으므로 완료 후 불필요한 산출물이 남지 않게 유지합니다.
- 전사 재시도 중에는 완료된 chunk text를 재사용하므로, 처리 중 파일 cleanup을 넣으면 안 됩니다.
- Notion append는 재시도 가능해야 합니다. `Voxion Transcript`, `Voxion Chunks` marker 중복 처리와 stale block 정리를 깨지 않도록 주의합니다.
- BullMQ job id는 DB `JobRun.id`와 맞춰 추적합니다.
- Redis는 다른 프로젝트와 공유될 수 있으므로 `REDIS_KEY_PREFIX`를 존중합니다.
- `.env`에는 실제 키를 넣을 수 있지만, `.env.example`에는 비밀값을 넣지 않습니다.

## 변경 시 체크리스트

1. 관련 모듈의 기존 테스트를 확인합니다.
2. 실패하는 테스트로 기대 동작을 먼저 고정합니다.
3. 최소 범위로 구현합니다.
4. build, lint, Prisma validate, Jest를 실행합니다.
5. 변경 범위가 요청과 직접 관련된 파일에 한정되는지 `git diff --stat`으로 확인합니다.
