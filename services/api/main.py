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
import embeddings

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
        """
        SELECT users.id, users.email
        FROM sessions
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


def require_knowledge_base_access(conn, kb_id: uuid.UUID, user_id: str) -> dict:
    row = conn.execute(
        """
        SELECT id, name, description, created_at, updated_at
        FROM knowledge_bases
        WHERE id = %s
          AND workspace_id IN (
              SELECT workspace_id
              FROM workspace_members
              WHERE user_id = %s
          )
        """,
        (kb_id, user_id),
    ).fetchone()
    if row is None:
        raise ApiError(404, "Knowledge base not found")

    return to_knowledge_base(row)


def require_knowledge_base(
    knowledge_base_id: str, user=Depends(require_user), conn=Depends(get_db)
):
    try:
        kb_id = uuid.UUID(knowledge_base_id)
    except ValueError:
        raise ApiError(400, "Invalid knowledge base id")
    return require_knowledge_base_access(conn, kb_id, user["id"])


def vector_search_chunks(conn, query_vector, kb_id, top_k, max_distance):
    vector_text = "[" + ",".join(str(x) for x in query_vector) + "]"

    rows = conn.execute(
        """
        SELECT c.id::text,
            c.file_id,
            c.idx,
            c.text,
            c.embedding_text,
            c.document_title,
            c.section_title,
            c.meta,
            f.name,
            c.embedding <=> %(vector)s::vector AS distance
        FROM chunks c
        JOIN files f ON c.file_id = f.id
        WHERE c.embedding IS NOT NULL
          AND f.knowledge_base_id = %(kb_id)s
          AND (c.embedding <=> %(vector)s::vector) < %(max_distance)s
        ORDER BY c.embedding <=> %(vector)s::vector ASC
        LIMIT %(top_k)s
        """,
        {
            "vector": vector_text,
            "kb_id": kb_id,
            "max_distance": max_distance,
            "top_k": top_k,
        },
    ).fetchall()

    return rows


def get_embed_query():
    """依赖：返回"问题转向量"的函数，但不在这里调用它。

    依赖在路由函数体之前执行，那时请求还没校验、权限也还没查；路由做完这两步才调用返回的函数。
    调用失败时异常交给全局的 500 处理，日志里带着 requestId。测试里用 dependency_overrides 把它换成假的。
    """
    return embeddings.embed_query


DEFAULT_TOP_K = 5  # TS 的 RETRIEVAL.finalTopK
DEFAULT_MAX_DISTANCE = 0.6  # TS 的 RETRIEVAL.maxDistance


def is_number(value) -> bool:
    """对应 JS 的 typeof value === 'number'。Python 的 True / False 是 int 的子类，要单独排除。"""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_search_request(body) -> dict:
    """按 TS 版 /api/rag/search 的顺序和错误信息校验请求体，返回检索要用的参数。

    今天只做向量检索：mode 是 keyword / hybrid，或者带了 fileId、filter 时返回 400，
    不悄悄忽略（忽略 filter 会把调用方明确排除的片段也返回）。
    """
    if not isinstance(body, dict):
        body = {}
    query = body.get("query")
    mode = body.get("mode", "vector")
    file_id = body.get("fileId")
    knowledge_base_id = body.get("knowledgeBaseId")
    # 和 JS 的解构默认值一样：字段不存在时才用默认值，传了 null 不算不存在
    top_k = body.get("topK", DEFAULT_TOP_K)
    max_distance = body.get("maxDistance", DEFAULT_MAX_DISTANCE)

    if not isinstance(query, str) or not query.strip():
        raise ApiError(400, "Missing query")
    if mode not in ("vector", "keyword", "hybrid"):
        raise ApiError(400, "mode must be vector, keyword, or hybrid")
    if mode != "vector":
        raise ApiError(400, f"mode {mode} is not supported yet")
    if file_id is not None and not isinstance(file_id, str):
        raise ApiError(400, "fileId must be a string")
    if knowledge_base_id is not None and not isinstance(knowledge_base_id, str):
        raise ApiError(400, "knowledgeBaseId must be a string")
    if not is_number(top_k) or not 1 <= top_k <= 20 or top_k != int(top_k):
        raise ApiError(400, "topK must be between 1 and 20")
    if not is_number(max_distance) or not 0 <= max_distance <= 1:
        raise ApiError(400, "maxDistance must be between 0 and 1")
    if body.get("filter") is not None:
        raise ApiError(400, "filter is not supported yet")
    if file_id:
        raise ApiError(400, "fileId is not supported yet")
    if not knowledge_base_id:
        raise ApiError(400, "knowledgeBaseId or fileId is required")
    try:
        kb_id = uuid.UUID(knowledge_base_id)
    except ValueError:
        raise ApiError(400, "Invalid knowledgeBaseId")

    # query 原样返回、不 trim：TS 也是把原始问题拿去转向量
    return {
        "query": query,
        "knowledge_base_id": kb_id,
        "top_k": top_k,
        "max_distance": max_distance,
    }


def to_search_chunk(row) -> dict:
    """把检索 SQL 的一行转成 TS 版返回的片段格式。

    row 的列顺序和 TS 版 searchChunks 的 SELECT 一样：
    id, file_id, idx, text, embedding_text, document_title, section_title, meta, file_name, distance
    distance 不单独返回，和 TS 的 attachDistance 一样并进 meta._distance。
    """
    (
        chunk_id,
        file_id,
        idx,
        text,
        embedding_text,
        document_title,
        section_title,
        meta,
        file_name,
        distance,
    ) = row
    return {
        "id": chunk_id,
        "fileId": str(file_id),
        "idx": idx,
        "text": text,
        "embeddingText": embedding_text,
        "documentTitle": document_title,
        "sectionTitle": section_title,
        "meta": {**(meta or {}), "_distance": distance},
        "fileName": file_name,
    }


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

    @app.post("/api/rag/search")
    def search_chunks(
        request: Request,
        body=Body(),
        user=Depends(require_user),
        embed=Depends(get_embed_query),
        conn=Depends(get_db),
    ):
        params = parse_search_request(body)
        require_knowledge_base_access(conn, kb_id=params["knowledge_base_id"], user_id=user["id"])
        # 权限检查通过，才生成问题向量
        query_vector = embed(params["query"])
        rows = vector_search_chunks(
            conn,
            query_vector=query_vector,
            kb_id=params["knowledge_base_id"],
            top_k=params["top_k"],
            max_distance=params["max_distance"],
        )
        return success(request, {"chunks": [to_search_chunk(row) for row in rows]})

    return app


app = create_app()
