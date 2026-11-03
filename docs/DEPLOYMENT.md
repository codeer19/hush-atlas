# Deploying Hush Atlas

Hush Atlas is prepared for a split deployment:

- **Vercel** serves the static React/Vite build.
- **Render** runs the FastAPI backend, SQLite, YAMNet, and stored audio on a
  paid instance with a persistent disk.
- **On-device AI** runs in the visitor's browser through WebLLM. It is not a
  cloud inference service and does not use the Render backend.

This document describes a deployment that has **not** been performed. A
deployment is only complete when the real URLs respond, `/api/health` is
healthy, CORS works from the Vercel origin, and an upload/analysis/comparison
flow has been exercised against the deployed services.

## Before you deploy: access control is mandatory

This repository does not include user accounts, login, or per-user tenancy.
The local app is designed to bind to loopback and has no authentication. Do not
publish it as an anonymous public service.

A public deployment must have a real access boundary in front of both services,
for example:

- **Cloudflare Access** (or another identity-aware proxy) in front of the
  Vercel site and the Render API, with a policy limited to the intended people.
- **Vercel Deployment Protection** for the frontend **plus** an authenticated
  proxy for the API. Protecting only the frontend is not enough: the Render URL
  is still reachable if it is discovered.
- A private network or VPN that reaches both services, with no public route.

If you need a public multi-user product, add application authentication and
authorization first. A shared password in a `VITE_*` variable is not access
control because it is shipped to every browser.

## 1. Prepare the repository

The project must be in a Git repository with a remote that Vercel and Render can
read. `certs/`, `data/`, `models/`, `.env`, and build output are ignored.

```powershell
git init
git add .
git commit -m "Prepare Hush Atlas for deployment"
git remote add origin <your-repository-url>
git push -u origin main
```

Confirm that `models/yamnet/yamnet.h5` is **not** committed. Render downloads it
during the build with `scripts/download-yamnet.py`.

## 2. Create the Render backend

Use the Blueprint in `render.yaml`, or create a Web Service with the same
settings.

| Setting | Value |
| --- | --- |
| Runtime | Python 3.12 |
| Plan | **Standard** or larger (paid) |
| Build command | `pip install --upgrade pip && pip install -r backend/requirements.txt && python scripts/download-yamnet.py` |
| Start command | `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health check | `/api/health` |
| Persistent disk | 10 GB mounted at `/var/data` |

Why a paid instance:

- Render's free web services use an ephemeral filesystem. SQLite and uploaded
  audio would disappear on every restart or deploy.
- TensorFlow and YAMNet need more than the free instance's memory. A Standard
  instance is the practical starting point; watch memory during the first real
  analysis and move up if the service restarts.

Environment variables:

| Variable | Value |
| --- | --- |
| `PYTHON_VERSION` | `3.12.13` |
| `TF_USE_LEGACY_KERAS` | `1` |
| `PYTHONUNBUFFERED` | `1` |
| `SILENCE_DATA_DIR` | `/var/data` |
| `SILENCE_HOSTED` | `true` |
| `SILENCE_DATABASE_PATH` | `/var/data/silence_archive.sqlite3` |
| `SILENCE_MODEL_DIR` | `/opt/render/project/src/models` |
| `SILENCE_CORS_ORIGINS` | The exact Vercel production origin, for example `https://hush-atlas.vercel.app` |
| `SILENCE_MAX_UPLOAD_MB` | `80` |
| `SILENCE_ANALYSIS_WORKERS` | `1` |

Notes:

- `SILENCE_HOSTED=true` marks the API as hosted: `/api/health` reports
  `local_only: false`, and downloadable reports say the audio is kept on the
  Hush Atlas server rather than in a local archive.
- Audio is stored under `/var/data/audio`, analysis artifacts under
  `/var/data/analysis`, and SQLite at `/var/data/silence_archive.sqlite3`.
- `SILENCE_MODEL_DIR` points at the build-time model download. The weights are
  not user data and can be rebuilt on each deploy.
- CORS accepts a comma-separated list of exact origins. Add a custom domain and
  any preview origin you actually use. Do not use `*` for a deployment that is
  meant to be private.
- The Render URL must be HTTPS. Render provides the certificate.

After the first deploy, verify:

```powershell
curl.exe --ssl-no-revoke https://<render-service>.onrender.com/api/health
```

