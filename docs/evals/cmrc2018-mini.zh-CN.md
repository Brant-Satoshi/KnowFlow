# CMRC 2018 中文评测集

这套数据取自 [CMRC 2018](https://github.com/ymcui/cmrc2018) **开发集**，包含 25 篇原文和 100 道中文题，在 `/eval` 中注册为 `cmrc2018-mini`。根据[原作者项目页面](https://ymcui.com/cmrc2018/)，原数据采用 CC BY-SA 4.0 许可；这里保留来源与许可归属。未使用官方隐藏测试集。

源文件是固定提交 `c0eb1b6ba219847457e6af3180da722bbeb656af` 中的 [`cmrc2018_dev.json`](https://github.com/ymcui/cmrc2018/blob/c0eb1b6ba219847457e6af3180da722bbeb656af/data/cmrc2018_dev.json)，原始 JSON 的 SHA-256 为 `5cfe4414c28a8ecbb51670f78c0dc7d1049f286c2d5769b52f1f94bcc0752cf1`。

生成脚本按原文顺序筛选：每篇需有 4 道答案不同的问题；问题须明确写出原文主题，答案须在原文中逐字出现，证据片段须能完整落在索引分块中。取前 25 篇合格原文，每篇 4 道，共 100 道可回答题。人工抽查时发现两条原始标注矛盾或损坏，脚本将其排除。生成的原文位于 `tests/fixtures/cmrc2018-*.txt`，文件名与 `lib/eval/cmrc2018-mini.json` 中的引用一致。

## 重新生成与核对

```sh
pnpm import:cmrc2018
pnpm import:cmrc2018 -- --check
```

脚本下载固定版本的原始 JSON，并校验 SHA-256。离线运行时，先下载该 JSON，再给命令加上 `--source=/path/to/cmrc2018_dev.json`。`--check` 只逐字节比较现有文件，不修改它们。

## 在 KnowFlow 中运行

1. 为这套评测集新建知识库。
2. 将 25 份 `tests/fixtures/cmrc2018-*.txt` 原文上传到该知识库，**保留文件名**。当前上传面板一次处理一个文件；等待每份文件都显示 `indexed`。
3. 打开 `/eval`，选择该知识库及 `cmrc2018-mini`，确认 25 份文件均已索引。“数据集”页签检查的是仓库 fixture，而不是当前知识库；确认 fixture 没有错误或警告后再启动评测。

标准答案只保存在评测 JSON 中。上传 TXT 原文即可，无需上传 JSON，也无需运行数据库迁移、演示数据种子或重新嵌入已有文件。

这套题没有无答案问题，因此不能测拒答率；可用 `olympus-zh` 测拒答。当前评测器会展示 `expectedAnswer`，但不会据此自动判定答案是否正确；Hit@K 也不代表完整证据召回率。这套数据供项目本地回归比较使用，不等同于官方 CMRC 排行榜成绩。
