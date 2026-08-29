# Backstage Dictation Runtime

This optional local sidecar powers Wemux "背后听写" on desktop. It binds only
to `127.0.0.1:4768`: original audio is never uploaded to the control plane.
MOSS-Transcribe-Diarize generates timestamped, speaker-labelled text, then
MiniCPM5-1B decides whether a segment is valuable enough to update the cloud
Agent context. When the user has selected a workspace, its compact Brain
summary is also supplied to MiniCPM5 for relevance judgment.

## Run locally

```bash
cd apps/meeting-runtime
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -r requirements.txt --torch-backend=auto
uv pip install git+https://github.com/OpenMOSS/MOSS-Transcribe-Diarize.git
uvicorn server:app --host 127.0.0.1 --port 4768
```

Verify the real MiniCPM5 value filter with one valuable and one irrelevant
Chinese transcript. This loads the actual weights and exits non-zero if either
classification is wrong:

```bash
PYTORCH_ENABLE_MPS_FALLBACK=1 WEMUX_VALUE_DEVICE=mps \
  TOKENIZERS_PARALLELISM=false .venv/bin/python -u smoke_value_model.py
```

Use `WEMUX_VALUE_DEVICE=cpu` on systems without Apple Silicon MPS or CUDA.

The first request downloads `OpenMOSS-Team/MOSS-Transcribe-Diarize` and
`openbmb/MiniCPM5-1B`. Set `WEMUX_MOSS_MODEL`, `WEMUX_VALUE_MODEL`,
`WEMUX_MOSS_DEVICE`, or `WEMUX_VALUE_DEVICE` to use a local cache or selected
device. `WEMUX_MEETING_DEVICE` remains a compatibility override for both. The
upstream MOSS Python runtime supports CPU and CUDA; MiniCPM5 also defaults to
MPS on Apple Silicon. The desktop client uses `http://127.0.0.1:4768` by default; set
the address and optional pairing token from the meeting-records page when using
another runtime.

The service accepts at most 32 MiB per chunk by default. Override that only for
your private deployment with `WEMUX_MEETING_MAX_AUDIO_BYTES`. Its default CORS
policy accepts the desktop shell and loopback development pages. A hosted web
client must explicitly set `WEMUX_MEETING_ALLOWED_ORIGINS` to its exact HTTPS
origin. Set `WEMUX_MEETING_RUNTIME_TOKEN` for every LAN deployment.

## Mobile

The Android Expo client records in 30-second chunks and runs both fixed GGUF
artifacts (MOSS Q4_K and MiniCPM5 Q4_K_M) in its native foreground service.
Open the meeting-records settings on the Android app to download, verify, or
remove the two artifacts. The app stores them in private app storage and only
sends value-bearing text to Wemux; original audio remains on the device.

The same client can instead use a private runtime endpoint when configured.
It intentionally refuses to start without a Wemux API URL and login
credentials, so raw meeting audio is never silently sent to a public service.

For all-day Android use, run the runtime on an office edge host and use a
private Wi-Fi/VPN address, enable `WEMUX_MEETING_RUNTIME_TOKEN`, and terminate
TLS at the private network gateway. Do not expose this process to the public
internet. For iOS, the native GGUF runtime is still pending; use the private
runtime endpoint until an iOS backend is packaged.
