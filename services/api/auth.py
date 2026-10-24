import base64
import hashlib
import hmac


def verify_password(password: str, stored: str) -> bool:
    """用 stored 里的盐和参数重新计算 scrypt，和存储的哈希一致就返回 True；哈希格式不对返回 False，不抛异常。

    约定：password 必须是 str。传入数字或 None 时，password.encode() 会抛 AttributeError，
    except ValueError 接不住，最后变成 500。调用方（登录接口）要先确认 password 是字符串再调用。
    """
    # scrypt$16384$8$1$<salt>$<hash>
    #  "scrypt$16384$8$1$<salt>$<hash>".split('$')
    # → ['scrypt', '16384', '8', '1', '<salt>', '<hash>']
    #     [0]       [1]      [2]  [3]  [4]       [5]
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    _, n_str, r_str, p_str, salt_b64, hash_b64 = parts
    try:
        n, r, p = int(n_str), int(r_str), int(p_str)
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(hash_b64)
        derived_hash = hashlib.scrypt(
            password=password.encode(),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
        )
    except ValueError:
        return False
    # 不能用 ==：它遇到第一个不同的字节就返回，耗时越长说明开头猜对的字节越多，攻击者测响应时间就能逐字节猜出 expected；
    # compare_digest 总是比完全部字节才返回，耗时和内容无关。
    return hmac.compare_digest(derived_hash, expected)
