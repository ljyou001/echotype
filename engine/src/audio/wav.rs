//! [INPUT]: 依赖 hound（RIFF/WAVE 读写）、audio::resample::resample_once
//! [OUTPUT]: 导出 read_wav（任意 PCM/float wav → 单声道 f32 + 采样率）、read_wav_16k、write_wav_16k
//! [POS]: audio 子模块的文件读写。transcribe.file 与假麦克风读 wav，会话的 record_to 写 16 kHz int16 wav。
//!        读写同一刻度（int16 / 32768），int16 来源的音频往返无损：对 record_to 录音跑 transcribe.file，听到的就是会话听到的。
//!        写入先落到 <path>.wav.part 再改名，文件一出现就是完整的。
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
    // 先写临时文件再改名：读者（Core 的历史、transcribe.file）永远不会读到头部长度为 0 的半截文件
    let part = path.with_extension("wav.part");
    let mut w = hound::WavWriter::create(&part, spec).map_err(|e| e.to_string())?;
    for &s in samples {
        // 与 read_wav 同一刻度（/32768）并四舍五入：int16 来源的样本写出再读回逐样本相同。
        // 曾用 ×32767 再截断，录音整体衰减且每个样本偏 1，transcribe.file 重转写听到的不是会话听到的
        w.write_sample((s * 32768.0).round().clamp(-32768.0, 32767.0) as i16).map_err(|e| e.to_string())?;
    }
    w.finalize().map_err(|e| e.to_string())?;
    std::fs::rename(&part, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn int16_audio_round_trips_exactly() {
        let x: Vec<f32> = [-32768i32, -12345, -1, 0, 1, 2, 12345, 32767].iter().map(|&v| v as f32 / 32768.0).collect();
        let path = std::env::temp_dir().join(format!("echotype-wav-{}.wav", std::process::id()));
        write_wav_16k(&path, &x).unwrap();
        let y = read_wav_16k(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(x, y);
    }
}
