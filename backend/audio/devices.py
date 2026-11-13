"""
[INPUT]: 依赖 sounddevice（PortAudio 设备表）
[OUTPUT]: 导出 InputDevice、list_inputs()、resolve_device()、make_ids()、PREFERRED_HOSTAPIS
[POS]: audio 子模块的设备目录。engine 的 devices.list 与 mic.configure 都经过这里。
       稳定 id 规则：只列一个宿主 API 的设备（Windows 优先 WASAPI，名称完整、延迟低；MME 会把名字截到 31 字），
       id = "<api>:<设备名>"，重名设备按出现顺序追加 "#2"、"#3"。PortAudio 的数字下标会随插拔变化，不能当 id。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass

log = logging.getLogger("echotype.devices")

PREFERRED_HOSTAPIS: dict[str, tuple[str, ...]] = {
    "win32": ("Windows WASAPI", "MME", "Windows DirectSound"),
    "darwin": ("Core Audio",),
    "linux": ("ALSA", "JACK Audio Connection Kit"),
}
_API_TAG = {
    "Windows WASAPI": "wasapi",
    "MME": "mme",
    "Windows DirectSound": "ds",
    "Windows WDM-KS": "wdmks",
    "ASIO": "asio",
    "Core Audio": "coreaudio",
    "ALSA": "alsa",
    "JACK Audio Connection Kit": "jack",
}


@dataclass(frozen=True)
class InputDevice:
    id: str
    name: str
    index: int  # PortAudio 下标，仅在本次枚举内有效
    hostapi: str
    is_default: bool
    default_sample_rate: int
    max_channels: int

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "is_default": self.is_default,
            "default_sample_rate": self.default_sample_rate,
            "max_channels": self.max_channels,
        }


def make_ids(tag: str, names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for name in names:
        seen[name] = seen.get(name, 0) + 1
        suffix = "" if seen[name] == 1 else f"#{seen[name]}"
        out.append(f"{tag}:{name}{suffix}")
    return out


def refresh_portaudio() -> None:
    """重新初始化 PortAudio，以便看见新插入的设备。调用方保证此时没有打开的流。"""
    import sounddevice as sd  # noqa: PLC0415

    sd._terminate()  # noqa: SLF001  sounddevice 没有公开的刷新接口
    sd._initialize()  # noqa: SLF001


def list_inputs() -> list[InputDevice]:
    import sounddevice as sd  # noqa: PLC0415

    hostapis = sd.query_hostapis()
    devices = sd.query_devices()
    prefs = PREFERRED_HOSTAPIS.get(sys.platform if sys.platform in PREFERRED_HOSTAPIS else "linux", ())
    for api_name in prefs + tuple(h["name"] for h in hostapis):
        api_idx = next((i for i, h in enumerate(hostapis) if h["name"] == api_name), None)
        if api_idx is None:
            continue
        api = hostapis[api_idx]
        members = [i for i in api["devices"] if devices[i]["max_input_channels"] > 0]
        if not members:
            continue
        tag = _API_TAG.get(api_name, api_name.lower().replace(" ", "-"))
        ids = make_ids(tag, [devices[i]["name"] for i in members])
        default_idx = api.get("default_input_device", -1)
        return [
            InputDevice(
                id=dev_id,
                name=devices[i]["name"],
                index=i,
                hostapi=api_name,
                is_default=(i == default_idx),
                default_sample_rate=int(devices[i]["default_samplerate"]),
                max_channels=int(devices[i]["max_input_channels"]),
            )
            for dev_id, i in zip(ids, members)
        ]
    return []


def resolve_device(device_id: str | None, inputs: list[InputDevice]) -> tuple[InputDevice | None, bool]:
    """返回 (设备, 是否发生了回退)。device_id 为 None 表示系统默认设备；找不到时回退到默认设备。"""
    if not inputs:
        return None, device_id is not None
    default = next((d for d in inputs if d.is_default), inputs[0])
    if device_id is None:
        return default, False
    match = next((d for d in inputs if d.id == device_id), None)
    if match is not None:
        return match, False
    log.warning("input device %r not found; falling back to %r", device_id, default.id)
    return default, True
