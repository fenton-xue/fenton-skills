# 字段、接口来源与口径

字段名即飞书表头的规范名。表头别名（如「曝光」「曝光数」）程序都能识别，完整列表在 `scripts/xhs_fields.py`。程序识别不了的说法，由 AI 判断意思后用 `feishu_sheet.py --map` 补上，见 SKILL.md「表头怎么对应」。

Rnote 蒲公英接口前缀 `https://rnote.dev/api/v2/pgy`，全部 POST，Header 带 `X-API-Key`。成功请求才计费，每次调用单独计费。

## 博主层（每个博主一份，多行时每行重复）

来源：昵称或小红书号搜索用 `/blogger/list`（`search_type=0`，要求昵称或小红书号精确匹配）；给 userId 或主页链接用 `/blogger/detail`。

| 字段 | 取值 | 备注 |
| --- | --- | --- |
| 小红书昵称 | `name` | |
| ID | `redId` | 小红书号，按文本写入 |
| userId | `userId` | 蒲公英/平台内部 ID，24 位 |
| 主页链接 | 用 userId 拼 `https://www.xiaohongshu.com/user/profile/{userId}` | 接口不返回。未登录状态下能打开并显示昵称和小红书号，但看不到笔记列表（需要登录） |
| 粉丝量（W） | 粉丝数 ÷ 10000，保留 2 位 | 单位万 |
| 粉丝数 | `fansNum`，缺失时用 `fansCount` | `/blogger/list` 里 `fansCount` 会返回 0，`fansNum` 才是对的 |
| 图文报价 / 视频报价 | `picturePrice` / `videoPrice` | |

## 中位数层（`/blogger/notes-rate`，1 次调用）

固定 `note_type=3`（图文+视频）、`advertise_switch=1`（全部流量）。`--business` 切日常/合作口径，`--date-type` 切近 30/90 日。

| 字段 | 接口字段 |
| --- | --- |
| 曝光中位数 | `impMedian` |
| 阅读中位数 | `readMedian` |
| 互动中位数 | `interactionMedian` |
| 点赞中位数 / 收藏中位数 / 评论中位数 | `likeMedian` / `collectMedian` / `commentMedian` |
| 转发中位数 | `shareMedian` |

统计窗口内没有对应类型的笔记时返回 0（例如近 30 日没发视频，视频中位数就是 0）。样本数看接口的 `noteNumber`。

## 成本层（`/blogger/data-summary`，1 次调用）

| 字段 | 接口字段 | 备注 |
| --- | --- | --- |
| 预估图文CPM / 预估视频CPM | `estimatePictureCpm` / `estimateVideoCpm` | 元/千次曝光 |
| 图文阅读单价 / 视频阅读单价 | `pictureReadCost` / `videoReadCost` ÷ 100 | 接口返回的单位是「分」，脚本换成元 |

口径说明：

- `--business 0`（日常）和 `1`（合作）的 CPM 不同，且图文、视频 CPM 常常只有一边有值，另一边是 0。
- 阅读单价除以 100 是根据对照得出的：`data-summary` 返回的值除以 100 后，与 `/blogger/list` 里的 `pictureReadCost` / `videoReadCost`（元）一致。未与蒲公英网页核对。

## 笔记层（一篇笔记一行）

列表来源 `/blogger/notes`（`note_type=4`，`order_type=1` 最新在前，每页最多 8 篇）。详情来源 `/note/detail`，每篇多 1 次调用。

| 字段 | 取值 | 需要详情 |
| --- | --- | --- |
| 笔记标题 | 列表 `title` | 否 |
| 发布链接 | 详情 `noteLink`，带 `xsec_token` | 是 |
| 发布时间 | 详情 `createTime`（精确到分钟）；无详情时用列表 `date`（只有日期） | 否（有详情更精确） |
| 曝光量 | 详情 `impNum` | 是 |
| 阅读量 / 点赞 / 收藏 | 列表 `readNum` / `likeNum` / `collectNum`，有详情时用详情 | 否 |
| 评论 | 详情 `cmtNum` | 是 |
| 转发 | 详情 `shareNum`，按「分享 = 转发」处理 | 是 |
| 总互动 | 点赞 + 收藏 + 评论 + 转发，脚本自己算，缺一项就留空 | 是 |
| 关注 | 详情 `followCnt`，按这篇笔记带来的涨粉数处理，接口文档没有说明含义 | 是 |

总互动不含涨粉。接口自己返回的 `engageNum` 含涨粉，与这里的口径不同。

`--notes first` 的实现：先取列表第 1 页读 `total`，再取最后一页，取最后一条。共 2 次列表调用，不用拉全部。

## 已知的坑

1. `/blogger/notes_v2` 翻页有问题：第 2 页会重复返回第 1 页，且只覆盖部分笔记，所以只用 `/blogger/notes`。
2. 同一篇笔记每次调用 `/note/detail`，返回的 `noteLink` 里 `xsec_token` 都不一样，不能用整条链接判断是否同一篇笔记，要看链接里的 24 位笔记 ID。
3. 曝光量是实时数据，多次读取可能有小幅差异。
4. Python 标准库默认 User-Agent 会被 Cloudflare 拦截（`403 error code 1010`），请求要带通用 UA，脚本里已处理。
5. `/blogger/notes` 对跨平台/跨域内容为主的博主可能返回空列表（`total` 为 0），脚本会提示并把笔记层字段留空。
6. 没有「类型」字段：接口里只有图文/视频的区分，而业务上的“类型”通常指内容方向（旅行、文化等），两者含义不同，所以不提供。表头里有「类型」列时会被当作认不出的表头，保持空白。

## 评论（`xhs_comments.py`，爬虫接口）

接口：`GET /api/v2/crawler/note/comments`（Rnote 爬虫接口，和蒲公英接口分开计费）。只取一级评论。

| 项目 | 说明 |
| --- | --- |
| 总数 | 每页响应里都有 `comment_count_l1`（一级评论数）和 `comment_count`（总数），`--info` 取第 1 页读它 |
| 每页条数 | 接口没有页大小参数，由上游决定。实测同一篇笔记 4 页分别是 10、15、15、5 条 |
| 翻页 | 响应里的 `cursor`（JSON 字符串）原样传回 `cursor` 参数；`has_more` 为 false 时停 |
| 排序 | `hot` = `like_count`（最热），`latest` = `latest_v2`（最新）。接口还有 `default`，文档说翻页会漏或重，不使用 |
| 每条评论 | 正文 `content`、点赞 `like_count`、时间 `time`、IP 属地 `ip_location`、评论人 `user.nickname`、回复数 `sub_comment_count` |
| 回复（二级评论） | 在另一个接口 `/note/sub_comments`，每页最多 5 条。本 skill 不取 |

写进飞书的只有正文一列。输出 JSON 里也带了点赞、时间、属地、昵称，要加列时可以用。

`/pgy/note/comments`（蒲公英精选评论）固定只有 5 条且不能翻页，没有使用。
