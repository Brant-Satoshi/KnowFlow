"""测试用的造数据函数：都直接写数据库，调用方负责在测试结束时删掉自己建的用户。

删用户时，外键 ON DELETE CASCADE 会一起删掉：他的会话、他拥有的工作区（连同成员关系和其中的知识库）、他建的知识库。
"""

import secrets
import uuid


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
