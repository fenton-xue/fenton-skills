# 飞书应用与权限配置（一次性）

脚本用「自建应用 + tenant_access_token」写表格，写入身份是应用机器人，不是你本人。

## 1. 创建自建应用

1. 打开 https://open.feishu.cn/app → 创建企业自建应用
2. 「凭证与基础信息」里拿到 `App ID`、`App Secret`
3. 导出环境变量（不要把 Secret 写进仓库）：

   ```bash
   export FEISHU_APP_ID=cli_xxx
   export FEISHU_APP_SECRET=xxx
   ```

## 2. 开通权限

「权限管理」里开通：

- `sheets:spreadsheet`（查看、编辑和管理电子表格）

如果表格放在知识库里，另需 `wiki:wiki:readonly`。开通后必须在「版本管理与发布」创建版本并发布，权限才生效。

## 3. 把应用加为表格协作者（最容易漏）

自建应用默认访问不了任何文档。实测路径：打开目标表格 → 右上角「分享」→ 在「邀请协作者」里搜应用名 → 权限选「可编辑」→ 完成。前提是应用已添加「机器人」能力并发布版本，否则搜不到。

不做这步，所有写入都会返回 403 / 91403。

完整的浏览器操作步骤、踩坑和本次实例见 [feishu-runbook.md](feishu-runbook.md)。

## 4. 准备目标表格

- 新建一个飞书表格，取一个子表名，如「小红书数据」
- 第一行留空即可，脚本会自动写入 14 个表头；或者手动按 schema.md 填好表头
- 表格链接形如 `https://xxx.feishu.cn/sheets/shtcnXXXXXXXX`，`--spreadsheet` 直接传整条链接或其中的 token 均可

## 5. 本脚本用到的接口

| 用途 | 接口 |
| --- | --- |
| 取 token | `POST /open-apis/auth/v3/tenant_access_token/internal` |
| 查子表 | `GET /open-apis/sheets/v3/spreadsheets/{token}/sheets/query` |
| 读表头/键列 | `GET /open-apis/sheets/v2/spreadsheets/{token}/values/{range}` |
| 写表头 | `PUT /open-apis/sheets/v2/spreadsheets/{token}/values` |
| 追加行 | `POST /open-apis/sheets/v2/spreadsheets/{token}/values_append` |
| 批量更新 | `POST /open-apis/sheets/v2/spreadsheets/{token}/values_batch_update` |
| 解析 wiki | `GET /open-apis/wiki/v2/spaces/get_node` |

## 6. 已知限制

- 单次写入不超过 5000 行、100 列；脚本每批追加 500 行
- 单元格文本不超过 5 万字符
- `values_append` 的 range 行数必须不小于写入行数，否则返回 90202（真机验证，脚本已处理）
- 表格放在知识库里时 `/wiki/` 节点不是表格 token；直接传 `/wiki/` 链接需要 `wiki:wiki:readonly`，本次未开通，用 runbook 第 7 步取 `obj_token`
- 接口清单中的 wiki 解析一行未经真机验证，其余接口均已在真实飞书跑通
