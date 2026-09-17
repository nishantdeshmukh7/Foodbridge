# Ansible

## What it does, and where it stops

`ansible/` prepares a **fresh Linux host** to run this repo's production Docker Compose stack. It stops at "the host is ready" — it does not deploy the application.

That boundary is deliberate. Docker and CI already own application deployment (build image → ship image → `docker compose up`). Ansible owns the layer *below* that: the machine itself. Folding `docker compose up` into a playbook would duplicate what CI already does and blur two responsibilities that are easier to reason about apart. Deploying onto a host prepared this way is then just:

```bash
scp docker-compose.prod.yml nginx.conf .env.production host:/opt/foodbridge/
ssh host 'cd /opt/foodbridge && docker compose -f docker-compose.prod.yml \
  --env-file .env.production up -d --build'
```

This also means Ansible remains useful regardless of which of the three topologies you deploy — it's the tool for the VM case (and for a bastion, a CI runner, or a monitoring host), whereas Kubernetes and ECS manage their own nodes.

## Structure

```
ansible/
├── ansible.cfg
├── inventory/
│   ├── hosts.ini              # real inventory (placeholder host, commented)
│   ├── test-docker.ini        # local verification against a container
│   └── group_vars/all.yml     # app_user, node_exporter_version, etc.
├── playbooks/site.yml
└── roles/
    ├── app_user/              # dedicated unprivileged service account
    ├── docker/                # Docker Engine + Compose plugin (official repo)
    ├── firewall/              # UFW, default-deny inbound
    ├── node_exporter/         # Prometheus host-metrics agent (systemd)
    └── unattended_upgrades/   # automatic security patching
```

`group_vars/` lives **inside** `inventory/`, not at the `ansible/` root — Ansible resolves group variables relative to the inventory file. (Getting this wrong was an actual failure during development: `'app_user' is undefined`.)

## The roles

**`app_user`** — creates a `foodbridge` system group and user with `/usr/sbin/nologin` and home `/opt/foodbridge` (mode `0750`). Deploys should never run as root or as a personal login account. Same "no more privilege than needed" principle the containers already apply internally.

**`docker`** — installs Docker Engine and the Compose *plugin* from Docker's own apt repository, not the distro package (which is frequently outdated and often lacks `docker compose` v2). This matters because the repo's `Makefile` and README assume `docker compose`, not `docker-compose`. Adds `app_user` to the `docker` group. Architecture is detected at runtime via `dpkg --print-architecture` rather than hardcoded, so the same role works on x86_64 and arm64.

**`firewall`** — UFW with `default deny incoming` / `default allow outgoing`. Opens only what `docker-compose.prod.yml` actually publishes (80, 443 — the backend publishes nothing) plus SSH. SSH uses `rule: limit` rather than `allow`, which rate-limits repeated connection attempts. Port 9100 (node_exporter) opens **only** if `monitoring_source_cidr` is set; it defaults to empty so the rule is skipped entirely rather than exposed to `0.0.0.0/0`.

**`node_exporter`** — installs the Prometheus host-metrics agent as a systemd service with standard hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`). This completes the third monitoring layer: node_exporter covers the *host*, cAdvisor the *containers*, and the backend's `/metrics` the *application* — see [MONITORING.md](MONITORING.md). Installed to a versioned path with a symlink, so a version bump is a real, visible change rather than an in-place binary swap.

**`unattended_upgrades`** — automatic patching scoped to **security** origins only, not all updates. That scoping is intentional: an internet-facing host shouldn't wait on a human to apply security patches, but it also shouldn't silently upgrade Docker or Postgres to a breaking new version unattended. `Automatic-Reboot` is off.

## Idempotency

Every task is idempotent, and this was verified rather than assumed — run twice, second run must report `changed=0`:

```
# First run (fresh host)
PLAY RECAP
ansible-test-host : ok=32  changed=23  unreachable=0  failed=0  skipped=1

# Second run, immediately after
PLAY RECAP
ansible-test-host : ok=29  changed=0   unreachable=0  failed=0  skipped=3
```

The techniques that make this hold: `state: present` rather than shell commands; `get_url` with `force: false`; a `stat` check gating the node_exporter download; `changed_when: false` on the pure-read `dpkg --print-architecture` command; and handlers (`notify: restart node_exporter`) so the service restarts only when its unit file or binary actually changed.

## How this was actually tested

Not with `--check` alone, and not against the developer's own machine (these are Debian/systemd tasks; macOS isn't a valid target). A real systemd-capable Ubuntu 22.04 container was used as the host:

```bash
docker run -d --name ansible-test-host --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  geerlingguy/docker-ubuntu2204-ansible:latest

cd ansible
ansible -i inventory/test-docker.ini app_servers -m ping -c community.docker.docker
ansible-playbook -i inventory/test-docker.ini -c community.docker.docker playbooks/site.yml
# ...then run it a second time to prove idempotency
```

`--privileged` and the cgroup mount are needed because the playbook manages real systemd units, which a normal container can't do. This is a throwaway test host, not a pattern for production containers.

### End state, verified inside the container

```
$ docker --version && docker compose version
Docker version 29.8.1
Docker Compose version v5.5.1

$ id foodbridge
uid=998(foodbridge) gid=999(foodbridge) groups=999(foodbridge),998(docker)

$ ufw status verbose
Status: active
Default: deny (incoming), allow (outgoing), deny (routed)
22/tcp   LIMIT IN    Anywhere
80/tcp   ALLOW IN    Anywhere
443/tcp  ALLOW IN    Anywhere

$ systemctl is-active node_exporter unattended-upgrades
active
active

$ curl -s localhost:9100/metrics | head -1
# HELP go_gc_duration_seconds A summary of the pause duration of GC cycles.
```

Each role was confirmed by its actual effect — Docker really installed, UFW really default-deny with exactly the intended ports, node_exporter really serving metrics — not by the playbook merely reporting success.

## Running against a real host

```bash
# 1. Add your host to inventory/hosts.ini:
#    [app_servers]
#    foodbridge-app-01 ansible_host=203.0.113.10 ansible_user=ubuntu

# 2. Set monitoring_source_cidr in inventory/group_vars/all.yml if you want
#    node_exporter scrapeable (leave empty to keep port 9100 closed).

# 3. Dry run first - shows what would change without changing it.
ansible-playbook playbooks/site.yml --check --diff

# 4. Apply.
ansible-playbook playbooks/site.yml

# 5. Confirm idempotency on your own host too.
ansible-playbook playbooks/site.yml    # expect changed=0
```

Syntax-only check: `ansible-playbook playbooks/site.yml --syntax-check`.

## Limitations

- **Debian/Ubuntu only.** The roles use `apt` and Docker's Debian/Ubuntu repository. A RHEL/Amazon Linux target would need `dnf` equivalents. Not abstracted, because a speculative multi-distro abstraction that was never tested on a second distro would be worse than an honest single-target role.
- **Tested on Ubuntu 22.04 specifically**, in a container. A real cloud VM has a real kernel and real networking; UFW behaviour in particular is more meaningful there.
- **No SSH hardening role** (key-only auth, disabling root login). Most cloud images ship with sane defaults already, and getting this wrong locks you out of the host. Worth adding deliberately rather than as a side effect.
- **No secrets management.** `.env.production` is out of scope here by design — it's created out-of-band, never templated by Ansible into a repo-tracked file. Ansible Vault would be the tool if that changes.
- **Not run in CI.** There's no GitHub Actions job for this, because meaningful Ansible CI needs a real VM (or a privileged systemd container) to converge against, and the value over the local verification above is low. `--syntax-check` is cheap to add if desired.
