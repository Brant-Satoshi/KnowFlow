"""测试用的造数据函数：都直接写数据库，调用方负责在测试结束时删掉自己建的用户。

删用户时，外键 ON DELETE CASCADE 会一起删掉：他的会话、他拥有的工作区（连同成员关系和其中的知识库）、他建的知识库，
以及这些知识库里的文件和片段。
"""

import secrets
import uuid

from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from main import create_app

EMBEDDING_DIMENSIONS = 1536  # chunks.embedding 是 vector(1536)


def insert_user(conn, password_hash: str = "not-a-real-hash") -> dict:
    email = f"pytest-{uuid.uuid4()}@example.com"
    user_id = conn.execute(
        "insert into users (email, password_hash) values (%s, %s) returning id",
        (email, password_hash),
    ).fetchone()[0]
    return {"id": str(user_id), "email": email}


def insert_session(conn, user_id: str, expires_in: str = "1 day") -> str:
    """给用户插入一条会话，返回 token，也就是 cookie 的值。expires_in 写成 "-1 minute" 就是一条已经过期的会话。"""
    token = secrets.token_urlsafe(32)
    conn.execute(
        "insert into sessions (id, user_id, expires_at) values (%s, %s, now() + %s::interval)",
        (token, user_id, expires_in),
    )
    return token


def client_for(conn, user: dict) -> TestClient:
    """以某个用户的身份发请求：给他插入一条会话，把 token 设成 cookie。"""
    client = TestClient(create_app(), raise_server_exceptions=False)
    client.cookies.set("rag_session", insert_session(conn, user["id"]))
    return client


def insert_workspace(conn, owner_id: str, name: str = "pytest 工作区") -> str:
    """建一个工作区，并把 owner 加成它的 owner 成员（KnowFlow 注册时也是这样建默认工作区的）。"""
    workspace_id = conn.execute(
        "insert into workspaces (name, owner_id) values (%s, %s) returning id",
        (name, owner_id),
    ).fetchone()[0]
    add_member(conn, str(workspace_id), owner_id, role="owner")
    return str(workspace_id)


def add_member(conn, workspace_id: str, user_id: str, role: str = "member") -> None:
    conn.execute(
        "insert into workspace_members (workspace_id, user_id, role) values (%s, %s, %s)",
        (workspace_id, user_id, role),
    )


def insert_knowledge_base(
    conn, workspace_id: str, user_id: str, name: str, description: str | None = None
) -> str:
    kb_id = conn.execute(
        "insert into knowledge_bases (name, description, user_id, workspace_id) values (%s, %s, %s, %s) returning id",
        (name, description, user_id, workspace_id),
    ).fetchone()[0]
    return str(kb_id)


def padded_vector(*head: float) -> list[float]:
    """1536 维的向量：前几维是给定的数，其余补 0。例如 padded_vector(1, 0) 指向第一个坐标轴。

    全是 0 的向量和任何向量的余弦距离都是 NaN，别用。
    """
    return list(head) + [0.0] * (EMBEDDING_DIMENSIONS - len(head))


def insert_file(conn, knowledge_base_id: str, name: str = "pytest.md") -> str:
    """在知识库里插入一个已建好索引（status = 'indexed'）的文件，返回文件 id。"""
    file_id = str(uuid.uuid4())
    conn.execute(
        "insert into files (id, name, type, size, status, knowledge_base_id) values (%s, %s, %s, %s, %s, %s)",
        (file_id, name, "text/markdown", 0, "indexed", knowledge_base_id),
    )
    return file_id


def insert_chunk(
    conn,
    file_id: str,
    idx: int,
    embedding: list[float],
    text: str | None = None,
    section_title: str | None = None,
) -> str:
    """插入一个片段，返回片段 id（和 KnowFlow 一样是 "<文件 id>-<序号>"）。

    embedding_text 照 KnowFlow 的格式在正文前面加上标题；meta 和 KnowFlow 一样记录 start、end。
    向量以 "[0.1, 0.2, ...]" 这样的文本传给 Postgres，在 SQL 里用 ::vector 转换。
    """
    chunk_id = f"{file_id}-{idx}"
    if text is None:
        text = f"pytest 片段 {idx}"
    section_line = f"section: {section_title}\n" if section_title else ""
    embedding_text = f"title: pytest 文档\n{section_line}text:\n{text}"
    conn.execute(
        """insert into chunks (id, file_id, idx, text, embedding_text, document_title, section_title, meta, embedding)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s::vector)""",
        (
            chunk_id,
            file_id,
            idx,
            text,
            embedding_text,
            "pytest 文档",
            section_title,
            Jsonb({"start": 0, "end": len(text)}),
            str(embedding),
        ),
    )
    return chunk_id
