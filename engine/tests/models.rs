//! [INPUT]: 环境变量 ECHOTYPE_TEST_MODELS_DIR（Core 布局 <dir>/<model>/<variant>/）与 ECHOTYPE_TEST_WAVS（含 zh.wav、en.wav，
//!          缺省 engine/target/test-wavs，由 scripts/fetch-test-wavs.sh 下载）；contracts/models.catalog.json；
//!          echotype_engine 的 asr::load_model、asr::vad、dictation::{DictationSession, offline::transcribe}
//! [OUTPUT]: cargo test 用例：① 每个已安装、本机可运行的 ASR 版本真实加载（含 companion 标点）并转写中英文样例；
//!           ② 同一样例按实时节奏走听写（停 0.3 s 松键）：final 只有一个解码单元，且与 transcribe.file 对同一份录音
//!              （record_to）的 final 逐字一致；另打印对原始样例的 transcribe.file 与整段解码，供人工对照
//! [POS]: MODEL_MANIFEST §4「arch 行必须经过真实加载 + 解码」与「准确率不随切分变化」的证明。未设置 ECHOTYPE_TEST_MODELS_DIR
//!        时跳过，CI 不依赖 GB 级模型。运行：ECHOTYPE_TEST_MODELS_DIR=… cargo test --release --test models -- --nocapture
//! [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use echotype_engine::asr::host::ModelHost;
use echotype_engine::asr::providers::capabilities;
use echotype_engine::asr::vad::{SpeechDetector, SEGMENT_VAD};
use echotype_engine::asr::{load_model, LoadParams, ModelSettings};
use echotype_engine::audio::wav::read_wav_16k;
use echotype_engine::audio::Sink;
use echotype_engine::dictation::offline::transcribe;
use echotype_engine::dictation::DictationSession;
use echotype_engine::events::Emitter;
use echotype_engine::text::close_dangling;
use serde_json::{json, Map, Value};

fn catalog() -> Value {
    serde_json::from_str(include_str!("../../contracts/models.catalog.json")).unwrap()
}

/// 样例目录：ECHOTYPE_TEST_WAVS，缺省为 fetch-test-wavs.sh 的缓存目录
fn wavs_dir() -> PathBuf {
    std::env::var_os("ECHOTYPE_TEST_WAVS").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join("test-wavs"))
}

/// 目录里每个已安装、本机能跑的 ASR 版本：按 Core 的方式加载（settings 取 catalog 默认值 + provider），交给 f
fn for_each_installed(mut f: impl FnMut(&Value, &Value, &Arc<ModelHost>, &str)) -> Option<usize> {
    let models = PathBuf::from(std::env::var_os("ECHOTYPE_TEST_MODELS_DIR")?);
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
            let mut settings = json!({"provider": provider});
            for s in m["settings"].as_array().into_iter().flatten() {
                settings[s["key"].as_str().unwrap()] = s["default"].clone();
            }
            let settings = ModelSettings::parse(settings.as_object().unwrap()).unwrap();
            let params = LoadParams { model, variant: v.as_object().unwrap().clone(), model_dir: dir, settings, companion };
            let (host, info) = load_model(params, &|_, _| {}, &|c, m| eprintln!("warning {c}: {m}")).unwrap_or_else(|e| panic!("{} {}: {e}", m["id"], v["id"]));
            f(m, v, &host, info["provider_used"].as_str().unwrap_or("?"));
            host.close();
            tested += 1;
        }
    }
    Some(tested)
}

fn clips_for(m: &Value) -> Vec<&'static str> {
    let langs: Vec<&str> = m["languages"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    ["zh", "en"].into_iter().filter(|l| langs.contains(l)).collect()
}

fn clip(lang: &str) -> Vec<f32> {
    let path = wavs_dir().join(format!("{lang}.wav"));
    read_wav_16k(&path).unwrap_or_else(|e| panic!("{}: {e} (run engine/scripts/fetch-test-wavs.sh)", path.display()))
}

