import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Phase 28: guards the container-hardening properties actually verified
// live against a real Docker daemon this phase (non-root execution,
// dropped capabilities, read-only root filesystem, resource limits,
// healthchecks, and cAdvisor's reduced-privilege config) - see the Phase
// 28 report for exactly what was run and observed. These tests catch a
// future edit silently reintroducing root/privileged/unbounded
// containers; they do not themselves start Docker (that verification is
// separate and already performed).

const prodCompose = fs.readFileSync(path.resolve(__dirname, "../../docker-compose.prod.yml"), "utf-8");
const devCompose = fs.readFileSync(path.resolve(__dirname, "../../docker-compose.yml"), "utf-8");
const backendDockerfile = fs.readFileSync(path.resolve(__dirname, "../../backend/Dockerfile"), "utf-8");
const frontendDockerfile = fs.readFileSync(path.resolve(__dirname, "../../Dockerfile"), "utf-8");

function stripComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

function serviceBlock(compose: string, serviceName: string): string {
  const lines = stripComments(compose).split("\n");
  const startIndex = lines.findIndex((line) => line.match(new RegExp(`^ {2}${serviceName}:\\s*$`)));
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(startIndex + 1);
  const endOffset = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (endOffset === -1 ? rest : rest.slice(0, endOffset)).join("\n");
}

describe("docker-compose.prod.yml container hardening (Phase 28)", () => {
  for (const service of ["backend", "frontend"]) {
    describe(`${service} service`, () => {
      const block = serviceBlock(prodCompose, service);

      it("sets no-new-privileges", () => {
        expect(block).toMatch(/no-new-privileges:true/);
      });

      it("drops every Linux capability, and adds none back", () => {
        expect(block).toMatch(/cap_drop:\s*\n\s*-\s*ALL/);
        expect(block).not.toMatch(/cap_add:/);
      });

      it("runs with a read-only root filesystem", () => {
        expect(block).toMatch(/read_only:\s*true/);
      });

      it("is never privileged", () => {
        expect(block).not.toMatch(/privileged:\s*true/);
      });

      it("has explicit memory and CPU limits", () => {
        expect(block).toMatch(/mem_limit:\s*\S+/);
        expect(block).toMatch(/cpus:\s*\S+/);
      });

      it("has a healthcheck with sane timeout/retries", () => {
        expect(block).toMatch(/healthcheck:/);
        expect(block).toMatch(/interval:\s*\d+s/);
        expect(block).toMatch(/retries:\s*\d+/);
        expect(block).toMatch(/start_period:\s*\d+s/);
      });

      it("restarts automatically on crash, without an explicit always-restart-even-when-stopped policy", () => {
        // unless-stopped: recovers from an ordinary crash, but respects a
        // deliberate `docker compose stop` - not "always" (which would
        // also fight a deliberate stop) and not "no"/unset (which would
        // leave a crashed container down until an operator notices).
        expect(block).toMatch(/restart:\s*unless-stopped/);
      });
    });
  }

  it("backend has no published host port", () => {
    const block = serviceBlock(prodCompose, "backend");
    expect(block).not.toMatch(/^\s*ports:/m);
  });

  it("backend's healthcheck targets /health (the full-stack check), not /nginx-health", () => {
    const block = serviceBlock(prodCompose, "backend");
    expect(block).toContain("/health");
    expect(block).not.toContain("/nginx-health");
  });

  it("frontend's healthcheck targets /nginx-health (proxy-layer only), not /health", () => {
    const block = serviceBlock(prodCompose, "frontend");
    expect(block).toContain("/nginx-health");
    expect(block).not.toMatch(/spider.*\/health"/);
  });

  it("frontend listens internally on the unprivileged 8080, not port 80", () => {
    const block = serviceBlock(prodCompose, "frontend");
    expect(block).toMatch(/:8080/);
    expect(block).not.toMatch(/:80"/);
  });

  it("frontend's tmpfs mounts use a world-writable mode, matching what non-root nginx needs", () => {
    const block = serviceBlock(prodCompose, "frontend");
    expect(block).toMatch(/type:\s*tmpfs/);
    expect(block).toMatch(/mode:\s*0o1777/);
  });

  it("no service anywhere in this file runs privileged", () => {
    expect(stripComments(prodCompose)).not.toMatch(/privileged:\s*true/);
  });
});

describe("Dockerfiles run as non-root (Phase 28)", () => {
  it("backend Dockerfile switches to the non-root node user before CMD", () => {
    const lines = backendDockerfile.split("\n");
    const userIndex = lines.findIndex((l) => l.trim() === "USER node");
    const cmdIndex = lines.findIndex((l) => l.trim().startsWith("CMD"));
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(cmdIndex).toBeGreaterThan(userIndex);
  });

  it("frontend Dockerfile switches to the non-root nginx user before CMD", () => {
    const lines = frontendDockerfile.split("\n");
    const userIndex = lines.findIndex((l) => l.trim() === "USER nginx");
    const cmdIndex = lines.findIndex((l) => l.trim().startsWith("CMD"));
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(cmdIndex).toBeGreaterThan(userIndex);
  });
});

describe("docker-compose.yml (dev/CI) monitoring stack (Phase 28)", () => {
  it("cAdvisor is no longer privileged", () => {
    const block = serviceBlock(devCompose, "cadvisor");
    expect(block).not.toMatch(/privileged:\s*true/);
  });

  it("cAdvisor drops all capabilities and adds back only a minimal, named set", () => {
    const block = serviceBlock(devCompose, "cadvisor");
    expect(block).toMatch(/cap_drop:\s*\n\s*-\s*ALL/);
    expect(block).toMatch(/cap_add:/);
    expect(block).toMatch(/no-new-privileges:true/);
  });

  it("prometheus, grafana, and cadvisor all bind to loopback only, never a public interface", () => {
    for (const service of ["prometheus", "grafana", "cadvisor"]) {
      const block = serviceBlock(devCompose, service);
      const portLines = block.split("\n").filter((l) => /^\s*-\s*"/.test(l) && l.includes(":"));
      expect(portLines.length).toBeGreaterThan(0);
      for (const line of portLines) {
        expect(line).toContain("127.0.0.1:");
      }
    }
  });

  it("grafana has no hardcoded admin/admin credential", () => {
    const block = serviceBlock(devCompose, "grafana");
    expect(block).not.toMatch(/GF_SECURITY_ADMIN_PASSWORD=admin\b/);
    expect(block).toMatch(/GRAFANA_ADMIN_PASSWORD:\?/);
  });

  it("this stack is never actually configured in docker-compose.prod.yml (monitoring stays dev/CI-only)", () => {
    // Only checks the live config, not comments - docker-compose.prod.yml's
    // own header comment legitimately explains, in prose, why this stack
    // isn't included, which would otherwise trip a naive whole-file check.
    expect(stripComments(prodCompose)).not.toMatch(/cadvisor|grafana|prometheus/i);
  });
});

describe("nginx.conf listens unprivileged (Phase 28)", () => {
  const nginxConf = fs.readFileSync(path.resolve(__dirname, "../../nginx.conf"), "utf-8");
  const liveLines = nginxConf
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");

  it("listens on 8080, not the privileged port 80", () => {
    expect(liveLines).toMatch(/listen\s+8080;/);
    expect(liveLines).not.toMatch(/listen\s+80;/);
  });

  it("also listens on IPv6, so the base image's entrypoint never needs to patch a read-only config file", () => {
    expect(liveLines).toMatch(/listen\s+\[::\]:8080;/);
  });
});
