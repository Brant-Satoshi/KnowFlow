# 和本地 .venv 同一个 Python 版本（3.14）；slim 去掉了编译工具和文档，镜像更小
FROM python:3.14-slim

# 之后的命令都在容器里的 /app 下执行，相当于 cd services/api
WORKDIR /app

# 先只拷依赖清单再安装：代码改了、清单没改时，这一层直接用缓存，不用重新 pip install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 再拷代码。哪些文件不拷，见同目录的 .dockerignore
COPY . .

# 只是说明服务在容器里监听 8000；真正对外开放靠 docker run -p
EXPOSE 8000

# 和 pnpm dev:api 同一条 uvicorn 命令，有两处不同：
# --host 0.0.0.0：容器里的 127.0.0.1 只有容器自己能连，端口映射进不来
# 没有 --reload：镜像里的代码不会变，不需要监视文件
# 密钥和 DATABASE_URL 不写进镜像，docker run 时用环境变量传进来
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
