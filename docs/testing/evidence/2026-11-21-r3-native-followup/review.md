# R3：原生取消与终态续修的受限证据

日期：2026-11-21。仅记录相对已发布 r2 候选 fb5e029dd7e67ab69f0ee804b64c6d926c378022（tree d838ab4cdd43d44a5f1c21e46319bb27d08bec44）的五个代码/测试路径。不是正式站验收、完整发布通过或数据库升级完成记录。main、stable、正式Coze不由本文件改变；原286授权、160审查项、其余canonical记录及38历史保留义务不改。

## 已证根因及修复

- BD：实际Quality job136829748006的held503-drained同一原生Request先收到503，再报告failed/net::ERR_ABORTED，显式disconnect在其后。原finished-only断言过窄。仅drained分支复用既有严格GET/URL/eventsource/status/error联合判定，保留真实Request、raw终态及早停null负例；shared helper、其余四变体、网络守卫和预算不改。父原1case/5变体实际通过，独立静态复审无新增P1/P2。
- 电商套图：实际Quality job136829747991的gold/mono两例均在cancel ACK结束后新发旧run poll，再被本run取消流程中止；dispose晚约3.5秒，不是teardown。组件原poll在active-run核验后增加5行：cancelling时按原delay重排，不发请求、不增加attempts。原取消成功停止、取消失败恢复、任务/供应商/模型身份、AbortSignal、权限和账务逻辑不改，不豁免POST失败。
- 先增两条参数化取消窗口测试，父实际RED均为预期poll1、实际3；业务修复后相同2例GREEN。原native gold/mono两例均通过，faultCount=0；原轮询上限、取消后迟到结果、卸载、瞬态错误四个近邻通过。独立静态复审无新增P1/P2。

## 仍未解决的失败

- DG gold320控制场景仅增最多16条相位观察。父单例完成且通过，setup约2.021s，场景和dispose总10.593s；这没有复现或解释hosted25秒超时，不增加预算、不把原失败改记通过。
- CS gold390 element-transparency原hosted失败没有实际响应状态，继续严格失败。新增最多6请求/64条被动观察，在原2500ms清理预算内查询同一Request的实际Response；不回写响应状态、不迁移completed/failed，null仍失败。原单例在观察版通过不能证明hosted根因已修。观察异常隔离P2已在静态源码层面闭合；真实response读取异常仍进入原cleanup failures。

## 父实际验证

| 证据文件（均在ignored output/canvas-chat-audit 下） | 结果与范围 |
| --- | --- |
| r3-bd-terminal-receipt-green-20261121.log | 原BD1case/5变体通过；无真实服务调用 |
| r3-ecommerce-cancel-window-red-20261121.log | 新2例按目标断言失败，22 filtered |
| r3-ecommerce-cancel-window-green-20261121.log | 同2例通过，22 filtered |
| r3-ecommerce-native-two-failed-only-20261121.log | 原gold/mono两例通过，68 filtered；原POST守卫给出faultCount=0 |
| r3-ecommerce-cancel-neighbors-20261121.log | 4个直接近邻通过，20 filtered |
| r3-dg-failed-only-phase-check-20261121.log | 原DG1例通过，9 filtered；保留hosted超时hold |
| r3-cs-failed-only-observation-20261121.log | 原CS1例通过，13 filtered；非缺状态根因证明 |
| r3-local-final-types-20261121.log | 五路径最终代码的全仓TypeScript退出0 |
| r3-five-direct-eslint-20261121.log | 五直接文件ESLint退出0，保留7个既有warning |

原生测试只使用专属隔离数据库身份/外置媒体目录和本地合成服务；离线生命周期用例全mock。父唯一执行，子代理仅静态读写。没有调用真实供应商或原草图任务；14积分原回执仍未定位。

## 精确来源字节

父通过Git路径过滤计算实际leaf；raw SHA-256只用于本机字节绑定，不把不同EOL表示冒充不同业务版本。

| 路径 | raw SHA-256 | Git blob |
| --- | --- | --- |
| src/components/brand-ecommerce-panel.tsx | 2102f53fd033a193bbf0268a84a522c58995cc35703b1fb77354cb5fdd255091 | 13cfe6fa19d8a7a046e5f63903e8d1f1efd46045 |
| src/__tests__/components/brand-ecommerce-lifecycle.test.tsx | 323f4dcb8594cdf38a3076f1f61c4a919f8186fa546b84ce6a233626b8966d4b | 1c5e4fb9c3a29bb049128982615653f1aa785161 |
| src/__tests__/components/canvas-color-bg-cs-native.test.tsx | fd14736887fd222bb799e6430254dbbf476caf93e68363c5ea20231160f513e7 | aab169d9495e1292ee3d5113ee4856b585c49dc6 |
| src/__tests__/components/canvas-model-viewer-dg-native.test.tsx | 210214fabd836dd44874bc14b2b6b6eaf5a68f9026e1c0dc4b73136954458c19 | d36c5b24ca034b5cc08c8be4541062656efa6c4a |
| src/__tests__/lib/task-events-bd-native.test.ts | 61dec2b732c89da489ae494a4ae59e471513b3efada9f1a4efeb0080f3b33873 | ec2f292f249e741d26a690d3a222a0be8ff260d1 |

新候选的远端commit/tree和真实CI结果以之后不可变发布收据绑定；本文未预填不存在的候选或运行结果。新增观察不是发布豁免：CS/DG、真实P0、Coze完整包、非空项目schema兼容及全部正式覆盖仍需独立通过。
