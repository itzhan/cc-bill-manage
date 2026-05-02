# Bill Manage

中转站账单管理 / 利润计算 Dashboard。

- 上游 sub2api 账号 → 拉用户 keys 的今日花费（支出）
- 本站 sub2api 管理员账号 → 拉 admin/accounts 的 user_cost（收入）+ cost(1×)
- 多对一绑定（多个本站 account 可指向同一上游 key）
- 自动定时同步 + 401 懒重登
- 1× 基准差异检测（| 本站 cost - 上游 actual/倍率 |）

## 运行

```bash
npm install
npx prisma db push          # 初始化 SQLite
npm run dev                 # http://localhost:3100
# 或生产
npm run build && npm start
```

## 默认管理员密码

**`ab123168`**（首次启动时由 `INITIAL_ADMIN_PASSWORD` 环境变量决定，写入 DB 后生效；后续可在「设置」页修改）

## 修改环境

`.env`：

```
DATABASE_URL="file:./dev.db"
JWT_SECRET="生产环境务必换成长随机串"
INITIAL_ADMIN_PASSWORD="ab123168"
```

## 数据流

```
上游账号(creds) ──login──> token(DB) ──> /api/v1/keys + /usage/dashboard/api-keys-usage
本站账号(creds) ──login──> token(DB) ──> /api/v1/admin/accounts + /today-stats/batch
```

利润 = Σ user_cost(本站) - Σ today_actual_cost(上游)
差异 = | Σ cost(本站 1×) - Σ today_actual / 倍率(上游 1×) |

## 待接入

- 邮件告警接口（已留 settings 字段，未连发送逻辑）
- newapi 适配器（schema 已支持 type 字段）
