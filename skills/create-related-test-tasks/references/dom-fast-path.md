# DOM 快速路径

在完成 Chrome 初始化并读取浏览器文档后，将下列只读辅助方法初始化到当前 Node REPL 会话。给 `dialogSnapshot`、`fingerprint` 和 `visibleOptionTitles` 传入本次新建的专用标签页。

```js
globalThis.onesTaskDom ??= {
  async dialogSnapshot(tab) {
    const snapshot = await tab.playwright.domSnapshot();
    const marker = '- dialog "建任务"';
    const start = snapshot.lastIndexOf(marker);
    return start >= 0 ? snapshot.slice(start) : snapshot;
  },

  async fingerprint(tab) {
    const snapshot = await this.dialogSnapshot(tab);
    const required = [
      'dialog "建任务"',
      'textbox "* 标题"',
      'combobox "* 工作项类型"',
      'combobox "* 优先级"',
      'combobox "* 任务复杂度"',
      'combobox "* 任务拆解类型"',
      'combobox "* 所属产品"',
      'button "确定"',
    ];
    const missing = required.filter((item) => !snapshot.includes(item));
    return { ok: missing.length === 0, missing, snapshot };
  },

  async visibleOptionTitles(tab, comboLocator) {
    const listId = await comboLocator.getAttribute('aria-controls');
    if (!listId) return [];
    return tab.playwright.evaluate((id) => {
      const listbox = document.getElementById(id);
      const dropdown = listbox?.closest('.ones-select-dropdown') ?? listbox?.parentElement;
      if (!dropdown) return [];
      return [...dropdown.querySelectorAll('.ones-select-item-option[title]')]
        .map((item) => item.getAttribute('title'))
        .filter(Boolean);
    }, listId);
  },

  exactOptionSelector(title) {
    const escaped = title.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return `.ones-select-item-option[title="${escaped}"]`;
  },
};
```

## 使用顺序

1. 选择关联关系“需求拆解的任务”，等待初始表单刷新；重新取得当前创建弹窗，填写完整标题并回读实时 `value`。
2. 将“工作项类型”设为“任务”，等待完整任务表单渲染；丢弃此前的弹窗和字段定位器。
3. 完整任务表单出现后执行 `await onesTaskDom.fingerprint(tab)`；`ok` 为 `true` 时重新取得标题输入元素，确认标题仍与目标值完全一致，再继续填写其他字段。
4. “任务拆解类型”打开后，根据组合框 `aria-controls` 定位选项列表及其虚拟列表滚动容器。由 Agent 将该列表翻到最底部，再向上翻一个视口，随后用 `visibleOptionTitles()` 检查当前视口；滚动目标必须是选项列表，不能使用组合框输入框的 `End`、`PageUp`，也不能滚动整个任务表单。找到目标后用 `exactOptionSelector()` 精确定位完整业务选项，避免同时命中选项容器和内部标签。当前视口未找到时，根据实际列表结构继续翻找。
5. `ok` 为 `false` 时等待页面稳定，重新执行一次指纹检查并重建定位器。
6. 再次失败时截取当前页面，识别新版结构后更新本次会话的定位方式。

辅助方法只读取页面状态。填写、选择和提交仍通过受控的 Playwright 或 CUA 操作完成。
