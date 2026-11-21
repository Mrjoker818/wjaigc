# 受控停止后的定点增量

本记录只绑定本轮增量及实际隔离证据，不覆盖此前审核历史，不代表正式站、全套回归或发布检查通过。

- `image-edit/route.ts` 仅两处 HTTP 响应字段使用现有 `toUserFacingError`。内部原文、task、422/409、终态竞争和退款逻辑不改。真实 handler 的两个出口先红，六例最终通过；内部 parser 原文精确匹配，第六例核对 processing 读取、结算尝试、cancelled 回读顺序。账务与外部传输是合成边界，不作真实资金完成结论。
- A/B 测试只在浏览器实际确认宽屏、fine、hover 时使用既有 24px 下限；窄屏、coarse 和未知输入保留 44px，A 的容器及显式非交互门槛保持。焦点、文字 Range、命中、裁切、真实操作、取消和同挂载恢复断言保留。
- 初次仅补跑原 48 个失败项，38 通过、10 失败；后续只补这 10 项并全部通过，未重复 38 项。程序修复只涉及资产库关闭/搜索/同款与同组复制、收藏夹搜索、表情助手关闭、3D 关闭/灯光、包装结果动作组的局部 fine/hover 点击区域。字号、图标、颜色、处理器及手机规则不变，没有全局放大所有控件。
- `InfiniteCanvas` 最后四个新增 CRLF 行统一为 LF；受控脚本断言规范化后的全文完全相同，没有逻辑或文案改变。其他原行不重新格式化；`git diff --check` 退出 0。

原始本机日志（位于忽略目录，不冒充已版本化的 CI 运行）：

- `image-edit-strengthened-red-20261121.log`：2 failed / 4 filtered，失败均为 HTTP 原文回显。
- `image-edit-both-exits-green-20261121.log`：6 passed，退出 0。
- `additional-b-desktop-target-red-20261121.log`：实际 fine 桌面关闭按钮 16 < 24，1 failed / 76 filtered。
- `additional-ab-failed-only-followup-20261121.log`：10 failed / 38 passed / 99 filtered。
- `additional-ab-last-ten-followup-20261121.log`：10 passed / 137 filtered，退出 0。

上述 filtered 是命令明确选择范围外的用例，不能记为通过。旧完整回归已受控中止，原有其他通过结果仍属于旧冻结版本的隔离证据；新的完整候选仍须通过发布检查。正式 Edge 及供应商行为单列，草图原回执和 14 积分状态未据此关闭，没有重复付费。
