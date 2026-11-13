/**
 * [INPUT]: 依赖 store/appStore 的 settings 与 updateSettings；依赖 hooks 的 useAudioInputs、useMicTest、useHotkeyLabel；
 *          依赖 components 的 PageHeader/Section/SettingRow、Switch/Segmented、LevelMeter、HotkeyModal、KeyHint；
 *          依赖 i18n/config 的 SUPPORTED_LANGUAGES；依赖 ./settings/AboutSection
 * [OUTPUT]: 导出 SettingsPage 组件
 * [POS]: 全局设置页。五个分节：通用、听写、麦克风、隐私、关于。每项改动立即经 updateSettings 交给 Core 校验与持久化，
 *        没有"保存"按钮。模型相关设置（标点、标点风格、数字格式化、语言、运行设备）在 Models 页，不在这里。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiRefreshCw } from "react-icons/fi";
import type { RecordingMode, Settings } from "../../electron/ipc-contract";
import { Segmented, Switch } from "../components/controls";
import { HotkeyModal } from "../components/HotkeyModal";
import { KeyHint } from "../components/KeyHint";
import { PageHeader, Section, SettingRow } from "../components/layout";
import { LevelMeter } from "../components/LevelMeter";
import { useAudioInputs } from "../hooks/useAudioInputs";
import { useHotkeyLabel } from "../hooks/useHotkeyLabel";
import { useMicTest } from "../hooks/useMicTest";
import { SUPPORTED_LANGUAGES } from "../i18n/config";
import { selectSettings, useAppStore } from "../store/appStore";
import { KEY_TOKEN } from "../utils/format";
import { AboutSection } from "./settings/AboutSection";
import "./SettingsPage.css";

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="page settings">
      <PageHeader title={t("settings.title")} description={t("settings.description")} />
      <GeneralSection />
      <DictationSection />
      <MicrophoneSection />
      <PrivacySection />
      <p className="settings__footnote">{t("settings.modelSettingsMoved")}</p>
      <AboutSection />
    </div>
  );
}

// ============================================================
// 通用
// ============================================================
function GeneralSection() {
  const { t } = useTranslation();
  const settings = useAppStore(selectSettings);
  const update = useAppStore((s) => s.updateSettings);

  return (
    <Section title={t("settings.sections.general")}>
      <SettingRow
        label={t("settings.language.title")}
        description={t("settings.language.description")}
        htmlFor="ui-language"
        control={
          <select
            id="ui-language"
            className="select"
            value={settings.ui.language}
            onChange={(e) => update({ ui: { language: e.target.value } })}
          >
            <option value="system">{t("settings.language.systemDefault")}</option>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        }
      />
      <SettingRow
        label={t("settings.startup.autoStart")}
        description={t("settings.startup.autoStartDescription")}
        control={
          <Switch
            label={t("settings.startup.autoStart")}
            checked={settings.ui.launchAtStartup}
            onChange={(v) => update({ ui: { launchAtStartup: v } })}
          />
        }
      />
    </Section>
  );
}

// ============================================================
// 听写：热键、录音模式、输出方式
// 输出用三选一，而不是两个开关：从结构上杜绝"两个都关"的非法状态
// ============================================================
type OutputChoice = "paste" | "copy" | "both";

const OUTPUT_PATCH: Record<OutputChoice, Settings["output"]> = {
  paste: { directInput: true, clipboard: false },
  copy: { directInput: false, clipboard: true },
  both: { directInput: true, clipboard: true },
};

function outputChoiceOf({ directInput, clipboard }: Settings["output"]): OutputChoice {
  if (directInput && clipboard) return "both";
  return clipboard ? "copy" : "paste";
}

function DictationSection() {
  const { t } = useTranslation();
  const settings = useAppStore(selectSettings);
  const update = useAppStore((s) => s.updateSettings);
  const hotkey = useHotkeyLabel();
  const [editingHotkey, setEditingHotkey] = useState(false);
  const output = outputChoiceOf(settings.output);
  const mode = settings.recording.mode;

  return (
    <Section title={t("settings.sections.dictation")}>
      <SettingRow
        label={t("settings.hotkey.title")}
        description={t("settings.hotkey.rowDescription")}
        control={
          <div className="hotkey-control">
            <kbd className="hotkey-control__key">{hotkey}</kbd>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditingHotkey(true)}>
              {t("settings.hotkey.change")}
            </button>
          </div>
        }
      />
      <SettingRow
        label={t("settings.recordingMode.title")}
        description={
          <KeyHint
            keyLabel={hotkey}
            text={t(mode === "toggle" ? "settings.recordingMode.toggleExplain" : "settings.recordingMode.holdExplain", {
              key: KEY_TOKEN,
            })}
          />
        }
        control={
          <Segmented<RecordingMode>
            label={t("settings.recordingMode.title")}
            value={mode}
            onChange={(value) => update({ recording: { mode: value } })}
            options={[
              { value: "push-to-talk", label: t("settings.recordingMode.pushToTalk") },
              { value: "toggle", label: t("settings.recordingMode.toggleMode") },
            ]}
          />
        }
      />
      <SettingRow
        label={t("settings.output.title")}
        description={t(`settings.output.${output}Description`)}
        control={
          <Segmented<OutputChoice>
            label={t("settings.output.title")}
            value={output}
            onChange={(value) => update({ output: OUTPUT_PATCH[value] })}
            options={[
              { value: "paste", label: t("settings.output.paste") },
              { value: "copy", label: t("settings.output.copy") },
              { value: "both", label: t("settings.output.both") },
            ]}
          />
        }
      />
      {editingHotkey && (
        <HotkeyModal
          current={settings.hotkey.accelerator}
          onClose={() => setEditingHotkey(false)}
          onSave={(accelerator) => {
            void update({ hotkey: { accelerator } });
            setEditingHotkey(false);
          }}
        />
      )}
    </Section>
  );
}

// ============================================================
// 麦克风：设备、测试、常驻
// ============================================================
function MicrophoneSection() {
  const { t } = useTranslation();
  const settings = useAppStore(selectSettings);
  const update = useAppStore((s) => s.updateSettings);
  const { inputs, refresh } = useAudioInputs(settings.audio.inputDeviceId);
  const [testing, setTesting] = useMicTest();
  const systemDefault = inputs.find((i) => i.isDefault);

  return (
    <Section title={t("settings.sections.microphone")}>
      <SettingRow
        stacked
        label={t("settings.audio.title")}
        description={t("settings.audio.description")}
        htmlFor="input-device"
      >
        <div className="device-picker">
          <select
            id="input-device"
            className="select"
            value={settings.audio.inputDeviceId ?? ""}
            onChange={(e) => update({ audio: { inputDeviceId: e.target.value || null } })}
          >
            <option value="">
              {systemDefault
                ? t("settings.audio.systemDefaultNamed", { name: systemDefault.name })
                : t("settings.audio.systemDefault")}
            </option>
            {inputs.map((input) => (
              <option key={input.id} value={input.id}>
                {input.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={() => void refresh()}
            aria-label={t("settings.audio.refresh")}
            title={t("settings.audio.refresh")}
          >
            <FiRefreshCw />
          </button>
        </div>
      </SettingRow>

      <SettingRow
        stacked
        label={t("settings.audio.test")}
        description={t(testing ? "settings.audio.testOn" : "settings.audio.testDescription")}
        control={<Switch label={t("settings.audio.test")} checked={testing} onChange={setTesting} />}
      >
        <LevelMeter active={testing} label={t("settings.audio.level")} />
      </SettingRow>

      <SettingRow
        label={t("settings.audio.keepWarm")}
        description={t(settings.audio.keepMicWarm ? "settings.audio.keepWarmOn" : "settings.audio.keepWarmOff")}
        control={
          <Switch
            label={t("settings.audio.keepWarm")}
            checked={settings.audio.keepMicWarm}
            onChange={(v) => update({ audio: { keepMicWarm: v } })}
          />
        }
      />
    </Section>
  );
}

// ============================================================
// 隐私
// ============================================================
function PrivacySection() {
  const { t } = useTranslation();
  const settings = useAppStore(selectSettings);
  const update = useAppStore((s) => s.updateSettings);

  return (
    <Section title={t("settings.sections.privacy")}>
      <SettingRow
        label={t("settings.privacy.saveRecordings")}
        description={t("settings.privacy.saveRecordingsDescription")}
        control={
          <Switch
            label={t("settings.privacy.saveRecordings")}
            checked={settings.privacy.saveRecordings}
            onChange={(v) => update({ privacy: { saveRecordings: v } })}
          />
        }
      />
    </Section>
  );
}
