use crate::{auth as jwt, AppState};
use axum::{
    extract::State,
    http::StatusCode,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Deserialize)]
struct RegisterBody {
    username: String,
    password: String,
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct AuthResponse {
    token: String,
    username: String,
    user_id: String,
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterBody>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    if body.username.trim().is_empty() || body.password.len() < 6 {
        return Err((StatusCode::BAD_REQUEST, "invalid credentials".to_string()));
    }

    let hashed = bcrypt::hash(&body.password, bcrypt::DEFAULT_COST)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let id = Uuid::new_v4().to_string();
    let conn = state.db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    conn.execute(
        "INSERT INTO users (id, username, password) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, body.username.trim(), hashed],
    )
    .map_err(|_| (StatusCode::CONFLICT, "username taken".to_string()))?;

    let token = jwt::create_token(&state, &id, body.username.trim())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(AuthResponse {
        token,
        username: body.username.trim().to_string(),
        user_id: id,
    }))
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginBody>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let conn = state.db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let result: Result<(String, String, String), _> = conn.query_row(
        "SELECT id, username, password FROM users WHERE username = ?1",
        rusqlite::params![body.username.trim()],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    );

    let (id, username, hashed) = result
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid credentials".to_string()))?;

    let valid = bcrypt::verify(&body.password, &hashed)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !valid {
        return Err((StatusCode::UNAUTHORIZED, "invalid credentials".to_string()));
    }

    let token = jwt::create_token(&state, &id, &username)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(AuthResponse { token, username, user_id: id }))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
}
