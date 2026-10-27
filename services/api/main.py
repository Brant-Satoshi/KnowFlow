from datetime import timezone
import os
import secrets
import uuid
import logging

from fastapi import Body, Depends, FastAPI, Request, Response
from fastapi.responses import JSONResponse
import psycopg
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError

from auth import verify_password

logger = logging.getLogger(__name__)


def success(request: Request, data: object):
    return {"requestId": request.state.request_id, "ok": True, "data": data}


def failure(
    request: Request, status: int, message: str, data: object | None = None
) -> JSONResponse:
    content = {"requestId": request.state.request_id, "ok": False, "error": message}
    if data is not None:
        content["data"] = data
    return JSONResponse(status_code=status, content=content)


class ApiError(Exception):
    """要返回给客户端的错误：状态码、给用户看的信息、可选的附加数据。"""

    def __init__(self, status: int, message: str, data: object | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.data = data


SESSION_COOKIE = "rag_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30
COOKIE_SECURE = os.environ.get("COOKIE_SECURE") == "1"


def get_db():
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        yield conn


def get_current_user(request: Request, conn=Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = conn.execute(
        """SELECT users.id, users.email FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = %s and sessions.expires_at > now()
    LIMIT 1
    """,
        (token,),
    ).fetchone()
    if row is None:
        return None
    return {"id": str(row[0]), "email": str(row[1])}


def require_user(user=Depends(get_current_user)):
    if user is None:
        raise ApiError(401, "Unauthorized", {"code": "UNAUTHORIZED"})
    return user


def to_iso(t):
    return (
        t.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )

def to_knowledge_base(row):
    kb_id, name, description, created_at, updated_at = row
    kb = {
        "id": str(kb_id),
        "name": name,
        "createdAt": to_iso(created_at),
        "updatedAt": to_iso(updated_at),
    }
    if description is not None:
        kb["description"] = description
    return kb


def require_knowledge_base(
    knowledge_base_id: str, user=Depends(require_user), conn=Depends(get_db)
):
    try:
        kb_id = uuid.UUID(knowledge_base_id)
    except ValueError:
        raise ApiError(400, "Invalid knowledge base id")
    user_id = user["id"]
    row = conn.execute(
        "select id, name, description, created_at, updated_at from knowledge_bases where id = %s and workspace_id in (select workspace_id from workspace_members where user_id=%s)",
        (kb_id, user_id),
    ).fetchone()
    if not row:
        raise ApiError(404, "Knowledge base not found")
    return to_knowledge_base(row)


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

    @app.post("/api/auth/login")
    def login(request: Request, response: Response, body=Body(), conn=Depends(get_db)):
        bad_credentials = ApiError(
            401, "Invalid email or password", {"code": "BAD_CREDENTIALS"}
        )

        if not isinstance(body, dict):
            raise bad_credentials

        email = body.get("email")
        password = body.get("password")

        if not isinstance(email, str) or not isinstance(password, str):
            raise bad_credentials

        email = email.strip()

        if len(password) < 8:
            raise bad_credentials

        row = conn.execute(
            "select id, email, password_hash from users where lower(email)=lower(%s) limit 1",
            (email,),
        ).fetchone()

        if row is None:
            raise bad_credentials
        user_id, user_email, password_hash = row

        if not verify_password(password, password_hash):
            raise bad_credentials

        token = secrets.token_urlsafe(32)
        conn.execute(
            "insert into sessions (id, user_id, expires_at) values (%s, %s, now() + interval '30 days')",
            (token, user_id),
        )
        response.set_cookie(
            SESSION_COOKIE,
            token,
            httponly=True,
            samesite="lax",
            path="/",
            secure=COOKIE_SECURE,
            max_age=SESSION_MAX_AGE,
        )
        return success(request, {"user": {"id": str(user_id), "email": user_email}})

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response, conn=Depends(get_db)):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            conn.execute("delete from sessions where id=%s", (token,))
        response.delete_cookie(SESSION_COOKIE, path="/")
        return success(request, {"ok": True})

    @app.get("/api/knowledge-bases/{knowledge_base_id}")
    def get_knowledgebases_by_id(request: Request, kb=Depends(require_knowledge_base)):
        return success(request, {"knowledgeBase": kb})

    return app


app = create_app()
