FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY tools /app/tools
COPY src/pkjs/config.html /app/src/pkjs/config.html

EXPOSE 8765

VOLUME ["/data"]

ENTRYPOINT ["python", "tools/docker_entrypoint.py"]
CMD ["python", "tools/bridge.py", "--mode", "telegram", "--host", "0.0.0.0", "--port", "8765"]
