# VPS server for the VM: CPU-only torch, the map databases mounted at /data.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git libxcb1 libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
# LightGlue's weights, fetched at build time so the container starts offline.
RUN python -c "from lightglue import LightGlue; LightGlue(features='superpoint')"
COPY vps /app/vps
WORKDIR /app
CMD ["sh", "-c", "python -m vps.server --host 127.0.0.1 --port 8090 --threads 3 --db /data/*.h5 --debug-dir /debug"]
