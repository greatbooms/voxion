# Voxion

녹음 파일을 업로드하면 OpenAI speech-to-text로 전사하고, 완료된 전사 결과를 Notion 데이터 소스에 페이지로 올리는 개인용 NestJS 서비스입니다.

## 주요 흐름

1. `POST /recordings`로 오디오 파일을 업로드합니다.
2. API 서버가 원본 파일과 작업 정보를 저장하고 BullMQ 작업을 큐에 넣습니다.
3. 워커가 `ffmpeg`로 오디오를 mono 64k MP3로 정규화합니다.
4. OpenAI 업로드 제한을 넘지 않도록 정규화된 파일을 `CHUNK_TARGET_BYTES` 이하 청크로 나눕니다.
5. 각 청크를 OpenAI STT에 보내고 결과를 문장 단위로 재구성해 병합합니다.
6. Notion 데이터 소스에 페이지를 만들고 `Voxion Transcript` 섹션 아래에 전사문을, `Voxion Chunks` 섹션 아래에 청크 타임스탬프를 append합니다.
7. 완료 후 원본 업로드, 정규화 MP3, 청크 MP3, 청크별 raw JSON을 삭제합니다. 최종 전사 텍스트는 DB와 Notion에 남고, 작은 `final.json`만 로컬에 보존합니다.

청크 분할은 `ffmpeg silencedetect`로 찾은 무음 경계를 우선 사용하고, 무음이 없으면 시간 기준으로 강제 분할합니다. 강제 분할 시에는 경계에서 단어가 잘리지 않도록 다음 청크가 2초 overlap을 두고 시작합니다. 잘라낸 청크가 목표 용량을 넘으면 자동으로 절반씩 재분할합니다. 긴 파일도 처리할 수 있도록 기본 청크 목표값은 `24_000_000` bytes, 기본 청크 최대 길이는 `1200`초로 보수적으로 잡았습니다.

완료 후 파일 정리는 best-effort입니다. 디스크 잠금이나 권한 문제로 정리에 실패해도 전사 작업은 완료 처리되고, 서버 로그에 경고가 남습니다.

## 필요 조건

- Node.js 20 이상
- npm
- `ffmpeg`, `ffprobe`
- PostgreSQL
- Redis
- OpenAI API key
- Notion integration token과 Notion table data source ID

macOS에서 `ffmpeg`가 없다면:

```sh
brew install ffmpeg
ffmpeg -version
ffprobe -version
```

Ubuntu 계열에서는:

```sh
sudo apt-get update
sudo apt-get install -y ffmpeg
```

## 환경 변수 준비

로컬 개발용 `.env`를 만듭니다.

```sh
cp .env.example .env
```

`.env.example`에는 로컬 PostgreSQL/Redis 기본값이 들어 있고, 외부 서비스 키는 비워져 있습니다. 현재 기본 연결값은 아래 형태입니다.

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/voxion_db?schema=public&connection_limit=5"
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...
ADMIN_SESSION_SECRET=...
API_ACCESS_TOKEN=...
```

이미 다른 프로젝트에서 Docker로 띄운 PostgreSQL/Redis를 사용할 경우, 해당 컨테이너의 포트, 비밀번호, DB 이름에 맞게 `.env`만 수정하면 됩니다. Redis에 비밀번호가 있으면 `REDIS_PASSWORD`에 넣습니다.

## 관리자 인증 설정

브라우저 업로드 화면과 `recordings/jobs` API는 관리자 인증으로 보호됩니다. `.env` 또는 NAS의 `.env.prod`에 아래 값을 설정합니다.

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=긴-비밀번호
ADMIN_SESSION_SECRET=openssl-rand-hex-32-결과
ADMIN_SESSION_TTL_SECONDS=86400
ADMIN_COOKIE_SECURE=false
API_ACCESS_TOKEN=외부-API-호출용-긴-랜덤-토큰
```

`ADMIN_SESSION_SECRET`은 세션 쿠키 서명에 사용합니다. 아래처럼 생성할 수 있습니다.

```sh
openssl rand -hex 32
```

`ADMIN_COOKIE_SECURE=true`는 HTTPS에서만 쿠키를 전송합니다. NAS reverse proxy를 HTTPS로 운영할 때 켭니다. HTTP로 직접 접속하는 로컬 개발 환경에서는 `false`로 둡니다.

