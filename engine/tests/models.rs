//! [INPUT]: 环境变量 ECHOTYPE_TEST_MODELS_DIR（Core 布局 <dir>/<model>/<variant>/）与 ECHOTYPE_TEST_WAVS（含 zh.wav、en.wav）；
//!          contracts/models.catalog.json；echotype_engine 的 asr::load_model、dictation::segments、asr::vad
//! [OUTPUT]: cargo test 用例：目录里每个已安装、本机可运行的 ASR 版本真实加载（含 companion 标点）并转写中英文样例
//! [POS]: MODEL_MANIFEST §4「arch 行必须经过真实加载 + 解码」的证明。未设置环境变量时跳过，CI 不依赖 GB 级模型。
//!        运行：ECHOTYPE_TEST_MODELS_DIR=… ECHOTYPE_TEST_WAVS=… cargo test --release --test models -- --nocapture
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::PathBuf;

use echotype_engine::asr::providers::capabilities;
use echotype_engine::asr::vad::{Detector, SpeechDetector, MAIN_VAD};
use echotype_engine::asr::{load_model, LoadParams, ModelSettings};
use echotype_engine::audio::wav::read_wav_16k;
use echotype_engine::dictation::segments::SegmentTrack;
use serde_json::{json, Map, Value};

fn catalog() -> Value {
    serde_json::from_str(include_str!("../../contracts/models.catalog.json")).unwrap()
}

#[test]
fn every_installed_variant_loads_and_transcribes_zh_and_en() {
    let (Some(models), Some(wavs)) = (std::env::var_os("ECHOTYPE_TEST_MODELS_DIR"), std::env::var_os("ECHOTYPE_TEST_WAVS")) else {
        eprintln!("skipped: set ECHOTYPE_TEST_MODELS_DIR and ECHOTYPE_TEST_WAVS");
        return;
    };
    let (models, wavs) = (PathBuf::from(models), PathBuf::from(wavs));
    let cat = catalog();
    let by_id: Map<String, Value> = cat["models"].as_array().unwrap().iter().map(|m| (m["id"].as_str().unwrap().to_string(), m.clone())).collect();
    let caps = capabilities();
    let mut tested = 0;
    for m in cat["models"].as_array().unwrap() {
        if m["kind"] != "asr" {
            continue;
        }
        for v in m["variants"].as_array().unwrap() {
            let dir = models.join(m["id"].as_str().unwrap()).join(v["id"].as_str().unwrap());
            let provider = v["providers"][0].as_str().unwrap();
            if !dir.is_dir() || !caps.providers().contains(&provider) {
                continue;
            }
            let mut model = m.as_object().unwrap().clone();
            model.remove("variants");
            let companion = model.get("punctuation").and_then(|p| p.get("companion_id")).and_then(Value::as_str).map(|cid| {
                let cv = by_id[cid]["variants"][0].as_object().unwrap().clone();
                let cdir = models.join(cid).join(cv["id"].as_str().unwrap());
                (cv, cdir)
            });
            let settings = ModelSettings::parse(json!({"provider": provider, "punct_style": "auto"}).as_object().unwrap()).unwrap();
            let params = LoadParams { model, variant: v.as_object().unwrap().clone(), model_dir: dir, settings, companion };
            let (host, info) = load_model(params, &|_, _| {}, &|c, m| eprintln!("warning {c}: {m}")).unwrap_or_else(|e| panic!("{} {}: {e}", m["id"], v["id"]));
            let langs: Vec<&str> = m["languages"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
            let mut texts = Vec::new();
            for lang in ["zh", "en"] {
                if !langs.contains(&lang) {
                    continue;
                }
                let audio = read_wav_16k(&wavs.join(format!("{lang}.wav"))).unwrap();
                let mut det = SpeechDetector::new(MAIN_VAD).unwrap();
                let mut spans = det.accept(&audio);
                spans.extend(det.flush());
                let mut track = SegmentTrack::default();
                for (s, e) in spans {
                    track.add(s, e, audio.len());
                }
                for i in 0..track.segments.len() {
                    let (s, e) = (track.segments[i].start, track.segments[i].end);
                    track.segments[i].text = Some(host.decode(&audio[s..e], None).unwrap().text);
                    track.segments[i].decoded = true;
                }
                let (text, _) = host.finish_text(&track.joined(track.segments.len(), None));
                eprintln!("{} {} [{}] {lang}: {text}", m["id"], v["id"], info["provider_used"]);
                if lang == "zh" {
                    assert!(text.contains("时间") || text.contains("時間"), "{} zh: {text}", m["id"]);
                } else {
                    let low = text.to_lowercase();
                    let hits = ["tribal", "chief", "boy", "presented", "fifty", "pieces", "gold"].iter().filter(|k| low.contains(*k)).count();
                    assert!(hits >= 3, "{} en: {text}", m["id"]);
                }
                texts.push(text);
            }
            host.close();
            tested += 1;
        }
    }
    eprintln!("tested {tested} variants");
    assert!(tested > 0, "no installed variant found under {}", models.display());
}
