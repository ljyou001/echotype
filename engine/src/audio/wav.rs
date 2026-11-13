//! [INPUT]: 依赖 hound（RIFF/WAVE 读写）、audio::resample::resample_once
//! [OUTPUT]: 导出 read_wav（任意 PCM/float wav → 单声道 f32 + 采样率）、read_wav_16k、write_wav_16k
//! [POS]: audio 子模块的文件读写。transcribe.file 与假麦克风读 wav，会话的 record_to 写 16 kHz int16 wav。
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::Path;

use super::resample::resample_once;

pub fn read_wav(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let mut r = hound::WavReader::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let spec = r.spec();
    let ch = spec.channels.max(1) as usize;
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>().map_err(|e| e.to_string())?,
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
            r.samples::<i32>().map(|s| s.map(|v| v as f32 / scale)).collect::<Result<_, _>>().map_err(|e| e.to_string())?
        }
    };
    let mono = if ch == 1 {
        interleaved
    } else {
        interleaved.chunks_exact(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect()
    };
    Ok((mono, spec.sample_rate))
}

pub fn read_wav_16k(path: &Path) -> Result<Vec<f32>, String> {
    let (x, rate) = read_wav(path)?;
    Ok(if rate == 16000 { x } else { resample_once(&x, rate, 16000) })
}

pub fn write_wav_16k(path: &Path, samples: &[f32]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let spec = hound::WavSpec { channels: 1, sample_rate: 16000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for &s in samples {
        w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())
}
