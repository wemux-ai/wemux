"""Local-only MOSS + MiniCPM5 runtime for Wemux Backstage Dictation.

The process deliberately binds to 127.0.0.1. Audio is accepted only from the
local client, transcribed locally, then discarded after the response. The web
client sends only the returned value-bearing text to the control plane.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoModelForCausalLM, AutoProcessor, AutoTokenizer

MOSS_MODEL = os.environ.get("WEMUX_MOSS_MODEL", "OpenMOSS-Team/MOSS-Transcribe-Diarize")
VALUE_MODEL = os.environ.get("WEMUX_VALUE_MODEL", "openbmb/MiniCPM5-1B")
DEFAULT_MOSS_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DEFAULT_VALUE_DEVICE = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
MOSS_DEVICE = os.environ.get("WEMUX_MOSS_DEVICE", os.environ.get("WEMUX_MEETING_DEVICE", DEFAULT_MOSS_DEVICE))
VALUE_DEVICE = os.environ.get("WEMUX_VALUE_DEVICE", os.environ.get("WEMUX_MEETING_DEVICE", DEFAULT_VALUE_DEVICE))
RUNTIME_TOKEN = os.environ.get("WEMUX_MEETING_RUNTIME_TOKEN", "").strip()
MAX_AUDIO_BYTES = max(1, int(os.environ.get("WEMUX_MEETING_MAX_AUDIO_BYTES", str(32 * 1024 * 1024))))
ALLOWED_ORIGINS = [origin.strip() for origin in os.environ.get("WEMUX_MEETING_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
LOCAL_ORIGIN_PATTERN = r"^(?:https?://(?:localhost|127\.0\.0\.1)(?::\d+)?|wemux://local)$"

logger = logging.getLogger("wemux.meeting-runtime")

app = FastAPI(title="Wemux local meeting runtime", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=LOCAL_ORIGIN_PATTERN,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "X-Wemux-Meeting-Key"],
)

moss_model: Any | None = None
moss_processor: Any | None = None
value_model: Any | None = None
value_tokenizer: Any | None = None


def load_moss() -> tuple[Any, Any]:
    global moss_model, moss_processor
    if moss_model is None or moss_processor is None:
        moss_model = AutoModelForCausalLM.from_pretrained(
            MOSS_MODEL,
            trust_remote_code=True,
            dtype="auto",
            attn_implementation="sdpa",
        ).to(MOSS_DEVICE).eval()
        moss_processor = AutoProcessor.from_pretrained(MOSS_MODEL, trust_remote_code=True)
    return moss_model, moss_processor


def load_value_model() -> tuple[Any, Any]:
    global value_model, value_tokenizer
    if value_model is None or value_tokenizer is None:
        value_tokenizer = AutoTokenizer.from_pretrained(VALUE_MODEL)
        value_model = AutoModelForCausalLM.from_pretrained(VALUE_MODEL, torch_dtype="auto").to(VALUE_DEVICE).eval()
    return value_model, value_tokenizer


def timestamp(base: str, offset_seconds: float) -> str:
    start = datetime.fromisoformat(base.replace("Z", "+00:00"))
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    return (start + timedelta(seconds=offset_seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_json_object(raw: str) -> dict[str, Any]:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return {"valuable": False, "confidence": 0.0, "channels": []}
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return {"valuable": False, "confidence": 0.0, "channels": []}
    return parsed if isinstance(parsed, dict) else {"valuable": False, "confidence": 0.0, "channels": []}


def normalize_verdict(verdict: dict[str, Any]) -> dict[str, Any]:
    valuable = bool(verdict.get("valuable"))
    channels = verdict.get("channels") if isinstance(verdict.get("channels"), list) else []
    channels = [channel for channel in channels if channel in {"cloud_db", "cloud_agent", "memory_doc"}]
    if valuable and "cloud_db" not in channels:
        channels.insert(0, "cloud_db")
    if valuable and "cloud_agent" not in channels:
        channels.append("cloud_agent")
    try:
        confidence = min(1.0, max(0.0, float(verdict.get("confidence", 0.0))))
    except (TypeError, ValueError):
        confidence = 0.0
    return {
        "valuable": valuable,
        "valueLabel": verdict.get("valueLabel") if isinstance(verdict.get("valueLabel"), str) else None,
        "confidence": confidence,
        "channels": channels,
    }


def build_value_prompt(text: str, brain_context: str) -> str:
    return """你是工作会议的本地隐私价值过滤器。只输出一个 JSON 对象，不要 markdown 和解释：
{"valuable":false,"valueLabel":null,"confidence":0.0,"channels":[]}