The response must include `"status": "ok"`, `"database": true`,
`"local_only": false`, and `"audio_model_assets": true`. If
`audio_model_assets` is false, the YAMNet download or `SILENCE_MODEL_DIR` is
wrong.

## 3. Create the Vercel frontend

Import the same repository into Vercel.

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | Repository root |
| Install command | `npm --prefix frontend ci` |
| Build command | `npm --prefix frontend run build` |
| Output directory | `frontend/dist` |

`vercel.json` already contains these commands, the SPA rewrite, cache headers,
and basic security headers. Set the environment variable:

| Variable | Value |
| --- | --- |
| `VITE_API_BASE_URL` | `https://<render-service>.onrender.com` |

The app appends `/api` when it is missing. A value that already ends in `/api`
also works. This variable is public; it must never contain a secret.

Redeploy after changing `VITE_API_BASE_URL`; Vite embeds it at build time.

## 4. Verify the deployment

1. Open the Vercel URL over HTTPS. The browser must show a normal public
   certificate, not a warning.
2. Confirm the About page reports the sound reader as ready.
3. Upload a short WAV/FLAC/MP3/Ogg file and wait for YAMNet analysis. The
   request must reach the Render origin, not the Vercel static host.
4. Open the recording and check that audio playback and waveform load. Asset
   URLs returned as `/api/...` are rewritten to the Render origin by the
   frontend.
5. Create a second recording and a comparison. Open the evidence page.
6. Download a comparison report. The link must point at Render.
7. In Chrome or Edge with WebGPU and hardware acceleration, open About, choose
   **Download model**, and let the ~1.4 GB download finish. The status must
   become **AI ready** only after the real test inference.
8. Ask for a reflection on a comparison. The text must be written in the
   browser. Disconnect the network after the model is ready and repeat to prove
   inference is local.
9. Remove the downloaded model and confirm the plain reading still works.

If step 3 fails with a CORS error, `SILENCE_CORS_ORIGINS` does not exactly match
the browser origin. Include the scheme and port, with no trailing slash.

## 5. Data, backup, and rollback

The Render disk is the only durable copy of the deployed atlas. Back it up
before changing plans or deleting the service.

- Stop writes (or accept a brief maintenance window), then copy
  `/var/data/silence_archive.sqlite3`, `/var/data/audio`, and
  `/var/data/analysis`.
- Keep the backup outside Render.
- A Render disk is attached to one service and one region. It is not a
  multi-instance shared filesystem; do not scale the service to multiple
  instances while SQLite is in use.
- Rolling back the frontend is a Vercel deployment promotion. Rolling back the
  backend code does not roll back the database. Take a backup first.

The database and audio are not encrypted at rest by the application. Use the
hosting provider's disk encryption and your own access controls. A recording can
contain speech or other sensitive sound.

## 6. On-device AI disclosure

The browser downloads the model files from Hugging Face
(`mlc-ai/gemma-2-2b-it-q4f16_1-MLC`) and stores them in the browser cache. The
download is about 1.4 GB and is started only by an explicit user action. No
audio, recording, atlas data, or reflection prompt is sent to Hugging Face or to
the Render backend by the on-device model. The browser needs WebGPU, the
`shader-f16` feature, and enough graphics memory; unsupported devices keep
recording, analysis, maps, comparisons, and plain readings.

The backend keeps the legacy loopback Ollama endpoints for compatibility with
existing installations. They are not the user-facing reflection path and should
not be exposed on Render. Leave `SILENCE_OLLAMA_URL` at its loopback default.

## 7. Known limits

- No accounts or per-user isolation. Use an access boundary as described above.
- SQLite and local audio are single-instance storage. This is not a horizontally
  scalable architecture.
- TensorFlow/YAMNet memory use is the main Render sizing risk.
- On-device AI was verified in a headed Chrome 156 session on Windows with a
  WebGPU adapter (AMD RDNA-3, `shader-f16`). The 1.4 GB Gemma 2 2B download,
  load, real test inference, and a real comparison reflection all succeeded.
  Mobile GPUs and other browsers were not verified; the About panel reports the
  actual support answer for each device.
- Vercel and Render were not deployed from this workspace because no Git
  remote or deployment credentials were available. Do not describe the app as
  deployed until the URLs and health checks above pass.
