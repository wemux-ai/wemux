"""Sidecar contract checks that do not download or load model weights."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import server


class MeetingRuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(server.app)

    def test_health_does_not_load_models(self) -> None:
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ready"])
        self.assertFalse(response.json()["mossLoaded"])
        self.assertFalse(response.json()["valueModelLoaded"])

    def test_cors_allows_loopback_and_rejects_untrusted_origin(self) -> None:
        loopback = self.client.get("/health", headers={"Origin": "http://127.0.0.1:15174"})
        untrusted = self.client.get("/health", headers={"Origin": "https://untrusted.example"})

        self.assertEqual(loopback.headers.get("access-control-allow-origin"), "http://127.0.0.1:15174")
        self.assertIsNone(untrusted.headers.get("access-control-allow-origin"))

    def test_transcribe_returns_only_local_judgment_result(self) -> None:
        segments = [{"start": 1.25, "end": 3.75, "speaker": "S01", "text": "周五发布。"}]
        verdict = {"valuable": True, "valueLabel": "decision", "confidence": 0.9, "channels": ["cloud_db", "cloud_agent"]}

        with patch.object(server, "transcribe", return_value=segments), patch.object(server, "judge", return_value=verdict):
            response = self.client.post(
                "/v1/meeting/transcribe",
                data={"startedAt": "2026-08-27T09:00:00.000Z", "endedAt": "2026-08-27T09:00:30.000Z"},
                files={"audio": ("meeting.webm", b"local audio", "audio/webm")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["segments"], [{
            "startedAt": "2026-08-27T09:00:01.250Z",
            "endedAt": "2026-08-27T09:00:03.750Z",
            "transcript": "周五发布。",
            "speakerId": "S01",
            **verdict,
        }])

    def test_runtime_token_rejects_unpaired_client(self) -> None:
        with patch.object(server, "RUNTIME_TOKEN", "pairing-secret"):
            response = self.client.post(
                "/v1/meeting/transcribe",
                data={"startedAt": "2026-08-27T09:00:00.000Z", "endedAt": "2026-08-27T09:00:30.000Z"},
                files={"audio": ("meeting.webm", b"local audio", "audio/webm")},
            )

        self.assertEqual(response.status_code, 401)

    def test_runtime_rejects_oversized_audio_before_model_inference(self) -> None:
        with patch.object(server, "MAX_AUDIO_BYTES", 4):
            response = self.client.post(
                "/v1/meeting/transcribe",
                data={"startedAt": "2026-08-27T09:00:00.000Z", "endedAt": "2026-08-27T09:00:30.000Z"},
                files={"audio": ("meeting.webm", b"five!", "audio/webm")},
            )

        self.assertEqual(response.status_code, 413)

    def test_malformed_model_confidence_fails_closed(self) -> None:
        verdict = server.normalize_verdict({
            "valuable": True,
            "valueLabel": "decision",
            "confidence": "not-a-number",
            "channels": ["cloud_agent", "invalid"],
        })

        self.assertEqual(verdict, {
            "valuable": True,
            "valueLabel": "decision",
            "confidence": 0.0,
            "channels": ["cloud_db", "cloud_agent"],
        })

    def test_value_prompt_explicitly_rejects_small_talk(self) -> None:
        prompt = server.build_value_prompt("今天天气不错，午饭吃什么？", "组织正在准备周五发布。")

        self.assertIn("寒暄、闲聊、天气、饮食", prompt)
        self.assertIn('"valuable":false', prompt)
        self.assertIn("周三前完成发布方案", prompt)


if __name__ == "__main__":
    unittest.main()
