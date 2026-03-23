from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, upload, metrics

app = FastAPI(title="AudioHub API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(metrics.router)
app.include_router(health.router)
