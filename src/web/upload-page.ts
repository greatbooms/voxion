export function renderUploadPage(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Voxion Upload</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #1f2933;
      background: #eef2f5;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 18px 28px;
      border-bottom: 1px solid #d6dde5;
      background: #ffffff;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    main {
      width: min(100%, 920px);
      margin: 0 auto;
      padding: 28px;
      display: grid;
      gap: 20px;
    }
    section {
      background: #ffffff;
      border: 1px solid #d6dde5;
      border-radius: 8px;
      padding: 22px;
    }
    h2 {
      margin: 0 0 18px;
      font-size: 18px;
      line-height: 1.3;
      letter-spacing: 0;
    }
    form.upload {
      display: grid;
      gap: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    label {
      display: grid;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
    }
    input,
    select {
      width: 100%;
      min-height: 42px;
      border: 1px solid #b8c2cc;
      border-radius: 6px;
      padding: 0 12px;
      font: inherit;
      background: #ffffff;
    }
    input[type="file"] {
      padding: 9px 12px;
    }
    button {
      min-height: 42px;
      border: 0;
      border-radius: 6px;
      padding: 0 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .primary {
      background: #0f766e;
      color: #ffffff;
    }
    .secondary {
      background: #e5e9ef;
      color: #26323f;
    }
    .actions {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }
    .status {
      min-height: 42px;
      padding: 12px;
      border-radius: 6px;
      background: #f5f7fa;
      border: 1px solid #d6dde5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 14px;
    }
    .transcript {
      min-height: 180px;
      max-height: 520px;
      overflow: auto;
      white-space: pre-wrap;
      border: 1px solid #d6dde5;
      border-radius: 6px;
      padding: 14px;
      background: #fbfcfd;
      line-height: 1.6;
    }
    @media (max-width: 720px) {
      header {
        padding: 16px;
      }
      main {
        padding: 16px;
      }
      .grid,
      .actions {
        grid-template-columns: 1fr;
        flex-direction: column;
        align-items: stretch;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>Voxion</h1>
    <form method="post" action="/auth/logout">
      <button class="secondary" type="submit">로그아웃</button>
    </form>
  </header>
  <main>
    <section>
      <h2>녹음 업로드</h2>
      <form id="upload-form" class="upload">
        <label>
          파일
          <input name="file" type="file" accept="audio/*,.m4a,.mp3,.mp4,.mpeg,.mpga,.wav,.webm" required>
        </label>
        <div class="grid">
          <label>
            제목
            <input name="title" maxlength="200" placeholder="팀 미팅">
          </label>
          <label>
            언어
            <select name="language">
              <option value="ko">ko</option>
              <option value="en">en</option>
              <option value="">기본값</option>
            </select>
          </label>
        </div>
        <label>
          녹음일
          <input name="recordedAt" type="datetime-local">
        </label>
        <div class="actions">
          <button id="submit-button" class="primary" type="submit">업로드</button>
          <span id="current-recording"></span>
        </div>
      </form>
    </section>
    <section>
      <h2>처리 상태</h2>
      <div id="status" class="status">대기 중</div>
    </section>
    <section>
      <h2>전사 결과</h2>
      <div id="transcript" class="transcript"></div>
    </section>
  </main>
  <script>
    const form = document.querySelector('#upload-form');
    const statusBox = document.querySelector('#status');
    const transcriptBox = document.querySelector('#transcript');
    const submitButton = document.querySelector('#submit-button');
    const currentRecording = document.querySelector('#current-recording');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      transcriptBox.textContent = '';
      statusBox.textContent = '업로드 중';
      currentRecording.textContent = '';

      try {
        const formData = new FormData(form);
        const recordedAt = formData.get('recordedAt');
        if (recordedAt) {
          formData.set('recordedAt', new Date(String(recordedAt)).toISOString());
        } else {
          formData.delete('recordedAt');
        }
        if (!formData.get('language')) {
          formData.delete('language');
        }

        const uploadResponse = await fetch('/recordings', {
          method: 'POST',
          body: formData,
        });
        const uploadBody = await parseJson(uploadResponse);
        if (!uploadResponse.ok) {
          throw new Error(readError(uploadBody, '업로드 실패'));
        }

        const recordingId = uploadBody.recordingId;
        const jobId = uploadBody.jobId;
        currentRecording.textContent = recordingId;
        statusBox.textContent = '큐 등록 완료';
        await pollJob(jobId, recordingId);
      } catch (error) {
        statusBox.textContent = error instanceof Error ? error.message : '처리 실패';
      } finally {
        submitButton.disabled = false;
      }
    });

    async function pollJob(jobId, recordingId) {
      for (;;) {
        const response = await fetch(\`/jobs/\${jobId}\`);
        const body = await parseJson(response);
        if (!response.ok) {
          throw new Error(readError(body, '작업 상태 조회 실패'));
        }

        statusBox.textContent = [
          \`job: \${body.status}\`,
          body.queue?.state ? \`queue: \${body.queue.state}\` : null,
          body.queue?.progress !== undefined ? \`progress: \${JSON.stringify(body.queue.progress)}\` : null,
          body.lastError ? \`error: \${body.lastError}\` : null,
        ].filter(Boolean).join('\\n');

        if (body.status === 'COMPLETED') {
          await loadTranscript(recordingId);
          return;
        }
        if (body.status === 'FAILED') {
          throw new Error(body.lastError || '전사 작업 실패');
        }

        await sleep(2500);
      }
    }

    async function loadTranscript(recordingId) {
      const response = await fetch(\`/recordings/\${recordingId}/transcript\`);
      const body = await parseJson(response);
      if (!response.ok) {
        throw new Error(readError(body, '전사 결과 조회 실패'));
      }
      statusBox.textContent = '완료';
      transcriptBox.textContent = body.text || '';
    }

    async function parseJson(response) {
      try {
        return await response.json();
      } catch {
        return {};
      }
    }

    function readError(body, fallback) {
      if (typeof body.message === 'string') {
        return body.message;
      }
      if (Array.isArray(body.message)) {
        return body.message.join('\\n');
      }
      return fallback;
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  </script>
</body>
</html>`;
}