`API_ACCESS_TOKEN`은 다른 프로젝트나 자동화 스크립트에서 API를 직접 호출할 때 사용합니다. 요청 헤더는 `Authorization: Bearer <token>` 또는 `X-API-Key: <token>` 둘 중 하나를 사용하면 됩니다.

## OpenAI API key 발급

1. OpenAI Platform의 [API keys 페이지](https://platform.openai.com/api-keys)에 접속합니다.
2. 사용할 project를 선택한 뒤 새 secret key를 만듭니다.
3. 생성 직후에만 전체 key가 보이므로 바로 복사합니다. 잃어버리면 새 key를 만들어야 합니다.
4. `.env`에 넣습니다.

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_TRANSCRIPTION_PROMPT="한국어 회의 녹취입니다. 자주 나오는 용어: CMT, Notion, PostgreSQL."
OPENAI_TRANSCRIPTION_CONTEXT_CHARS=1200
OPENAI_POST_PROCESSING_ENABLED=true
OPENAI_POST_PROCESSING_MODEL=gpt-4.1
OPENAI_POST_PROCESSING_PROMPT="문단을 나누고 명백한 STT 오류만 보정하세요. 요약하거나 새 내용을 추가하지 마세요."
OPENAI_POST_PROCESSING_MAX_INPUT_CHARS=24000
OPENAI_POST_PROCESSING_MAX_CHUNKS=8
DEFAULT_TRANSCRIPTION_LANGUAGE=ko
```

추천 흐름은 `gpt-4o-transcribe`로 전사 품질을 유지하고, `OPENAI_TRANSCRIPTION_PROMPT`로 회의 용어를 주입한 뒤, `OPENAI_POST_PROCESSING_ENABLED=true`일 때 후처리 모델로 문단/띄어쓰기/명백한 오인식을 보정하는 방식입니다. 후처리는 추가 OpenAI 텍스트 모델 호출 비용이 발생하므로 비용을 막고 싶으면 `false`로 둡니다.

Notion 본문에는 각 문단 앞에 `[~HH:MM:SS]` 형식의 추정 시간이 붙습니다. 이 시간은 STT 모델이 반환한 정확한 단어 timestamp가 아니라, chunk 시작/끝 시간과 텍스트 위치를 기준으로 계산한 탐색용 시간코드입니다. 나중에 원본 파일을 다시 들을 위치를 찾는 용도로 사용하세요.

화자 구분이 꼭 필요한 새 업로드는 모델을 아래처럼 바꿀 수 있습니다.

```env
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
CHUNK_MAX_DURATION_SECONDS=600
```

이 모델을 쓰면 앱은 OpenAI에 `diarized_json` 응답을 요청하고, Notion 본문에 `A: ...`, `B: ...` 또는 `speaker_0: ...`, `speaker_1: ...` 형식으로 발화자를 보존합니다. 다만 diarize 모델은 prompt와 timestamp granularities를 지원하지 않고, 같은 길이의 일반 STT보다 느릴 수 있으므로 현재 기본 추천값은 아닙니다. 기존에 일반 `gpt-4o-transcribe`로 전사된 결과에는 speaker segment가 없으므로, 기존 전사문을 화자 구분으로 바꾸려면 오디오를 diarize 모델로 다시 전사해야 합니다.

OpenAI Help Center도 API key는 [API key page에서 생성/관리](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key)한다고 안내합니다. key는 소스코드나 Git에 커밋하지 마세요. 이 저장소의 `.gitignore`는 `.env`를 제외하도록 설정되어 있습니다.

## Notion 연동 준비

이 앱은 Notion API `2026-03-11` 버전과 data source API를 사용합니다.

### 1. Notion integration 만들기

1. Notion [Developer portal](https://www.notion.so/profile/integrations)에 접속합니다.
2. 새 internal connection을 만듭니다. 개인용이면 internal connection이 가장 단순합니다.
3. Capabilities에서 최소한 아래 권한을 켭니다.
   - Read content: 기존 transcript 블록을 확인해 재시도 시 중복 append를 피하기 위해 필요합니다.
   - Insert content: 페이지 생성과 transcript 블록 append에 필요합니다.
   - Update content: stale transcript 블록을 정리하고 재시도할 때 필요합니다.
4. Configuration 탭에서 installation access token을 복사합니다.
5. `.env`에 넣습니다.

```env
NOTION_TOKEN=secret_...
NOTION_VERSION=2026-03-11
```

Notion 공식 quickstart도 internal connection 생성, access token 확인, 페이지 권한 부여를 기본 절차로 안내합니다: [Notion Developer quickstart](https://developers.notion.com/guides/get-started/quick-start).

### 2. 전사 결과를 받을 Notion 데이터 소스 만들기

Notion에서 새 database 또는 data source를 만들고 아래 속성을 정확한 이름과 타입으로 추가합니다.

| 속성 이름 | 타입 |
| --- | --- |
| `Name` | Title |
| `Status` | Select |
| `Language` | Text |
| `Model` | Text |
| `Duration Seconds` | Number |
| `Original Filename` | Text |
| `File Size MB` | Number |
| `Chunk Count` | Number |
| `Recorded At` | Date |
| `Uploaded At` | Date |
| `Recording Id` | Text (선택) |

`Status` select에는 최소 `Completed` 값을 추가해 두는 것을 권장합니다.

`Recording Id` 속성은 선택 사항입니다. 추가해 두면 워커가 재시도할 때 이미 만들어진 페이지를 recording ID로 찾아 재사용하므로, 드물게 발생할 수 있는 중복 페이지 생성을 막을 수 있습니다. 속성이 없어도 동작에는 문제가 없습니다.

그 다음 Notion 페이지나 데이터베이스 우측 상단 `...` 메뉴에서 `Add connections`를 눌러 방금 만든 integration을 연결합니다. 연결하지 않으면 Notion API가 `403` 또는 `404`로 실패할 수 있습니다.

### 3. `NOTION_TABLE_DATA_SOURCE_ID` 찾기

`NOTION_TABLE_DATA_SOURCE_ID`에는 Notion 페이지의 `Copy link`에서 보이는 database ID가 아니라, 그 database 안의 table data source ID를 넣어야 합니다.

가장 쉬운 방법은 Notion 데이터베이스 설정 메뉴에서 `Manage data sources`로 들어가 `Copy data source ID`를 사용하는 것입니다. Notion 문서도 database를 retrieve해서 `data_sources` 목록을 확인하거나 data source를 직접 조회하는 방법을 안내합니다: [Retrieve a data source](https://developers.notion.com/reference/retrieve-a-data-source).

복사한 값을 `.env`에 넣습니다.

```env
NOTION_TABLE_DATA_SOURCE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

하이픈이 포함된 UUID 형태여도 됩니다.

예를 들어 Notion 화면 링크에 보이는 database ID와 API에 넣는 table data source ID는 서로 다를 수 있습니다. 이 프로젝트는 Notion API의 `data_source_id` parent에 페이지를 생성하므로 table data source ID가 필요합니다.

## 설치

```sh
npm install
npm run prisma:generate
```

DB가 아직 없다면 먼저 생성합니다.

```sh
psql "postgresql://postgres:postgres@localhost:5432/postgres" \
  -c 'CREATE DATABASE voxion_db;'
```

이미 `voxion_db`가 있으면 위 명령은 건너뜁니다. 그 다음 마이그레이션을 적용합니다.

```sh
npm run prisma:migrate -- --name init
```

## 실행

터미널 1개에서 API 서버를 실행합니다.

```sh
npm run start:dev
```

다른 터미널에서 워커를 실행합니다.

```sh
npm run start:worker
```

기본 API 주소는 `http://localhost:3000`입니다.

브라우저 업로드 화면은 아래 주소로 접속합니다.

```text
http://localhost:3000/upload
```

로그인 후 파일, 제목, 언어, 녹음일을 입력해 업로드할 수 있습니다. 업로드가 끝나면 화면에서 job 상태를 polling하고, 완료되면 전사 결과를 표시합니다.

## API 사용 예시

아래 예시는 `API_ACCESS_TOKEN`을 설정한 경우입니다. 브라우저 화면에서 업로드할 때는 로그인 세션 쿠키가 자동으로 사용됩니다.

녹음 파일 업로드:

```sh
curl -X POST http://localhost:3000/recordings \
  -H "Authorization: Bearer ${API_ACCESS_TOKEN}" \
  -F "file=@/path/to/meeting.m4a;type=audio/m4a" \
  -F "title=팀 미팅" \
  -F "language=ko" \
  -F "recordedAt=2026-07-03T09:00:00+09:00"
```

상태 조회:

```sh
curl -H "Authorization: Bearer ${API_ACCESS_TOKEN}" \
  http://localhost:3000/recordings/00000000-0000-4000-8000-000000000001
```

전사 결과 조회:

```sh
curl -H "Authorization: Bearer ${API_ACCESS_TOKEN}" \
  http://localhost:3000/recordings/00000000-0000-4000-8000-000000000001/transcript
```

전사가 완료되기 전에는 transcript endpoint가 현재 상태와 함께 `409 Conflict`를 반환합니다.

작업(job) 진행 상태 조회:

```sh
curl -H "Authorization: Bearer ${API_ACCESS_TOKEN}" \
  http://localhost:3000/jobs/00000000-0000-4000-8000-000000000003
```

`POST /recordings` 응답의 `jobId`를 사용합니다. DB에 기록된 작업 상태와 함께, Redis에 접근 가능하면 BullMQ 큐의 실시간 상태(`queue.state`, 진행률, 실패 사유)도 반환합니다.

## 유용한 명령

```sh
npm run build
npm run lint
npm test -- --runInBand
npx prisma validate
```

## NAS 배포

Synology NAS 배포는 `GitHub Actions + GHCR + Tailscale + SSH + Docker Compose` 방식으로 구성되어 있습니다.

관련 파일:

- `.github/workflows/deploy.yml`
- `Dockerfile`
- `deploy/compose.yml`
- `scripts/deploy-synology.sh`
- `docs/deployment-guide.md`

배포 전 NAS에 `/volume1/docker/voxion/.env.prod`와 공유 storage 디렉터리를 준비해야 합니다.
자세한 절차와 필요한 GitHub Actions Secrets는 [배포 가이드](docs/deployment-guide.md)를 확인하세요.

## 문제 해결

- `OPENAI_API_KEY is not configured.`: `.env`에 `OPENAI_API_KEY`가 없습니다.
- `Notion environment is not configured.`: `.env`에 `NOTION_TOKEN` 또는 `NOTION_TABLE_DATA_SOURCE_ID`가 없습니다.
- `401 Unauthorized`: `/login`에서 관리자 로그인을 하거나 API 요청에 `Authorization: Bearer <API_ACCESS_TOKEN>` 헤더를 추가합니다.
- Notion `403`: integration capability가 부족하거나 해당 데이터 소스에 connection을 추가하지 않았을 가능성이 큽니다.
- `ffmpeg` 또는 `ffprobe` 실행 실패: 설치 여부와 `PATH`를 확인합니다.
- 업로드 파일이 너무 큼: `MAX_UPLOAD_BYTES`를 조정할 수 있습니다. 기본값은 2GiB입니다.
- OpenAI STT 요청이 파일 크기로 실패: `CHUNK_TARGET_BYTES`를 더 낮춥니다. 기본값은 `24000000`입니다.
- OpenAI STT 요청이 오디오 길이 또는 timeout으로 실패: `CHUNK_MAX_DURATION_SECONDS`를 더 낮춥니다. 기본값은 `1200`초이고, diarize 모델은 `600`초 이하를 권장합니다.
- 후처리 비용을 끄고 싶음: `OPENAI_POST_PROCESSING_ENABLED=false`로 둡니다. 이 경우 prompt와 이전 chunk context를 사용한 STT 결과에 추정 시간코드만 붙습니다.
- 후처리 호출 수가 너무 많음: `OPENAI_POST_PROCESSING_MAX_CHUNKS`를 낮추면 비용 상한을 강하게 잡을 수 있습니다. 상한을 넘는 녹음은 후처리를 건너뛰고 raw transcript로 완료됩니다.

## 참고 문서

- OpenAI API keys: https://platform.openai.com/api-keys
- OpenAI API key Help Center: https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key
- Notion Developer quickstart: https://developers.notion.com/guides/get-started/quick-start
- Notion data source: https://developers.notion.com/reference/retrieve-a-data-source
- Notion create page: https://developers.notion.com/reference/post-page
- Notion retrieve block children: https://developers.notion.com/reference/get-block-children
- Notion append block children: https://developers.notion.com/reference/patch-block-children
