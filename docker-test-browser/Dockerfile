FROM node:20-bullseye

# Install dependencies for GUI and VNC
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    fluxbox \
    wget \
    supervisor \
    net-tools \
    x11-utils \
    && rm -rf /var/lib/apt/lists/*

# Install noVNC
RUN mkdir -p /opt/noVNC/utils/websockify && \
    wget -qO- https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz --strip 1 -C /opt/noVNC && \
    wget -qO- https://github.com/novnc/websockify/archive/refs/tags/v0.11.0.tar.gz | tar xz --strip 1 -C /opt/noVNC/utils/websockify && \
    ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

# Set up working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install

# Copy test script and entrypoint
COPY test-browser.ts ./
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Create supervisor config
RUN echo '[supervisord]\n\
nodaemon=true\n\
\n\
[program:xvfb]\n\
command=/usr/bin/Xvfb :99 -screen 0 1920x1080x24\n\
autorestart=true\n\
priority=100\n\
\n\
[program:fluxbox]\n\
command=/usr/bin/fluxbox -display :99\n\
autorestart=true\n\
priority=200\n\
environment=DISPLAY=:99\n\
\n\
[program:x11vnc]\n\
command=/usr/bin/x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -xkb -shared\n\
autorestart=true\n\
priority=300\n\
\n\
[program:novnc]\n\
command=/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6080\n\
autorestart=true\n\
priority=400\n\
' > /etc/supervisor/conf.d/supervisord.conf

# Set environment variable for display
ENV DISPLAY=:99

# Expose ports
# 5900: VNC
# 6080: noVNC (web interface)
EXPOSE 5900 6080

# Start entrypoint script
CMD ["./entrypoint.sh"]
