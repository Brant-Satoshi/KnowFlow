import os
from urllib.parse import urlparse

import psycopg
import pytest


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
