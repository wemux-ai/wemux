# Postgres 与对象存储

## Postgres

### 开发环境

```bash
DATABASE_URL=postgres://wemux:wemux@127.0.0.1:5434/wemux
```

### 生产环境

```bash
DATABASE_URL=postgres://user:password@db-host:5432/wemux
```

### Docker 开发环境

```bash
# deploy/docker/docker-compose.infra.yml
postgres:
  image: postgres
  ports:
    - "5434:5432"
  environment:
    POSTGRES_USER: wemux
    POSTGRES_PASSWORD: <local-dev-password>
    POSTGRES_DB: wemux
  volumes:
    - wemux-postgres-data:/var/lib/postgresql/data
```

## S3 兼容对象存储（RustFS）

### 开发环境

```bash
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9100
OBJECT_STORAGE_BUCKET=wemux
OBJECT_STORAGE_ACCESS_KEY_ID=wemux
OBJECT_SECRET_KEY=<local-dev-secret>
```

### 生产环境

```bash
OBJECT_STORAGE_ENDPOINT=https://your-object-storage.example.com
OBJECT_STORAGE_BUCKET=wemux
OBJECT_STORAGE_ACCESS_KEY_ID=your_access_key
OBJECT_SECRET_KEY=your_secret_key
```

### Docker 开发环境

```bash
# deploy/docker/docker-compose.infra.yml
rustfs:
  image: ghcr.io/asuroth/rustfs:latest
  ports:
    - "9100:9000"   # S3 API
    - "9101:9001"   # Console
  environment:
    RUSTFS_BUCKET: wemux
    RUSTFS_ACCESS_KEY: wemux
    RUSTFS_SECRET_KEY: <local-dev-secret>
```

### 默认资源

| 资源 | 开发环境地址 |
|------|-------------|
| Postgres | 127.0.0.1:5434 |
| RustFS S3 API | 127.0.0.1:9100 |
| RustFS Console | http://127.0.0.1:9101 |
| Bucket | wemux |
| Access Key | wemux |
| Secret Key | `<local-dev-secret>` |

## 使用场景

- **头像上传**：用户头像存储到 S3
- **任务图片**：任务相关图片存储到 S3
- **产物回传**：worker 执行产生的产物存储到 S3

## 配置缺失行为

- 如果没有配置 `OBJECT_STORAGE_*`，个人资料页会提示未就绪
- 设置页的头像上传依赖对象存储
- 未配置时服务会直接启动失败，不再回退到本地 SQLite

## 相关文档

- [数据库规范](./09-database-conventions.md)
- [本地开发](./07-local-development.md)
