FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    wine64 xvfb xauth curl unzip ca-certificates python3 ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/windows-python && curl -fsSL \
    https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip \
    -o /tmp/python.zip && unzip -q /tmp/python.zip -d /opt/windows-python \
    && rm /tmp/python.zip && useradd -u 1006 -m runner
ENV HOME=/work/home WINEPREFIX=/work/wineprefix WINEARCH=win64 WINEDEBUG=-all
USER 1006:1006
WORKDIR /work
ENTRYPOINT ["xvfb-run", "-a", "/usr/lib/wine/wine64", "/opt/windows-python/python.exe"]
