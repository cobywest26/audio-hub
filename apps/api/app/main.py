from fastapi import FastAPI
from app.routes import health

app = FastAPI(title="AudioHub API")

app.include_router(health.router, prefix="/api")
