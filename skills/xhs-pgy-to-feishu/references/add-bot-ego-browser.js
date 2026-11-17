// 示例：用 ego-browser 把机器人加为表格的「可编辑」协作者。只是示例，别的浏览器工具照
// references/add-bot-to-sheet.md 的步骤做即可。
// 用法：把下面两个常量换成表格链接和机器人名字（机器人名字取自 `feishu_sheet.py access` 输出的 bot_name），
//       然后 `ego-browser nodejs < 本文件`。浏览器里要已登录用户的飞书账号。
// 结果看最后一行：RESULT: SUBMITTED 只说明点了「完成」，必须再用 `feishu_sheet.py access` 核对 bot_can_edit；
//                RESULT: NOT_ADDED 表示中途放弃了，没有提交任何改动。
const URL_ = "<表格链接>";
const APP = "<机器人名字>";
const task = await taskSpace("add bot to sheet");
const page = task.page("p1");
const log = (m) => console.log(m);
const permText = () => page.evaluate(() => document.querySelector("button.invited-member-permissions")?.innerText.trim() || null);
const cancel = async (why) => {
  const c = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(e => e.offsetParent && e.innerText.trim() === "取消"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  if (c) await page.mouse.click(c.x, c.y, { label: "cancel invite" });
  await task.finish({ keep: [] });
  console.log("RESULT: NOT_ADDED -", why);
};
await page.goto(URL_, { timeout: 60000 });
await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.offsetParent && b.innerText.trim() === "分享"), undefined, { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(2000);
const share = await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(e => e.offsetParent && e.innerText.trim() === "分享"); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
if (!share) { await task.finish({ keep: [] }); console.log("RESULT: NOT_ADDED - 页面上没有「分享」按钮（没登录飞书，或打开的不是表格）"); } else {
await page.mouse.click(share.x, share.y, { label: "open share panel" });
const hasInput = await page.waitForSelector("input[placeholder*='搜索用户']", { state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
if (!hasInput) { await task.finish({ keep: [] }); console.log("RESULT: NOT_ADDED - 分享面板里没有邀请协作者的输入框"); } else {
await page.click("input[placeholder*='搜索用户']", { label: "focus search" });
await page.keyboard.type(APP, { delay: 60 });
const found = await page.waitForSelector(".search-member-result-item", { state: "visible", timeout: 12000 }).then(() => true).catch(() => false);
if (!found) { await cancel("搜不到名为「" + APP + "」的机器人（没加机器人能力、版本没发布，或可用范围不含当前用户）"); } else {
const names = await page.evaluate(() => [...document.querySelectorAll(".search-member-result-item")].map(e => e.innerText.trim()));
log("search results: " + JSON.stringify(names));
const idx = names.findIndex(n => n === APP);
if (idx < 0) { await cancel("搜索结果里没有与「" + APP + "」完全一致的项"); } else {
await page.click(".search-member-result-item >> nth=" + idx, { label: "select bot" });
await page.waitForSelector("button.invited-member-permissions", { state: "visible", timeout: 10000 });
await page.click("button.invited-member-permissions", { label: "open permission menu" });
await page.waitForSelector("li.member-auth-type-menu-comp__item", { state: "visible", timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1500);
const opts = await page.evaluate(() => [...document.querySelectorAll("li.member-auth-type-menu-comp__item")].map(e => ({ t: e.innerText.split("\n")[0].trim(), disabled: /disabled/.test(e.className.toString()) || e.getAttribute("aria-disabled") === "true" })));
log("permission options: " + JSON.stringify(opts));
const edit = opts.find(o => o.t === "可编辑");
if (!edit || edit.disabled) { await cancel("权限菜单里没有可选的「可编辑」"); } else {
await page.click("xpath=//li[contains(@class,'member-auth-type-menu-comp__item')][normalize-space(.)='可编辑']", { label: "choose can-edit" });
await page.waitForTimeout(1200);
const now = await permText();
log("permission now: " + now);
if (now !== "可编辑") { await cancel("没能选上「可编辑」，当前是 " + now); } else {
if (await page.evaluate(() => document.querySelector("input.ud__checkbox__input")?.checked)) {
  const p = await page.evaluate(() => { const r = document.querySelector("input.ud__checkbox__input").getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
  await page.mouse.click(p.x, p.y, { label: "uncheck notify" });
  await page.waitForTimeout(600);
}
const notify = await page.evaluate(() => document.querySelector("input.ud__checkbox__input")?.checked);
if (notify) { await cancel("没能取消「发送通知」，为避免打扰他人已放弃"); } else {
const b = await page.evaluate(() => { const bt = [...document.querySelectorAll("button")].filter(e => e.offsetParent && /^(完成|发送)$/.test(e.innerText.trim())).pop(); if (!bt) return null; const r = bt.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
if (!b) { await cancel("找不到「完成」按钮"); } else {
await page.mouse.click(b.x, b.y, { label: "confirm invite" });
await page.waitForTimeout(4000);
const msg = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").match(/(无权限|没有权限|失败|无法)[^|]{0,40}/)?.[0] || null);
await task.finish({ keep: [] });
console.log("RESULT: SUBMITTED (还要用 access 子命令核对) page-message=" + msg);
}}}}}}}}
