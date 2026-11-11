use crate::{auth as jwt, AppState};
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Serialize)]
struct Favorite {
    id: i64,
    game_id: String,
    game_name: String,
    game_url: String,
    cover_url: Option<String>,
    source_key: String,
    added_at: String,
}

#[derive(Deserialize)]
struct AddFavoriteBody {
    game_id: String,
    game_name: String,
    game_url: String,
    cover_url: Option<String>,
    source_key: String,
}

fn extract_claims(state: &AppState, headers: &HeaderMap) -> Result<crate::auth::Claims, (StatusCode, String)> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or((StatusCode::UNAUTHORIZED, "missing token".to_string()))?;

    jwt::verify_token(state, token)
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))
}

async fn list_favorites(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Favorite>>, (StatusCode, String)> {
    let claims = extract_claims(&state, &headers)?;
    let conn = state.db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut stmt = conn
        .prepare("SELECT id, game_id, game_name, game_url, cover_url, source_key, added_at FROM favorites WHERE user_id = ?1 ORDER BY added_at DESC")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let favs: Vec<Favorite> = stmt
        .query_map(rusqlite::params![claims.sub], |row| {
            Ok(Favorite {
                id: row.get(0)?,
                game_id: row.get(1)?,
                game_name: row.get(2)?,
                game_url: row.get(3)?,
                cover_url: row.get(4)?,
                source_key: row.get(5)?,
                added_at: row.get(6)?,
            })
        })
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(favs))
}

async fn add_favorite(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AddFavoriteBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = extract_claims(&state, &headers)?;
    let conn = state.db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    conn.execute(
        "INSERT OR IGNORE INTO favorites (user_id, game_id, game_name, game_url, cover_url, source_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![claims.sub, body.game_id, body.game_name, body.game_url, body.cover_url, body.source_key],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::CREATED)
}

async fn remove_favorite(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    axum::extract::Path(game_id): axum::extract::Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let claims = extract_claims(&state, &headers)?;
    let conn = state.db.get().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    conn.execute(
        "DELETE FROM favorites WHERE user_id = ?1 AND game_id = ?2",
        rusqlite::params![claims.sub, game_id],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/favorites", get(list_favorites).post(add_favorite))
        .route("/favorites/:game_id", delete(remove_favorite))
}
