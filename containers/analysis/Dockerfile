FROM golang@sha256:4fa7c968ba93f1635670522dbb01a2c78150443e1385746924566079f36570ea AS go-tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY arsenal-lock.json ./
COPY scripts/install-go-arsenal.py ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build python3 install-go-arsenal.py

FROM mambaorg/micromamba:2.10.0@sha256:e1476182cd40eb1f7c0cfae4adec9bfd78f3d7f05c61368306abfdc8939c1198
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl unzip iproute2 dnsutils nmap whois jq openssl hydra medusa patator whatweb ruby-full ruby-dev build-essential libpcap-dev libpq-dev libsqlite3-dev libxml2-dev libxslt1-dev libffi-dev libkrb5-dev zlib1g-dev libssl-dev libyaml-dev libreadline-dev pkg-config rustc cargo chromium sqlmap dirsearch && rm -rf /var/lib/apt/lists/*
USER $MAMBA_USER
COPY --chown=$MAMBA_USER:$MAMBA_USER containers/analysis/environment.yml /tmp/environment.yml
RUN micromamba install --yes --name base --file /tmp/environment.yml && micromamba clean --all --yes
USER root
ENV PATH=/opt/conda/bin:/opt/ghosthunt/data/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV GHOSTHUNT_DATA_DIR=/opt/ghosthunt/data CONDA_PREFIX=/opt/conda CONDA_DEFAULT_ENV=base HOME=/work
WORKDIR /opt/ghosthunt
COPY bounty-integrations.json ./
COPY scripts/setup-bounty.mjs scripts/install-container-gitleaks.mjs ./scripts/
RUN node scripts/setup-bounty.mjs --tools && node scripts/install-container-gitleaks.mjs
COPY --from=go-tools /out/ /opt/ghosthunt/data/bin/
COPY arsenal-lock.json ./
COPY scripts/install-arsenal.py ./scripts/
RUN /opt/conda/bin/python3 scripts/install-arsenal.py binaries
RUN /opt/conda/bin/python3 scripts/install-arsenal.py python
RUN /opt/conda/bin/python3 scripts/install-arsenal.py metasploit
COPY arsenal-extra-lock.json ./
COPY scripts/install-commix.py ./scripts/
RUN /opt/conda/bin/python3 scripts/install-commix.py
COPY scripts/fix-dirsearch-runtime.py ./scripts/
RUN /opt/conda/bin/python3 scripts/fix-dirsearch-runtime.py
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --legacy-peer-deps
COPY src ./src
RUN npm run build && npm prune --omit=dev --legacy-peer-deps
COPY ghosthunt.py ./
RUN mkdir -p /work && chown 1000:1000 /work && chmod -R a+rX /opt/ghosthunt/data
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["/opt/conda/bin/node", "/opt/ghosthunt/dist/bounty/worker.js"]