/// 听写：按实时节奏喂 0.3 s 预录静音 + 样例 + 0.3 s 静音（smoke:real 的「停 0.3 s 松键」），再 stop。
/// 录音写到 record_to；返回 final 的 data（text、timings…）
fn dictate(host: &Arc<ModelHost>, audio: &[f32], record_to: &std::path::Path) -> Value {
    let vad: Box<dyn echotype_engine::asr::Detector> = Box::new(SpeechDetector::new(SEGMENT_VAD).unwrap());
    let (emit, mut rx) = Emitter::collector();
    let session = DictationSession::new("t".into(), 1, host.clone(), Arc::new(Mutex::new(vad)), emit, None, Some(record_to.to_path_buf()), true, Box::new(|_: &str| {}));
    session.on_attach();
    let silence = vec![0.0f32; 4800];
    let stream: Vec<f32> = silence.iter().chain(audio).chain(&silence).copied().collect();
    let t0 = Instant::now();
    for (i, block) in stream.chunks(160).enumerate() {
        session.feed(block);
        let due = t0 + Duration::from_millis(10 * (i as u64 + 1));
        if let Some(wait) = due.checked_duration_since(Instant::now()) {
            std::thread::sleep(wait);
        }
    }
    session.finish(Instant::now());
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        while let Ok(ev) = rx.try_recv() {
            if ev["event"] == "final" {
                return ev["data"].clone();
            }
        }
        assert!(Instant::now() < deadline, "no final within 60 s");
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// 只比较词：小写，去掉标点与空白
fn words_of(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

#[test]
fn every_installed_variant_loads_and_transcribes_zh_and_en() {
    let tested = for_each_installed(|m, v, host, provider| {
        for lang in clips_for(m) {
            let text = transcribe(host, &mut SpeechDetector::new(SEGMENT_VAD).unwrap(), &clip(lang), None).unwrap().text;
            eprintln!("{} {} [{provider}] {lang}: {text}", m["id"], v["id"]);
            if lang == "zh" {
                assert!(text.contains("时间") || text.contains("時間"), "{} zh: {text}", m["id"]);
            } else {
                let low = text.to_lowercase();
                let hits = ["tribal", "chief", "boy", "presented", "fifty", "pieces", "gold"].iter().filter(|k| low.contains(*k)).count();
                assert!(hits >= 3, "{} en: {text}", m["id"]);
            }
        }
    });
    match tested {
        None => eprintln!("skipped: set ECHOTYPE_TEST_MODELS_DIR"),
        Some(n) => {
            eprintln!("tested {n} variants");
            assert!(n > 0, "no installed variant found");
        }
    }
}

#[test]
fn dictation_final_matches_transcribe_file() {
    let mut failures = Vec::new();
    let tested = for_each_installed(|m, v, host, provider| {
        for lang in clips_for(m) {
            let audio = clip(lang);
            let rec = std::env::temp_dir().join(format!("echotype-test-{}-{lang}.wav", std::process::id()));
            let fin = dictate(host, &audio, &rec);
            let dictated = fin["text"].as_str().unwrap().to_string();
            // record_to 在 final 发出之后才写（不让写盘计入 release_to_final），写完才改名出现；等它出现
            let t0 = Instant::now();
            let recording = loop {
                match read_wav_16k(&rec) {
                    Ok(x) => break x,
                    Err(e) if t0.elapsed() > Duration::from_secs(5) => panic!("record_to not written: {e}"),
                    Err(_) => std::thread::sleep(Duration::from_millis(20)),
                }
            };
            let _ = std::fs::remove_file(&rec);
            let file = transcribe(host, &mut SpeechDetector::new(SEGMENT_VAD).unwrap(), &recording, None).unwrap().text;
            let file_clip = transcribe(host, &mut SpeechDetector::new(SEGMENT_VAD).unwrap(), &audio, None).unwrap().text;
            let (whole, _) = host.finish_text(&host.decode(&audio, None).unwrap().text);
            let whole = close_dangling(&whole);
            eprintln!(
                "{} {} [{provider}] {lang}: {} unit(s), release_to_final {} ms\n  dictation:            {dictated}\n  file (same recording): {file}\n  file (source clip):    {file_clip}{}\n  whole-clip decode:     {whole}{}",
                m["id"], v["id"], fin["timings"]["segments"], fin["timings"]["release_to_final_ms"],
                if words_of(&file_clip) == words_of(&dictated) { "" } else { "   <- other words" },
                if words_of(&whole) == words_of(&dictated) { "" } else { "   <- other words" },
            );
            if dictated != file {
                failures.push(format!("{} {} {lang}: dictation {dictated:?} != transcribe.file of the same recording {file:?}", m["id"], v["id"]));
            }
            if fin["timings"]["segments"] != 1 {
                failures.push(format!("{} {} {lang}: the clip was split into {} decode units", m["id"], v["id"], fin["timings"]["segments"]));
            }
        }
    });
    match tested {
        None => eprintln!("skipped: set ECHOTYPE_TEST_MODELS_DIR"),
        Some(n) => {
            eprintln!("compared {n} variants");
            assert!(n > 0, "no installed variant found");
            assert!(failures.is_empty(), "{}", failures.join("\n"));
        }
    }
}

// ============================================================
// 时序抖动：样例起点偏移几毫秒（VAD 的 32 ms 帧落点随之改变）× 松键延迟
// ============================================================
const JITTER_MODELS: &[&str] = &["sensevoice-small", "paraformer-zh-small", "paraformer-zh"];

/// 预录静音（300 ms + 偏移）+ 样例 + 松键前的静音：会话缓冲区里的样子
fn jittered(clip: &[f32], offset_ms: usize, delay_ms: usize) -> (Vec<f32>, usize) {
    let lead = 4800 + offset_ms * 16;
    let mut x = vec![0.0f32; lead];
    x.extend_from_slice(clip);
    x.extend(std::iter::repeat_n(0.0f32, delay_ms * 16));
    (x, lead)
}

/// 首尾「词」：英文取首尾单词，中文取首尾两个字（去掉标点后）
fn edges(text: &str) -> (String, String) {
    let w: Vec<String> = text.split(|c: char| !c.is_alphanumeric()).filter(|s| !s.is_empty()).map(str::to_lowercase).collect();
    if w.len() > 1 {
        return (w[0].clone(), w[w.len() - 1].clone());
    }
    let c: Vec<char> = words_of(text).chars().collect();
    let n = c.len();
    (c[..2.min(n)].iter().collect(), c[n.saturating_sub(2)..].iter().collect())
}

#[test]
#[ignore = "measurement: ECHOTYPE_TEST_MODELS_DIR=… cargo test --release --test models -- --ignored --nocapture jitter"]
fn jitter_report() {
    use echotype_engine::asr::vad::Detector;
    use echotype_engine::dictation::segments::UnitBuilder;
    use std::collections::BTreeMap;
    for_each_installed(|m, v, host, _| {
        if !JITTER_MODELS.contains(&m["id"].as_str().unwrap()) || v["id"] != "cpu-int8" {
            return;
        }
        for lang in clips_for(m) {
            let audio = clip(lang);
            for delay in [150, 300, 600] {
                let mut firsts: BTreeMap<String, usize> = BTreeMap::new();
                let mut lasts: BTreeMap<String, usize> = BTreeMap::new();
                let mut spans: BTreeMap<(i64, i64), usize> = BTreeMap::new();
                let mut texts: BTreeMap<String, usize> = BTreeMap::new();
                for offset in (0..=64).step_by(4) {
                    let (x, lead) = jittered(&audio, offset, delay);
                    let mut vad = SpeechDetector::new(SEGMENT_VAD).unwrap();
                    let mut segs = vad.accept(&x);
                    segs.extend(vad.flush());
                    for u in UnitBuilder::units(&segs) {
                        *spans.entry((u.start as i64 - lead as i64, u.end as i64 - lead as i64)).or_default() += 1;
                    }
                    let t = transcribe(host, &mut SpeechDetector::new(SEGMENT_VAD).unwrap(), &x, None).unwrap().text;
                    let (f, l) = edges(&t);
                    *firsts.entry(f).or_default() += 1;
                    *lasts.entry(l).or_default() += 1;
                    *texts.entry(t).or_default() += 1;
                }
                eprintln!("JITTER {} {lang} delay {delay} ms | first {firsts:?} | last {lasts:?} | {} span(s) {:?} | {} text(s)",
                    m["id"].as_str().unwrap(), spans.len(), spans.keys().map(|(a, b)| (a / 16, b / 16)).collect::<Vec<_>>(), texts.len());
                for (t, n) in &texts {
                    eprintln!("JITTER     {n:2}× {t}");
                }
            }
        }
    });
}

#[test]
fn text_is_stable_when_the_clip_starts_a_few_ms_later() {
    use std::collections::BTreeSet;
    let mut failures = Vec::new();
    let tested = for_each_installed(|m, v, host, provider| {
        if !JITTER_MODELS.contains(&m["id"].as_str().unwrap()) {
            return;
        }
        for lang in clips_for(m) {
            let audio = clip(lang);
            let texts: BTreeSet<String> = (0..=64)
                .step_by(8)
                .map(|offset| transcribe(host, &mut SpeechDetector::new(SEGMENT_VAD).unwrap(), &jittered(&audio, offset, 300).0, None).unwrap().text)
                .collect();
            eprintln!("{} {} [{provider}] {lang}: {} text(s) over 9 start offsets: {texts:?}", m["id"], v["id"], texts.len());
            if texts.len() != 1 {
                failures.push(format!("{} {} {lang}: {texts:?}", m["id"], v["id"]));
            }
        }
    });
    match tested {
        None => eprintln!("skipped: set ECHOTYPE_TEST_MODELS_DIR"),
        Some(_) => assert!(failures.is_empty(), "text depends on the start offset:
{}", failures.join("
")),
    }
}
