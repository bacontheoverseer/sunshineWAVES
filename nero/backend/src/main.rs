mod auth;
mod db;
mod proxy;
mod routes;

use axum::{Router, middleware};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
pub struct AppState {
    pub db: Pool<SqliteConnectionManager>,
    pub jwt_secret: String,
}

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .init();

    let db_path = std::env::var("DATABASE_URL").unwrap_or_else(|_| "nero.db".to_string());
    let manager = SqliteConnectionManager::file(&db_path);
    let pool = Pool::new(manager).expect("failed to create db pool");
    db::init(&pool).expect("failed to init db");

    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "nero_secret_change_me".to_string());

    let state = Arc::new(AppState {
        db: pool,
        jwt_secret,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .merge(routes::auth::router())
        .merge(routes::users::router())
        .merge(routes::favorites::router())
        .merge(proxy::router())
        .layer(cors)
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "4200".to_string());
    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("nero backend listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
