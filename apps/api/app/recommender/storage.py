def store_recommendation_batch(
    user_id: str,
    strategy: str,
    coverage: dict,
    recommendations: list[dict],
) -> dict:
    from app.core.supabase_client import supabase

    batch_result = (
        supabase.table("recommendation_batches")
        .insert(
            {
                "user_id": user_id,
                "strategy": strategy,
                "coverage": coverage,
            }
        )
        .execute()
    )

    if not batch_result.data:
        raise ValueError("Failed to create recommendation batch.")

    batch = batch_result.data[0]
    batch_id = batch["id"]

    item_rows = [
        {
            "batch_id": batch_id,
            "user_id": user_id,
            "rank": recommendation["rank"],
            "track_id": recommendation["track_id"],
            "track_name": recommendation.get("track_name"),
            "artists": recommendation.get("artists"),
            "genre": recommendation.get("genre"),
            "score": recommendation.get("score"),
            "source": recommendation.get("source"),
            "reason": recommendation.get("reason"),
            "spotify_uri": recommendation.get("spotify_uri"),
        }
        for recommendation in recommendations
    ]

    if item_rows:
        supabase.table("recommendation_items").insert(item_rows).execute()

    return {
        "has_recommendations": bool(recommendations),
        "batch": batch,
        "recommendations": recommendations,
    }


def fetch_latest_recommendation_batch(user_id: str) -> dict:
    from app.core.supabase_client import supabase

    batch_result = (
        supabase.table("recommendation_batches")
        .select("id,user_id,strategy,coverage,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not batch_result.data:
        return {
            "has_recommendations": False,
            "batch": None,
            "recommendations": [],
        }

    batch = batch_result.data[0]
    item_result = (
        supabase.table("recommendation_items")
        .select('"rank",track_id,track_name,artists,genre,score,source,reason,spotify_uri')
        .eq("batch_id", batch["id"])
        .order("rank", desc=False)
        .execute()
    )

    return {
        "has_recommendations": True,
        "batch": batch,
        "recommendations": item_result.data or [],
    }
