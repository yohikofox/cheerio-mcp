FROM node:20-bullseye

# Install dependencies for GUI, VNC and Playwright
RUN apt-get update && apt-get install -y \
    # Virtual display and VNC
    xvfb \
    x11vnc \
    x11-utils \
    fluxbox \
    # Process supervisor
    supervisor \
    # Network utilities
    net-tools \
    # Fonts and basic libraries
    fonts-liberation \
    fonts-noto-color-emoji \
    # Additional utilities
    wget \
    ca-certificates \
    # Cleanup
    && rm -rf /var/lib/apt/lists/*

# Install noVNC
RUN mkdir -p /opt/noVNC/utils/websockify && \
    wget -qO- https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz --strip 1 -C /opt/noVNC && \
    wget -qO- https://github.com/novnc/websockify/archive/refs/tags/v0.11.0.tar.gz | tar xz --strip 1 -C /opt/noVNC/utils/websockify && \
    ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for building)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build to reduce image size
RUN npm prune --production

# Install Playwright browsers and system dependencies
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

# Set environment variables
ENV DISPLAY=:99
ENV NODE_ENV=production

# Create supervisor configuration
RUN echo '[supervisord]\n\
nodaemon=true\n\
logfile=/var/log/supervisor/supervisord.log\n\
pidfile=/var/run/supervisord.pid\n\
\n\
[program:xvfb]\n\
command=/usr/bin/Xvfb :99 -screen 0 1920x1080x24\n\
autorestart=true\n\
priority=100\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
\n\
[program:fluxbox]\n\
command=/usr/bin/fluxbox -display :99\n\
autorestart=true\n\
priority=200\n\
environment=DISPLAY=:99\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
\n\
[program:x11vnc]\n\
command=/usr/bin/x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -xkb -shared\n\
autorestart=true\n\
priority=300\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
\n\
[program:novnc]\n\
command=/opt/noVNC/utils/novnc_proxy --vnc localhost:5900 --listen 6080\n\
autorestart=true\n\
priority=400\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
\n\
[program:mcp-server]\n\
command=/bin/bash -c "sleep 5 && node /app/dist/server-mcp-http.js"\n\
autorestart=true\n\
priority=500\n\
environment=DISPLAY=:99\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
' > /etc/supervisor/conf.d/supervisord.conf

# Create log directory for supervisor
RUN mkdir -p /var/log/supervisor

# Expose ports
# 3000: MCP server
# 5900: VNC port
# 6080: noVNC web interface
EXPOSE 3000 5900 6080

# Start supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