严格规则：
- 只有明确的工作决定、承诺、待办、风险、客户/竞品事实，或与下方组织背景直接相关且值得长期保存的信息，valuable 才为 true。
- 寒暄、闲聊、天气、饮食、情绪表达、重复内容、不明确的讨论，一律为 false。
- 与组织背景没有直接关系时一律为 false。
- true 时 channels 必须含 cloud_db 和 cloud_agent；false 时 channels 必须为空，valueLabel 必须为 null。

例子：
组织背景：组织正在准备周五发布。
转写：今天天气不错，午饭吃什么？
输出：{"valuable":false,"valueLabel":null,"confidence":0.99,"channels":[]}

组织背景：组织正在准备周五发布。
转写：周三前完成发布方案。
输出：{"valuable":true,"valueLabel":"Task","confidence":0.99,"channels":["cloud_db","cloud_agent"]}

现在判定：
组织背景：""" + (brain_context or "（无可用工作区背景）") + "\n转写：" + text + "\n输出："


def judge(text: str, brain_context: str) -> dict[str, Any]:
    model, tokenizer = load_value_model()
    messages = [{"role": "user", "content": build_value_prompt(text, brain_context)}]
    encoded = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        enable_thinking=False,
        return_dict=True,
        return_tensors="pt",
    ).to(VALUE_DEVICE)
    with torch.inference_mode():
        output = model.generate(**encoded, max_new_tokens=180, do_sample=False, pad_token_id=tokenizer.eos_token_id)
    response = tokenizer.decode(output[0][encoded["input_ids"].shape[-1]:], skip_special_tokens=True)
    return normalize_verdict(parse_json_object(response))


def transcribe(path: str) -> list[dict[str, Any]]:
    from moss_transcribe_diarize import parse_transcript
    from moss_transcribe_diarize.inference_utils import build_transcription_messages, generate_transcription

    model, processor = load_moss()
    dtype = torch.bfloat16 if MOSS_DEVICE == "cuda" else torch.float32
    result = generate_transcription(
        model,
        processor,
        build_transcription_messages(path),
        max_new_tokens=2048,
        do_sample=False,
        device=torch.device(MOSS_DEVICE),
        dtype=dtype,
    )
    return [
        {"start": float(segment.start), "end": float(segment.end), "speaker": str(segment.speaker), "text": str(segment.text)}
        for segment in parse_transcript(result["text"])
        if str(segment.text).strip()
    ]


def authorize_runtime(provided_token: str | None) -> None:
    if RUNTIME_TOKEN and provided_token != RUNTIME_TOKEN:
        raise HTTPException(status_code=401, detail="invalid local meeting runtime token")


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ready": True,
        "host": "127.0.0.1",
        "moss": MOSS_MODEL,
        "minicpm5": VALUE_MODEL,
        "mossDevice": MOSS_DEVICE,
        "valueDevice": VALUE_DEVICE,
        "mossLoaded": moss_model is not None,
        "valueModelLoaded": value_model is not None,
    }


@app.post("/v1/meeting/transcribe")
async def meeting_transcribe(
    audio: UploadFile = File(...),
    startedAt: str = Form(...),
    endedAt: str = Form(...),
    brainContext: str = Form(default=""),
    x_wemux_meeting_key: str | None = Header(default=None),
) -> dict[str, Any]:
    authorize_runtime(x_wemux_meeting_key)
    del endedAt  # The runtime derives per-speaker timestamps from the MOSS result.
    suffix = Path(audio.filename or "meeting.webm").suffix or ".webm"
    temporary = tempfile.NamedTemporaryFile(prefix="wemux-meeting-", suffix=suffix, delete=False)
    try:
        received_bytes = 0
        while chunk := await audio.read(1024 * 1024):
            received_bytes += len(chunk)
            if received_bytes > MAX_AUDIO_BYTES:
                raise HTTPException(status_code=413, detail="meeting audio chunk exceeds the local runtime limit")
            temporary.write(chunk)
        temporary.close()
        result = []
        for segment in transcribe(temporary.name):
            verdict = judge(segment["text"], brainContext[:8_000])
            result.append({
                "startedAt": timestamp(startedAt, segment["start"]),
                "endedAt": timestamp(startedAt, segment["end"]),
                "transcript": segment["text"],
                "speakerId": segment["speaker"],
                **verdict,
            })
        return {"segments": result}
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("local meeting runtime failed")
        raise HTTPException(status_code=503, detail="local meeting runtime failed") from error
    finally:
        temporary.close()
        Path(temporary.name).unlink(missing_ok=True)
