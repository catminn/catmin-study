# 第一世界导入手册（Catherine 在场时执行）

所有命令在你电脑上的 catmin-study 仓库目录里运行（PowerShell）。任何一步结果不对就停下，把输出（只有计数）发给 Claude。

## 0. 先拉最新代码

    git pull

## 1. 只读检查线上旧数据（不改任何东西）

    npx wrangler d1 execute catmin-study --remote --command "SELECT kind, SUM(id LIKE '%:%') AS namespaced, SUM(id NOT LIKE '%:%') AS legacy FROM (SELECT DISTINCT kind, id FROM adventure_content) GROUP BY kind"
    npx wrangler d1 execute catmin-study --remote --command "SELECT COUNT(*) AS sessions FROM adventure_world"

表不存在的报错（no such table）是正常的，说明线上从没有过对应数据。结果只有计数，没有正文。

- 如果 `world` 那行 legacy > 0：线上已有旧版世界。导入新世界后会变成两个世界，已经固定的旧会话不受影响；从没固定过的旧会话会失败关闭（不猜世界）。先告诉 Claude 再继续。

## 2. 确认线上已是最新代码

推送 main 后 Cloudflare（Workers Builds）会自动部署，不需要手动 wrangler deploy。
到 Cloudflare → Workers & Pages → catmin-memory → Deployments，确认最上面一行的说明是 main 最新提交、状态 Ready。
（新数据表由代码在运行时自动创建；migrations 目录没有新文件时不需要执行迁移。）

## 3. 转换为命名空间包（本地，不联网）

    node scripts/namespace-bundle.mjs <GPT给的包.json> world01-ns.json world01 <globalRulesVersion>
    node scripts/check-bundle-engine-compat.mjs world01-ns.json

第一条应输出 ok:true 和各类计数；第二条应 ok:true、errors 为空。

## 4. 预演，再正式导入

    $env:SITE="https://study.catmin.io"; $env:PASS="你的口令"
    python scripts/import-bundle.py world01-ns.json --dry-run
    python scripts/import-bundle.py world01-ns.json

正式导入结束会打印“失败 0”和“世界清单：已校验通过”，并在本地生成 world01-ns.json.manifest.json（只有 id 与修订，不要提交到 GitHub）。重复运行是幂等的（全部“未变”）。

## 5. 试玩

如果第 1 步显示线上没有旧版世界，world01 就是唯一世界，新会话会自动固定到它，直接打开 /adventure 试玩即可。
如果线上还有旧版世界，页面目前还没有“选择世界”入口，先告诉 Claude，由 Claude 加入口后再玩。导入只新增 `world01:*` 记录，不改写任何已有记录。
