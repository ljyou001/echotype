# AGPLv3+CLA License Compatibility Check

**AGPLv3+CLA 许可证兼容性检查**

This document summarizes the licenses of project dependencies to assess the feasibility of using **AGPLv3 + CLA (Contributor License Agreement)**. **Conclusion: All current dependencies are compatible with AGPLv3; you may adopt AGPLv3+CLA.**

本文档汇总项目依赖的许可证，用于评估采用 **AGPLv3 + CLA（贡献者许可协议）** 的可行性。**结论：当前依赖均与 AGPLv3 兼容，可采用 AGPLv3+CLA。**

---

## 1. Backend Dependencies (Python) / 后端依赖（Python）

| Dependency / 依赖 | License / 许可证 | AGPLv3 compatible / 与 AGPLv3 兼容 |
|------------------|------------------|------------------------------------|
| websockets | BSD-3-Clause | ✅ Permissive; OK as dependency / 宽松许可，可作依赖 |
| numpy | BSD-3-Clause | ✅ |
| jieba | MIT | ✅ |
| sherpa_onnx | Apache-2.0 | ✅ FSF considers compatible with GPLv3 / FSF 认定与 GPLv3 兼容 |
| funasr_onnx | MIT | ✅ |
| kaldi-native-fbank | Apache-2.0 | ✅ |
| qwen-asr | Apache-2.0 | ✅ |
| sounddevice | MIT / similar permissive | ✅ |

All of the above are permissive (MIT/BSD/Apache-2.0) and may be used as dependencies in an AGPLv3 project; you need only retain their respective copyright and license notices.

以上均为宽松许可（MIT/BSD/Apache-2.0），可在 AGPLv3 项目中作为依赖使用；仅需保留其各自版权与许可声明。

---

## 2. Frontend Dependencies (npm) / 前端依赖（npm）

### Direct dependencies / 直接依赖

- **React / react-dom / react-i18next**: MIT  
- **@dnd-kit/*, zustand, i18next, jimp, react-icons**: MIT  
- **@hurdlegroup/robotjs**: MIT  
- **uiohook-napi**: MIT (underlying **libuiohook** is **GPLv3**; see below)  
  - **uiohook-napi**：MIT（底层 **libuiohook** 为 **GPLv3**，见下）  
- **electron** (dev): MIT  
- **vite, typescript** and other build/dev tools: mostly MIT / ISC / BSD  

### License types in transitive dependencies (from package-lock.json) / 传递依赖中的许可证类型（来自 package-lock.json）

- **MIT, ISC, BSD-2-Clause, BSD-3-Clause**: All permissive; compatible with AGPLv3.  
  **MIT、ISC、BSD-2-Clause、BSD-3-Clause**：均为宽松许可，与 AGPLv3 兼容。  
- **Apache-2.0**: Compatible with GPLv3/AGPLv3 (FSF); may be used together.  
  **Apache-2.0**：与 GPLv3/AGPLv3 兼容（FSF 认定），可一并使用。  
- **Python-2.0** (PSF License): GPL-compatible permissive license.  
  **Python-2.0**（PSF License）：GPL 兼容的宽松许可。  
- **BlueOak-1.0.0**: Permissive. / 宽松许可。  
- **CC-BY-4.0**: Attribution license; commercial use and sublicensing allowed with attribution; may coexist with an AGPLv3 project (often used for assets/docs).  
  **CC-BY-4.0**：署名许可，可商用、可再许可，需保留署名；与 AGPLv3 项目可共存（通常用于资源/文档）。  

There are no **GPL-incompatible**, **non-commercial-only**, or **AGPL-conflicting** licenses.

无 **GPL-incompatible**、**禁止商用** 或 **与 AGPL 冲突** 的许可。

---

## 3. Note: libuiohook (GPLv3) / 需要留意的点：libuiohook（GPLv3）

- The underlying C library **libuiohook** used by **uiohook-napi** is licensed under **GPL v3**.  
  **uiohook-napi** 的底层 C 库 **libuiohook** 使用 **GPL v3**。  

- **GPLv3 and AGPLv3 are compatible**:  
  **GPLv3 与 AGPLv3 兼容**：  
  - A “combined work” that links with GPLv3 code may be distributed under GPLv3 or a stricter license (e.g. AGPLv3).  
    与 GPLv3 代码链接形成的“整体作品”可以按 GPLv3 或更严的许可（如 AGPLv3）分发。  
  - Using AGPLv3 for the combined work satisfies GPLv3’s “open source + same license” requirements, so **you may use them together** from a license perspective.  
    你采用 AGPLv3 更严，满足 GPLv3 的“开源 + 同许可”要求，因此 **在许可证上可以一起用**。  

- **Recommendation**: In `NOTICE` or `THIRD_PARTY`, state that libuiohook (GPLv3) is used and retain its COPYING/full license text; when distributing binaries, provide corresponding source or a way to obtain it (AGPLv3 already requires source; same practice).  
  **建议**：在 `NOTICE` 或 `THIRD_PARTY` 中注明使用了 libuiohook（GPLv3），并保留其 COPYING/许可证全文；若分发二进制，需提供对应源码或源码获取方式（AGPLv3 本身也要求提供源码，做法一致）。

---

## 4. Conclusion and Recommendations / 结论与建议

1. **You may adopt AGPLv3+CLA**  
   **可以采用 AGPLv3+CLA**  
   All current dependencies (backend Python packages, frontend npm packages, and libuiohook) are compatible with AGPLv3 and do not prevent you from using AGPLv3+CLA.  
   当前所有引用（后端 Python 包、前端 npm 包及底层 libuiohook）均与 AGPLv3 兼容，不会阻碍你使用 AGPLv3+CLA。

2. **Compliance recommendations**  
   **合规建议**  
   - Add `LICENSE` (full AGPLv3 text) and `CONTRIBUTING.md` or separate CLA text in the repository root.  
     在仓库根目录添加 `LICENSE`（AGPLv3 全文）和 `CONTRIBUTING.md` 或单独 CLA 说明。  
   - Maintain a `NOTICE` or `THIRD_PARTY_LICENSES.md` listing major dependencies and their licenses (at least: libuiohook GPLv3; optionally: sherpa_onnx / qwen-asr / kaldi-native-fbank Apache-2.0, and notable MIT/BSD components).  
     维护 `NOTICE` 或 `THIRD_PARTY_LICENSES.md`，列出主要依赖及其许可证（至少：libuiohook GPLv3；可选：sherpa_onnx / qwen-asr / kaldi-native-fbank 等 Apache-2.0，以及 MIT/BSD 的显著组件）。  
   - If a dependency requires retention of its license notice (e.g. Apache-2.0, BSD), retain it when distributing; AGPLv3 does not prohibit multiple license notices.  
     若某依赖要求保留其许可声明（如 Apache-2.0、BSD），在分发时保留即可；AGPLv3 不禁止保留多份许可声明。

3. **CLA and AGPLv3**  
   **CLA 与 AGPLv3**  
   The CLA only governs the rights contributors grant to you; it does not change the project’s public license. Using AGPLv3+CLA is common practice and does not conflict with the current dependencies.  
   CLA 仅约束“贡献者授予你的权利”，不改变项目对外许可。采用 AGPLv3+CLA 是常见做法，与当前依赖无冲突。

---

*Last checked: Based on dependency versions and public license information as of early 2026. Recheck periodically if dependencies are upgraded or upstream changes their license.*  
*检查日期：基于 2026 年初的依赖版本与公开许可证信息。若依赖升级或上游变更许可证，建议定期复查。*
