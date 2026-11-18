from auth import verify_password

# 用 TS 版 hashPassword("correct horse") 生成：Python 版必须认得 TS 版存进数据库的哈希
TS_HASH = "scrypt$16384$8$1$+BeBLEGCh/f7AR97+N0Qiw==$2Ut9pbJCgO5JcyFbshibVYibBjVT7p9j7zw5UJHy+wicai1GyjcZ2eXwNALsnSxKtFrDO6wqNzmAY8hOh//YPQ=="


def test_correct_password_returns_true():
    assert verify_password("correct horse", TS_HASH) is True


def test_wrong_password_returns_false():
    assert verify_password("wrong horse", TS_HASH) is False


def test_non_scrypt_hash_returns_false():
    assert verify_password("correct horse", "bcrypt$abc") is False


def test_non_numeric_params_returns_false():
    # 只把 N 换成 abc，其余 5 段保持合法，确保测的就是"参数不是数字"这一种情况
    bad_hash = TS_HASH.replace("scrypt$16384$", "scrypt$abc$", 1)
    assert verify_password("correct horse", bad_hash) is False
