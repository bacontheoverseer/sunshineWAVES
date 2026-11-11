use crate::{auth as jwt, AppState};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::get,
    Json, Router,
};
use serde::Serialize;
use std::sync::Arc;

#[derive(Serialize)]
struct UserProfile {
    user_id: String,
    username: String,
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
}

async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<UserProfile>, (StatusCode, String)> {
    let token = extract_token(&headers)
        .ok_or((StatusCode::UNAUTHORIZED, "missing token".to_string()))?;

    let claims = jwt::verify_token(&state, &token)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

    Ok(Json(UserProfile {
        user_id: claims.sub,
        username: claims.username,
    }))
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/users/me", get(me))
}
