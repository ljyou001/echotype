# scripts/models/
> L2 | Parent: ../../CLAUDE.md

成员清单
package-models.mjs: 模型打包主脚本。读 catalog，下载上游到 `%USERPROFILE%\.echotype-staging\upstream\`（curl 续传 + 上游 sha256 校验），解压并只保留 runtime 需要的文件，每个 zip 加一个 NOTICE.txt（署名、许可证、来源、许可证全文；许可信息在脚本的 LICENSE_INFO 表），用 bsdtar 打平 zip 到 `models-v3\`，校验后回写 `variants[].asset.{sha256,size_bytes,upstream_url}` 与 `variants[].files`。上游来源与保留清单只写在脚本顶部的 SOURCES 表，键是资产名（`<model>--<variant>` 或共享的 `<model>--gguf-q8`），共享同一资产的变体只打一次。标志: `--only <model id>`、`--list <model id>`、`--force`。
write-upload-doc.mjs: 读 catalog 与 staging 目录，生成 UPLOAD.md（按 release 分组：models-v3 清单与 gh 命令，engine-packs-v3 标 pending）。
UPLOAD.md: 给用户的上传说明。由 write-upload-doc.mjs 生成，不手改。

法则
- 只写 Node（`.mjs`），不引入 Python。
- 只改 catalog 的 `variants[].asset.{sha256,size_bytes,upstream_url}` 与 `variants[].files`，其余字段由契约方维护。
- 单个 zip 必须小于 2 GiB（GitHub Release 上限）。
- 脚本幂等：zip 已存在就跳过构建，仍会重新校验并回写 catalog。
- 脚本不上传任何东西，上传由用户执行 UPLOAD.md 里的命令。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
