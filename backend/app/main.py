"""Hush Atlas local API application."""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import PROJECT_ROOT, Settings, settings as default_settings
from .db import init_db, recover_interrupted_jobs
from .demo import interrupt_stale_demo
from .reflection import GemmaService
from .routes import router
from .walks import WalkError
from .yamnet_service import YamnetEngine


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or default_settings

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        app_settings.ensure_directories()
        init_db(app_settings)
        recover_interrupted_jobs(app_settings)
        interrupt_stale_demo(app_settings)
        application.state.settings = app_settings
        application.state.engine = YamnetEngine(app_settings)
        application.state.gemma = GemmaService(app_settings)
        application.state.analysis_pool = ThreadPoolExecutor(
            max_workers=app_settings.analysis_workers,
            thread_name_prefix="silence-analysis",
        )
        application.state.demo_pool = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="silence-demo",
        )
        application.state.demo_lock = threading.Lock()
        logger.info(
            "Hush Atlas ready at storage %s; YAMNet assets %s",
            app_settings.data_dir.name,
            "present" if app_settings.weights_path.is_file() else "missing",
        )
        try:
            yield
        finally:
            application.state.analysis_pool.shutdown(wait=False, cancel_futures=True)
            application.state.demo_pool.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(
        title="Hush Atlas API",
        version=app_settings.version,
        description=(
            "A quiet atlas of the sounds around you. The local app analyzes and "
            "stores audio on your own machine; a hosted instance does the same on "
            "the server that runs this API."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.middleware("http")
    async def local_security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "geolocation=(self), microphone=(self), camera=()"
        )
        return response

    @app.exception_handler(WalkError)
    async def walk_error(request: Request, exc: WalkError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "detail": (
                    "An unexpected server error occurred. Try again."
                )
            },
        )

    app.include_router(router)

    @app.get("/api", include_in_schema=False)
    def api_root() -> dict:
        return {
            "name": app_settings.app_name,
            "version": app_settings.version,
            "privacy": (
                "Audio is analyzed and stored by the server that runs this API. "
                "In the local app, that server is your own device."
            ),
            "docs": "/docs",
        }

    @app.get("/local-ca.crt", include_in_schema=False)
    def local_ca() -> FileResponse:
        certificate = PROJECT_ROOT / "certs" / "mkcert-rootCA.crt"
        if not certificate.is_file():
            certificate = PROJECT_ROOT / "certs" / "rootCA.crt"
        if not certificate.is_file():
            raise HTTPException(
                status_code=404,
                detail="No local certificate authority is installed.",
            )
        return FileResponse(
            certificate,
            media_type="application/x-x509-ca-cert",
            filename="hush-atlas-local-ca.crt",
        )

    dist = app_settings.frontend_dist
    if (dist / "index.html").is_file():
        assets = dist / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="frontend-assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def frontend(full_path: str) -> FileResponse:
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="API route not found.")
            requested = (dist / full_path).resolve()
            dist_resolved = dist.resolve()
            if requested.is_file() and (
                requested == dist_resolved or dist_resolved in requested.parents
            ):
                return FileResponse(requested)
            return FileResponse(dist / "index.html", media_type="text/html")

    return app


app = create_app()
