# 飞书侧操作手册（已用 ego-browser 实操验证）

本文记录 2026-11-17 在真实飞书企业里跑通的完整流程：建应用 → 开权限 → 发布 → 建表 → 授权 → 写入。
**换账号/换企业** 走全部 9 步；**同一应用换一张新表格** 只做第 6–8 步。

前提：ego-browser 里已登录飞书，用 `ego-browser skill` 查看浏览器脚本写法。

## 一、一次性配置（每个应用只做一次）

### 1. 新建企业自建应用

1. 打开 `https://open.feishu.cn/app`，点「创建企业自建应用」
2. 填应用名称、应用描述（两项必填），图标保持默认即可
3. 点「创建」，页面自动跳到 `/app/<App ID>/capability`，地址里就有 App ID

### 2. 开通表格权限

1. 打开 `https://open.feishu.cn/app/<App ID>/auth`，点「开通权限」
2. 首次会有「我知道了」提示气泡，先关掉
3. 搜索框输入 `sheets:spreadsheet`，选「应用身份权限」页签
4. 只勾第一项「查看、评论、编辑和管理电子表格」`sheets:spreadsheet`，不要勾 `:create`、`:read` 等其他 6 项
5. 底部显示「已选：应用身份权限(1)」后点「确认开通权限」
6. 回到权限列表确认该项状态为「已开通」

### 3. 添加机器人能力

1. 打开 `/app/<App ID>/capability`，点「机器人」卡片的「添加」
2. 第一次点击可能只转圈、没有变化；等几秒再点一次，左侧菜单出现「机器人」即成功

不加机器人能力，第 8 步在分享面板里搜不到这个应用。

### 4. 创建版本并发布

1. 打开 `/app/<App ID>/version/create`，页面有一段时间是骨架屏，等 10 秒左右
2. 填「应用版本号」（如 `1.0.0`）和「更新说明」，点页面最下方「保存」
3. 弹出「确认提交发布申请？」，点「确认发布」
4. 提示「本次发布免审」：可用范围只有应用所有者时无需管理员审核
5. 按钮会转圈几秒，状态变为「已发布」、顶部显示「当前修改均已发布」才算完成

权限和机器人能力都必须发布后才对 tenant_access_token 生效。

### 5. 取得 App Secret 并存到本机

1. 打开 `/app/<App ID>/baseinfo`，「App Secret」一行右侧有 3 个图标：显示、复制、重置
2. 点中间那个（本次是第 2 个）显示明文；最右边是「重置」，不要点
3. 把 Secret 写成环境变量，不要进对话、文档或仓库。本机做法是追加到 `~/.zshrc`（新开终端生效）：

   ```bash
   export FEISHU_APP_ID=cli_xxx
   export FEISHU_APP_SECRET=xxx
   ```

   注意：`~/.zshrc` 默认权限是 644（其他用户可读），共用机器上应改为 600，或改用钥匙串等方式
4. `feishu_sheet.py` 只读环境变量；临时场景可用 `--env-file <export 格式文件>` 显式指定，用完即删
5. 验证凭证：在新终端里能换到 tenant_access_token 即可

   ```bash
   curl -s -X POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal \
     -H 'Content-Type: application/json' \
     -d "{\"app_id\":\"$FEISHU_APP_ID\",\"app_secret\":\"$FEISHU_APP_SECRET\"}"
   ```

   返回里 `"code":0` 即正常（输出含 token，不要贴出去）

## 二、每张表格都要做的配置

### 6. 新建电子表格

1. 打开 `https://www.feishu.cn/drive/home/`，会跳到你的租户域名
2. 点「新建」→「表格」→ 在模板弹窗里点「新建空白表格」
3. 新表格在新标签页打开，默认落在「我的文档库」知识库，地址形如 `/wiki/<node>`

### 7. 取得表格自身的 token

