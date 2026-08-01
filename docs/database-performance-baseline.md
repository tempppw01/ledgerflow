# LedgerFlow 数据库基线

基线脚本：`node server/relationalPerformanceBaseline.js --rows=1000,10000,100000`，使用临时 SQLite
数据库和逐行导入，结果会随机器和 Node 版本变化，不能当作绝对 SLA。

2026-08-01 当前运行结果：

| 交易数 | 导入 | Bootstrap | 请求数据体 |
| ---: | ---: | ---: | ---: |
| 1,000 | 48.19 ms | 11.99 ms | 294,475 B |
| 10,000 | 356.78 ms | 72.94 ms | 2,946,652 B |
| 100,000 | 11,982.67 ms | 1,032.18 ms | 29,558,683 B |

当前执行计划：

- 按用户和发生时间读取交易使用 `idx_transactions_user_occurred_created`，不再出现临时排序 B-Tree。
- 按账户读取交易使用 `idx_transactions_account_occurred`。

这组数据说明 100,000 条交易时全量导入和 Bootstrap 已成为下一阶段重点，后续应优先做批量写入、
分页/增量 Bootstrap 和聚合查询，再根据新基线评估连接池与其他索引。
