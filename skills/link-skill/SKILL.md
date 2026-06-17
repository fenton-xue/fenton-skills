---
name: link-skill
description: >
  将本项目中的skill文件夹通过目录联接(Junction)部署到其他项目。触发词："把X链接到Y"、
  "链接skill到"、"link skill"、"把skill放到某项目"。
  用户给出skill名称(支持部分匹配)和目标路径即可。
---

# Link Skill

将本项目中的skill文件夹通过目录联接(Junction)链接到用户指定的目标路径。

## 工作流程

1. 从用户话中提取 **skill名称**（支持部分匹配）和 **目标路径**
2. 运行链接脚本：

```bash
bash link-skill/scripts/link_skill.sh "<skill名称>" "<目标路径>"
```

## 脚本行为

- 在项目根目录下模糊匹配skill文件夹（不区分大小写，精确匹配优先）
- 匹配多个时报错并提示用户提供更精确的名称
- 链接路径 = `<目标路径>/<skill文件夹名>`，名称与源文件夹一致
- 使用 Junction（`New-Item -ItemType Junction`），无需管理员权限

## 示例

**用户**: 把 testcase-generator 链接到 D:\Workspace\MyProject\.claude\skills
```bash
bash link-skill/scripts/link_skill.sh testcase-generator "D:/Workspace/MyProject/.claude/skills"
```
结果: `D:\Workspace\MyProject\.claude\skills\testcase-generator` → 源目录

**用户**: 把 test-func 链接到 D:\Workspace\ProjectB\.claude\skills
```bash
bash link-skill/scripts/link_skill.sh test-func "D:/Workspace/ProjectB/.claude/skills"
```
结果: 模糊匹配到 `test-func-doc-generator`，创建同名链接
