from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.supabase_client import supabase

bearer_scheme = HTTPBearer(auto_error=False)

# User ID fetching for Supabase user authentication
def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header.",
        )

    token = credentials.credentials

    try:
        user_response = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid auth token: {exc}",
        ) from exc

    # Finds user/user_id, returns None if doesn't exist
    user = getattr(user_response, "user", None)
    user_id = getattr(user, "id", None)

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not resolve user from token.",
        )

    return str(user_id)
