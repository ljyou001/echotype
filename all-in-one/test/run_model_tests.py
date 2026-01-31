from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

sys.path.append(str(Path(__file__).resolve().parents[1]))

from backend.common.config import BackendConfig
from backend.common.types import RecognitionTask
from backend.qwen3.adapter import Qwen3Adapter
from backend.sherpa_onnx.adapter import SherpaOnnxAdapter


AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}


def load_audio_ffmpeg(path: Path, sample_rate: int = 16000) -> np.ndarray:
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        str(sample_rate),
        "pipe:1",
    ]
    process = subprocess.run(cmd, capture_output=True, check=False)
    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg failed for {path}: {process.stderr.decode(errors='ignore')}")
    return np.frombuffer(process.stdout, dtype=np.float32)


def build_task(audio: np.ndarray, sample_rate: int, task_id: str) -> RecognitionTask:
    return RecognitionTask(
        task_id=task_id,
        client_id="local",
        data=audio.astype(np.float32).tobytes(),
        offset=0.0,
        overlap=0.0,
        is_final=True,
        time_start=time.time(),
        time_submit=time.time(),
        source="file",
        samplerate=sample_rate,
    )


def run_sherpa(model_dir: Path, files: List[Path]) -> Dict[str, object]:
    config = BackendConfig(
        backend="sherpa_onnx",
        models_dir=model_dir,
        model_id="paraformer-offline-zh",
    )
    adapter = SherpaOnnxAdapter(config)
    adapter.load()

    results = []
    for path in files:
        audio = load_audio_ffmpeg(path)
        task = build_task(audio, 16000, task_id=str(uuid.uuid4()))
        result = adapter.process_task(task)
        results.append({"file": str(path), "text": result.text})

    adapter.close()
    return {"backend": "sherpa_onnx", "count": len(results), "results": results}


def run_qwen(model_dir: Path, files: List[Path], device: str) -> Dict[str, object]:
    config = BackendConfig(
        backend="qwen3",
        models_dir=model_dir,
        model_id="Qwen3-ASR-0.6B",
        device_preference=device,
        qwen_backend="transformers",
        qwen_use_forced_aligner=False,
    )
    adapter = Qwen3Adapter(config)
    adapter.load()

    results = []
    for path in files:
        audio = load_audio_ffmpeg(path)
        task = build_task(audio, 16000, task_id=str(uuid.uuid4()))
        result = adapter.process_task(task)
        results.append({"file": str(path), "text": result.text, "lang": result.lang})

    adapter.close()
    return {"backend": "qwen3", "device": device, "count": len(results), "results": results}


def collect_audio_files(root: Path) -> List[Path]:
    files = []
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() in AUDIO_EXTENSIONS:
            files.append(path)
    return files


def write_results(output_path: Path, payload: Dict[str, object]) -> None:
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run offline ASR tests on local audio files")
    parser.add_argument("--assets", type=str, default=str(Path(__file__).resolve().parent / "assets"))
    parser.add_argument("--models", type=str, default=str(Path.home() / ".echotype" / "models"))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output", type=str, default=str(Path(__file__).resolve().parent / "results"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    assets_dir = Path(args.assets)
    models_dir = Path(args.models)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if not assets_dir.exists():
        raise FileNotFoundError(f"Assets directory not found: {assets_dir}")
    if not models_dir.exists():
        raise FileNotFoundError(f"Models directory not found: {models_dir}")

    files = collect_audio_files(assets_dir)
    if args.limit and args.limit > 0:
        files = files[: args.limit]

    if not files:
        print("No audio files found")
        return 1

    print(f"Testing {len(files)} audio files")

    sherpa_results = run_sherpa(models_dir, files)
    write_results(output_dir / "sherpa_onnx_results.json", sherpa_results)

    qwen_cpu_results = run_qwen(models_dir, files, device="cpu")
    write_results(output_dir / "qwen3_cpu_results.json", qwen_cpu_results)

    qwen_gpu_results = run_qwen(models_dir, files, device="cuda")
    write_results(output_dir / "qwen3_gpu_results.json", qwen_gpu_results)

    print("Done. Results written to:", output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
