import uuid
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError

logger = logging.getLogger(__name__)

def success(request: Request, data: object):
    return {"requestId": request.state.request_id, "ok": True, "data": data}

def failure(request: Request, status: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"requestId": request.state.request_id, "ok": False, "error": message},
    )

def create_app() -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def add_request_id(request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-Id"] = request_id
        return response

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request, exc: StarletteHTTPException):
        return failure(request, status=exc.status_code, message=str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request, exc: RequestValidationError):
        first = exc.errors()[0]
        loc = first["loc"]
        error_type = first["type"]
        if loc == ("body",) or error_type == "json_invalid":
            return failure(request, 400, message="invalid_request")
        field = (".").join([str(x) for x in loc[1:]])
        return failure(request, 400, f"{field}: {first['msg']}")
    
    @app.exception_handler(Exception)
    async def handle_unexpected_error(request, exc: Exception):
        logger.exception("unhandled error, requestId=%s", request.state.request_id)
        response = failure(request, 500, "internal_error")
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    @app.get("/api/health")
    def health(request: Request):
        return success(request, {"status": "ok"})

    return app


app = create_app()