1. `/wiki/<node>` 里的 `<node>` 是知识库节点，不是表格 token
2. 在该表格页面里用页面会话请求（ego-browser 的 `page.evaluate`）：

   ```js
   const r = await fetch(`/space/api/wiki/v2/tree/get_node/?wiki_token=<node>`, { credentials: "include" });
   // 返回 data.obj_token 即表格 token；data.obj_type = 3 表示电子表格
   ```

3. 以后 `--spreadsheet` 传这个 `obj_token`
4. 如果想直接传 `/wiki/` 链接，需要给应用再开通 `wiki:wiki:readonly` 并重新发布版本；本次没有开通

### 8. 把应用加为表格协作者

1. 在表格页点右上角「分享」，面板加载要 3–5 秒
2. 在「邀请协作者」搜索框输入应用名称，等结果出现（搜索框支持「智能体」，机器人应用会出现在这里）
3. 点中应用，右侧权限下拉选「可编辑」（不要给「可管理」）
4. 取消勾选「发送通知」，点「完成」
5. 出现「邀请成员成功」即可

## 三、联调命令

```bash
cd <skill 目录>
agent-python scripts/fetch_xhs.py --mock -o /path/xhs.json
agent-python scripts/feishu_sheet.py -i /path/xhs.json --spreadsheet <obj_token> --dry-run
agent-python scripts/feishu_sheet.py -i /path/xhs.json --spreadsheet <obj_token>
```

重复执行同一批数据，输出应为 `appended=0, updated=N`，表格里不会出现重复行。

## 四、踩过的坑（摘要，详见 [pitfalls.md](pitfalls.md)）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `values_append` 返回 `90202 range in request is wrong, rows of value:3 > range` | 追加时 range 的行数必须不小于待写入行数 | 脚本已改为 `A1:N{行数}`，位置仍是表尾 |
| 页面长时间空白 | 开发者后台是骨架屏渲染 | 等 5–10 秒再取快照 |
| 用旧坐标点击没反应 | 页面滚动或布局变化后坐标失效 | 点击前重新用 `getBoundingClientRect` 取坐标，或先滚动到目标 |
| 分享面板搜不到应用 | 没加机器人能力，或版本未发布 | 重做第 3、4 步 |
| 改表格标题没生效 | 点标题后键入没有进入编辑态 | 标题不影响写入，需要时手动改 |
| 版本页「保存」点不到 | 按钮在页面最底部，不在首屏 | 先取按钮位置并滚动到可见 |

## 五、本次实例（非密钥信息，仅供对照）

| 项目 | 值 |
| --- | --- |
| 应用名称 | 小红书数据同步 |
| App ID | `cli_aa769c823f611bc8` |
| 已开通权限 | `sheets:spreadsheet`（应用身份） |
| 应用版本 | 1.0.0，已发布，可用范围仅所有者 |
| 租户域名 | `pcnj2vwcfk6r.feishu.cn` |
| 测试表格 | 标题仍为「未命名表格」，wiki 节点 `GRwcw7AlMi6I3KkJfeScosOFnVc` |
| 表格 token（`--spreadsheet` 用） | `OA6SsKXQ5haq5nt8xFBcAnAvnke` |
| 凭证 | 环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`，写在 `~/.zshrc`；早先的 `~/.config/xhs-feishu/env` 已移到废纸篓 |

测试表格里目前是 3 条模拟数据（示例博主 A/B/C），正式使用前清空或换新表格。

## 六、验证记录（2026-11-17，真实飞书）

1. 换取 tenant_access_token：成功
2. `--dry-run` 读取子表和表头：成功
3. 首次写入：表头自动初始化，追加 3 行
4. 同数据再次同步：`appended=0, updated=3`，没有重复行
5. 回读单元格：ID 为文本；主页链接、发布链接是可点击超链接；数值为数字
6. 在 O 列手写内容后再同步：指标被更新，手写内容原样保留（已还原测试数据）

踩坑与修复的完整记录见 [pitfalls.md](pitfalls.md)。

未验证：`/wiki/` 链接直接解析（未开通 wiki 权限）、超过 500 行的分批追加、真实小红书数据。
