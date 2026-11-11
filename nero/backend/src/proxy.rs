use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, Response, StatusCode},
    routing::get,
    Router,
};
use bytes::Bytes;
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;

#[derive(Deserialize)]
struct ProxyQuery {
    url: Option<String>,
}

/// GET /proxy?url=<encoded_url>
/// Fetches any URL server-side, returns the response body.
/// Used for game JSON lists and cover images to bypass CORS/school filters.
async fn proxy_fetch(
    Query(q): Query<ProxyQuery>,
) -> Result<Response<Body>, (StatusCode, String)> {
    let url = q.url.ok_or((StatusCode::BAD_REQUEST, "missing url".to_string()))?;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Nero/1.0)")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let status = resp.status();
    let headers = resp.headers().clone();

    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;

    let mut builder = Response::builder()
        .status(status)
        .header("content-type", content_type)
        .header("access-control-allow-origin", "*")
        .header("cache-control", "public, max-age=300");

    Ok(builder.body(Body::from(bytes)).unwrap())
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/proxy", get(proxy_fetch))
}
