import os
from urllib.parse import urlparse

import psycopg
import pytest

from testdata import add_member, insert_knowledge_base, insert_user, insert_workspace


# pytest 会自动加载同一目录下的 conftest.py：这里的 fixture 所有测试文件都能直接用，不用 import。


@pytest.fixture
def conn():
    """连到本地数据库。没导出 DATABASE_URL 就跳过；不是本地数据库就拒绝运行。"""
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("先在终端里 export DATABASE_URL")
    if urlparse(url).hostname not in ("localhost", "127.0.0.1"):
        pytest.fail(f"测试会写数据库，只允许连本地：{urlparse(url).hostname}")
    with psycopg.connect(url, autocommit=True) as connection:
        yield connection


@pytest.fixture
def tenants(conn):
    """两个互不相干的租户，加一个被邀请进 alice 工作区的普通成员 carol：

    - alice：自己的工作区里有知识库 kb_alice
    - bob：自己的工作区里有知识库 kb_bob
    - carol：没有自己的工作区，是 alice 工作区的 member

    测完删掉三个用户，工作区、成员关系、知识库，以及知识库里的文件和片段随外键一起删掉。
    """
    alice, bob, carol = insert_user(conn), insert_user(conn), insert_user(conn)
    alice_ws = insert_workspace(conn, alice["id"])
    bob_ws = insert_workspace(conn, bob["id"])
    add_member(conn, alice_ws, carol["id"], role="member")
    data = {
        "alice": alice,
        "bob": bob,
        "carol": carol,
        "kb_alice": insert_knowledge_base(conn, alice_ws, alice["id"], "Alice 的知识库", "测试用"),
        "kb_bob": insert_knowledge_base(conn, bob_ws, bob["id"], "Bob 的知识库"),
    }
    yield data
    conn.execute(
        "delete from users where id = any(%s)",
        ([alice["id"], bob["id"], carol["id"]],),
    )
