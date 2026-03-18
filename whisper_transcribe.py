#!/usr/bin/env python3
"""Whisper fallback transcription for yt2text.

Usage: python3 whisper_transcribe.py <audio_path> [language]

Outputs JSON array of segments: [{ "start": float, "end": float, "text": str }, ...]
"""

import sys
import json
import ssl

# Fix SSL certificate issues for model download
ssl._create_default_https_context = ssl._create_unverified_context


def transcribe(audio_path, language=None):
    import whisper

    model = whisper.load_model("base")
    options = {}
    if language:
        options["language"] = language
    result = model.transcribe(audio_path, **options)

    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": round(seg["start"], 3),
            "end": round(seg["end"], 3),
            "text": seg["text"].strip(),
        })
    return segments


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: whisper_transcribe.py <audio_path> [language]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        segments = transcribe(audio_path, language)
        print(json.dumps(segments))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
