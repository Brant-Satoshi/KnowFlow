import os
import uuid
import logging

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
import psycopg
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError

logger = logging.getLogger(__name__)

def success(request: Request, data: object):
    return {"requestId": request.state.request_id, "ok": True, "data": data}

def failure(request: Request, status: int, message: str, data: object | None = None) -> JSONResponse:
    content = {"requestId": request.state.request_id, "ok": False, "error": message}
    if data is not None:
        content["data"] = data
    return JSONResponse(
        status_code=status,
        content=content
    )

class ApiError(Exception):
    """要返回给客户端的错误：状态码、给用户看的信息、可选的附加数据。"""
    
    def __init__(self, status: int, message: str, data: object | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.data = data

SESSION_COOKIE = "rag_session"

def get_db():
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        yield conn

def get_current_user(request: Request, conn=Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = conn.execute("""SELECT users.id, users.email FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = %s and sessions.expires_at > now()
    LIMIT 1
    """, (token, )).fetchone()
    if row is None:
        return None
    return {
        "id": str(row[0]),
        "email": str(row[1])
    }

def require_user(user=Depends(get_current_user)):
    if user is None:
        raise ApiError(401, "Unauthorized", {"code": "UNAUTHORIZED"})
    return user

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
    async def handle_unexpected_error(request, _exc):
        logger.exception("unhandled error, requestId=%s", request.state.request_id)
        response = failure(request, 500, "internal_error")
        response.headers["X-Request-Id"] = request.state.request_id
        return response
    @app.exception_handler(ApiError)
    async def handle_api_error(request, exc: ApiError):
        return failure(request, exc.status, exc.message, exc.data)

    @app.get("/api/health")
    def health(request: Request):
        return success(request, {"status": "ok"})

    @app.get("/api/auth/me")
    def auth_me(request: Request, user=Depends(get_current_user)):
        return success(request, {"user": user})
        
    return app


app = create_app()
