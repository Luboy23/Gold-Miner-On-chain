use anyhow::Result;
use dotenvy::dotenv;
use std::env;

/// API 服务进程入口。
///
/// 这里故意保持很薄，只做三件事：
/// 1. 读取 `.env`；
/// 2. 初始化 tracing；
/// 3. 把控制权交给 crate 内部的 `goldminer_api::run()`。
///
/// 真正的路由、数据库、worker 和链客户端初始化都放在库代码中，避免 main.rs
/// 变成隐藏的启动编排真相源。
#[tokio::main]
async fn main() -> Result<()> {
    dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            // 未显式提供 RUST_LOG 时，默认只打开本服务和 tower_http 的信息级日志，
            // 防止本地开发被过多依赖库输出淹没。
            env::var("RUST_LOG")
                .unwrap_or_else(|_| "goldminer_api=info,tower_http=info".to_string()),
        )
        .init();

    goldminer_api::run().await
}
