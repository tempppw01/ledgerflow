# 发布流程(以及 release 工作流为什么曾经大面积失败)

## 发布节奏:攒一批再发(重要)

**不要一个修复就发一个版本。** 多个问题修复与新增内容攒成一批,再统一发一个版本,
发布说明里一次写清全部内容。

- 日常的修复/功能:只 **commit + push 到 main**,不动 `package.json` / `APP_VERSION`,
  不打 tag、不建 Release
- 等这批改动成规模(一个主题做完,或攒够几条像样的修复/功能),再统一:
  改版本号 → 写 `release-notes/RELEASE_NOTES_<tag>.md` → 提交 → 打 tag → 工作流发布

## 约定

**每个版本 tag 都要有对应的 `release-notes/RELEASE_NOTES_<tag>.md`,并且这个文件必须在
该 tag 指向的那个提交里。** `.github/workflows/release.yml` 在 tag 推送时 checkout 这个 tag,
读取该文件,然后用它创建 GitHub Release。

## 标准步骤

```bash
# 1. 改版本号(package.json + src/shared/config/app.ts 的 APP_VERSION)
# 2. 写仓库内的发布说明 —— 这一步不能省
#    release-notes/RELEASE_NOTES_v0.36.0.md
# 3. 提交(版本号 + 说明文件一起进)
git add package.json src/shared/config/app.ts release-notes/RELEASE_NOTES_v0.36.0.md
git commit -m "feat: ... (v0.36.0)"
git push origin main
# 4. 打 tag 并推送 —— 工作流会自动建 Release,不要手工 gh release create
git tag -a v0.36.0 -m "v0.36.0: ..."
git push origin v0.36.0
gh run watch   # 看 release 工作流是否变绿
```

手工 `gh release create --notes-file /tmp/xxx.md` 会**绕开**这条流水线:Release 建出来了,
但工作流仍会因为没有仓库内说明文件而失败 —— 这正是 2026-11-21 那一批失败的原因。

## 那次失败是什么情况

`release.yml` 在 2026-09-07 引入(feat: release automation)。但发布说明文件只写到 **v0.10.0**,
之后的版本一直在打 tag、却没往仓库里放说明文件,于是:

- **release 工作流近 75 次运行:70 次失败、5 次成功**
- 每次失败都停在 8–9 秒的 `Missing release notes` 检查上
- Release 本身仍然存在(由手工 `gh release create` 创建),所以问题被掩盖了
- `main` 上的 `ci` 工作流是绿的,所以不看 release 那条也发现不了

## 现在的行为(工作流已加固)

`Resolve release notes` 按顺序尝试:

1. **tag 自带** `release-notes/RELEASE_NOTES_<tag>.md` → 直接用
2. **默认分支上同名文件** → 拉下来补上(用于回填历史版本的说明)
3. 两者都没有时:
   - 该 tag 的 **Release 已存在** → 输出 warning 并跳过发布(**不再把 CI 顶红**)
   - 该 tag 的 **Release 不存在** → 失败退出,提示补文件(新 tag 漏写说明仍然会被挡住)

发布步骤:Release 已存在则 `gh release edit --notes-file`(更新说明),否则 `gh release create`。
所以「补一份说明 + 重跑工作流」能把历史版本的信息补正,不需要移动已推送的 tag。

## 回填

`release-notes/` 下已补 **v0.26.0 – v0.35.0** 共 10 份说明(某次会话发布的版本),
这些文件**至今都在**(2026-11-25 核对:10 份齐全)。

再往前的 **v0.11.0 – v0.25.1 没有说明文件**(0 份)。按原计划,给它们补上同名文件即可 ——
但**前提变了**,见下。

> **⚠ 2026-11-24 起,GitHub Release 列表被精简过**:只保留最近 **20 个**,
> 更早的 **135 个 Release 页面已删除**(tag 与 `release-notes/` 文件都保留)。
> 所以 **v0.50.24 及更早的版本已经没有 Release 页面了** —— 包括上面提到的 v0.11–v0.35。
>
> 这意味着:
> · 上一段说的「它们的 Release 已存在,工作流会跳过」**不再成立**(页面已被删,现在是 404);
> · 现在给老版本补说明文件,**不是为了**让工作流跳过,而是**为了让仓库里保留这段历史** ——
>   因为 Release 页面上已经看不到了。
> · 完整清单(保留了哪些、删了哪些)见 [docs/pruned-releases.md](pruned-releases.md)。
