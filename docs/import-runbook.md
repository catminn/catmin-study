# 第一世界（命名空间版）导入手册 —— 新旧世界并存

线上现状（2026-10-28 只读查询）：已有无前缀旧版第一世界 49 条（全部 rev 1，2026-10-28 05:50 UTC 导入），两条旧存档。
本方案不删除、不覆盖任何旧记录：新开的游戏用 world01；两条旧存档是试玩，不保留（不迁移、不删除）。
每一步都只输出计数。任何一步结果不对就停下，把输出发给 Claude。所有命令在你电脑上的 catmin-study 目录里运行（PowerShell）。

## 0. 准备

    git pull
    $env:SITE="https://study.catmin.io"; $env:PASS="你的口令"

确认 Cloudflare → catmin-memory → Deployments 最上面一行是 main 最新提交、状态 Ready。

## 1. 备份（只读导出，文件含私有内容：只留在你电脑上，不要上传 GitHub）

    npx wrangler d1 export catmin-study --remote --output backup-before-world01.sql

另外 D1 自带 Time Travel（30 天内可回到任意时间点），是第二道保险：

    npx wrangler d1 time-travel info catmin-study

## 2. 转换与预检（本地，不联网）

    node scripts/namespace-bundle.mjs <GPT的旧版包.json> world01-ns.json world01 global-story-bible-v1
    node scripts/check-bundle-engine-compat.mjs world01-ns.json
    python scripts/import-bundle.py world01-ns.json --dry-run

如果 GPT 给的已经是命名空间候选包，跳过第一条，直接对它跑后两条。

## 3. 只读比对（不写入）

    python scripts/import-bundle.py world01-ns.json --compare

预期：missing=49，identical=0，different=0，onlineNotInBundle=0（全部是新增，不碰旧记录）。

## 4. 旧存档：不保留（Catherine 2026-10-28 决定）

两条旧存档是试玩，不需要保留，所以跳过固定步骤，也不删除任何东西：
导入并设默认世界后，新游戏进 world01；旧存档不再使用（其中未固定的那条会失败关闭，这是预期的）。
旧版无前缀内容与旧存档留在库里不影响新游戏；以后要清理，需要 Catherine 再次明确确认，由 Claude 给出命令。

## 5. 导入

    python scripts/import-bundle.py world01-ns.json

应打印“失败 0”和“世界清单：已校验通过”，并生成 world01-ns.json.manifest.json（只有 id 与修订，留在本地）。

## 6. 把新游戏的默认世界设为 world01

导入后线上有两个世界；不设默认时，新开的游戏会失败关闭（引擎不介入，不猜世界）。

    python scripts/import-bundle.py --set-default world01
    python scripts/import-bundle.py --world-status

默认世界只影响之后新开的游戏，已固定的存档永远不变。

## 7. 试玩与回滚

- 试玩：打开 /adventure 新开一局，应进入 world01。
- 回滚（从轻到重）：
  1. `--set-default <旧版世界 id>`（id 见 --world-status）——新游戏回到旧版，不删任何数据；
  2. 删除 world01:* 记录——需要你明确确认后由 Claude 给出命令；
  3. D1 Time Travel 回到第 1 步之前的时间点，或用备份文件恢复。
