
import os
import sys
import subprocess
import numpy as np
from pathlib import Path
import logging

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.common.config import BackendConfig
from backend.common.types import RecognitionTask
from backend.qwen3.adapter import Qwen3Adapter

def convert_audio(input_path: Path) -> bytes:
    """Convert any audio to 16kHz mono float32 raw PCM using ffmpeg."""
    cmd = [
        "ffmpeg", "-i", str(input_path),
        "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"
    ]
    result = subprocess.run(cmd, capture_output=True, check=True)
    return result.stdout

def main():
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("bulk_transcribe")

    result_file = PROJECT_ROOT / "test" / "transcription_results.txt"
    if result_file.exists():
        result_file.unlink()

    rec_dir = PROJECT_ROOT / "test" / "rec"
    files = [
        rec_dir / "Recording (2).m4a",
        rec_dir / "Recording (3).m4a",
        rec_dir / "Recording (4).m4a",
        rec_dir / "Recording (5).m4a",
        rec_dir / "Recording (6).m4a",
    ]

    # Configure Qwen3
    models_dir = Path.home() / ".echotype" / "models"
    config = BackendConfig(
        backend="qwen3",
        model_id="Qwen3-ASR-0.6B",
        models_dir=models_dir,
        device_preference="auto", # Use auto to be safe
        allow_gpu=True
    )

    adapter = Qwen3Adapter(config, logger=logger)
    logger.info("Loading Qwen3 model...")
    adapter.load()
    logger.info("Model loaded.")

    for audio_file in files:
        if not audio_file.exists():
            logger.warning(f"File not found: {audio_file}")
            continue

        logger.info(f"Processing: {audio_file.name}")
        try:
            audio_bytes = convert_audio(audio_file)
            
            task = RecognitionTask(
                task_id=f"bulk-{audio_file.stem}",
                client_id="bulk-client",
                data=audio_bytes,
                offset=0.0,
                overlap=0.0,
                is_final=True,
                time_start=0.0,
                time_submit=0.0,
                source="bulk_script",
                samplerate=16000
            )

            result = adapter.process_task(task)
            
            output_line = f"\n{'='*40}\nFILE: {audio_file.name}\n{'-' * 40}\n{result.text}\n{'='*40}\n"
            print(output_line)
            
            with open(PROJECT_ROOT / "test" / "transcription_results.txt", "a", encoding="utf-8") as f:
                f.write(output_line)
            
        except Exception as e:
            logger.error(f"Failed to process {audio_file.name}: {e}")

if __name__ == "__main__":
    main()
