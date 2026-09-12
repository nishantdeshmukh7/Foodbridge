import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Phase 27: nginx.conf is the actual production reverse-proxy
// configuration (see the file's own header comment for the full traffic
// map/reasoning) - not application code, so it can't be exercised by a
// normal unit test the way TypeScript can. These tests instead guard its
// literal text content against specific, easy-to-accidentally-undo
// regressions: a future edit that swaps $proxy_add_x_forwarded_for back
// to $http_x_forwarded_for (reopening the IP-spoofing hole
// TRUST_PROXY=1 depends on), rewrites the /api/ proxy path in a way that
// would break every existing backend route, or reintroduces a wildcard
// CSP/CORS-adjacent directive, would all fail loudly here instead of only
// being caught by someone reading a diff carefully. Real runtime
// behavior (does nginx actually start, proxy correctly, forward the
// right headers) is verified separately via Docker - see the Phase 27
// report for that.

const nginxConf = fs.readFileSync(path.resolve(__dirname, "../../nginx.conf"), "utf-8");

// Only the live (non-comment) config lines - the file's own documented
// HTTPS example block is deliberately full of commented-out directives
// that would otherwise trip several of the checks below (e.g. it
// legitimately mentions certificate paths and a placeholder domain, but
// only inside comments explaining how to enable them).
const liveLines = nginxConf
  .split("\n")
  .map((line) => line.replace(/#.*$/, ""))
  .join("\n");

describe("nginx.conf (Phase 27)", () => {
  it("proxies /api/ to the backend over the internal Docker network, not a public address", () => {
    expect(liveLines).toMatch(/location\s+\/api\/\s*\{[^}]*proxy_pass\s+http:\/\/backend:3001;/s);
  });

  it("proxies /api/ with no extra path segment on proxy_pass, so backend routes are reached unmodified", () => {
    const match = /location\s+\/api\/\s*\{[^}]*?proxy_pass\s+(http:\/\/backend:3001\S*);/s.exec(liveLines);
    expect(match).not.toBeNull();
    // Exactly "http://backend:3001;" - no trailing path (e.g. not
    // ".../api/", which would strip/rewrite the matched prefix instead of
    // forwarding the original URI unchanged).
    expect(match?.[1]).toBe("http://backend:3001");
  });

  it("proxies /health as an exact-match location, also with no path rewriting", () => {
    expect(liveLines).toMatch(/location\s+=\s+\/health\s*\{[^}]*proxy_pass\s+http:\/\/backend:3001;/s);
  });

  it("serves an nginx-only health check that never reaches the backend", () => {
    const block = /location\s+=\s+\/nginx-health\s*\{([^}]*)\}/s.exec(liveLines);
    expect(block).not.toBeNull();
    expect(block?.[1]).not.toContain("proxy_pass");
  });

  it("builds X-Forwarded-For by appending to it, never by passing a client-supplied value through unchanged", () => {
    // The dangerous mistake this guards against: $http_x_forwarded_for
    // (the client's own, spoofable header, unmodified) instead of
    // $proxy_add_x_forwarded_for (nginx's own real peer address appended
    // to whatever the client sent) - see backend/src/test/trust-proxy.test.ts
    // for the Express-side half of why this distinction matters.
    const forwardedForLines = liveLines
      .split("\n")
      .filter((line) => line.includes("X-Forwarded-For"));
    expect(forwardedForLines.length).toBeGreaterThan(0);
    for (const line of forwardedForLines) {
      expect(line).toContain("$proxy_add_x_forwarded_for");
      expect(line).not.toContain("$http_x_forwarded_for");
    }
  });

  it("forwards X-Forwarded-Proto so the backend can tell whether the original request was HTTPS", () => {
    expect(liveLines).toContain("X-Forwarded-Proto $scheme");
  });

  it("sets bounded proxy timeouts, so a hung backend cannot hang a client request indefinitely", () => {
    expect(liveLines).toMatch(/proxy_connect_timeout\s+\d+s;/);
    expect(liveLines).toMatch(/proxy_read_timeout\s+\d+s;/);
  });

  it("does not reference a certificate/key file in the live (non-commented) config", () => {
    // The default shipped file must start successfully with zero
    // operator setup - referencing ssl_certificate paths that don't exist
    // by default would crash nginx on startup. The HTTPS instructions
    // live only in the comment block.
    expect(liveLines).not.toMatch(/ssl_certificate/);
  });

  it("does not hardcode a production domain in the live server_name", () => {
    const serverNameLines = liveLines.split("\n").filter((line) => line.trim().startsWith("server_name"));
    expect(serverNameLines.length).toBeGreaterThan(0);
    for (const line of serverNameLines) {
      expect(line).toContain("_");
      expect(line).not.toMatch(/[a-z0-9-]+\.[a-z]{2,}/i);
    }
  });

  it("CSP for the frontend has no wildcard script-src/connect-src and no unsafe-eval", () => {
    const cspMatch = /Content-Security-Policy\s+"([^"]+)"/.exec(liveLines);
    expect(cspMatch).not.toBeNull();
    const csp = cspMatch![1];
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toMatch(/script-src[^;]*'self'/);
    expect(csp).not.toMatch(/script-src[^;]*\*/);
    expect(csp).not.toMatch(/connect-src[^;]*\*/);
  });

  it("still preserves the SPA fallback and static asset caching behavior from before this phase", () => {
    expect(liveLines).toContain("try_files $uri $uri/ /index.html;");
    expect(liveLines).toMatch(/location\s+~\*\s+\\\.\(js\|css\|png\|jpg\|jpeg\|gif\|ico\|svg\)\$/);
  });
});

describe("docker-compose.prod.yml (Phase 27)", () => {
  const compose = fs.readFileSync(path.resolve(__dirname, "../../docker-compose.prod.yml"), "utf-8");

  function serviceBlock(compose: string, serviceName: string): string {
    // Crude but sufficient YAML slicing: from "  <name>:" up to the next
    // line at the same (two-space) indentation, or end of file.
    const lines = compose.split("\n");
    const startIndex = lines.findIndex((line) => line.match(new RegExp(`^  ${serviceName}:\\s*$`)));
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const rest = lines.slice(startIndex + 1);
    const endOffset = rest.findIndex((line) => /^ {2}\S/.test(line));
    const blockLines = endOffset === -1 ? rest : rest.slice(0, endOffset);
    return blockLines.join("\n");
  }

  it("does not publish a host port for the backend service", () => {
    const backendBlock = serviceBlock(compose, "backend");
    expect(backendBlock).not.toMatch(/^\s*ports:/m);
  });

  it("publishes a host port for the frontend (nginx) service - the intended single public entry point", () => {
    const frontendBlock = serviceBlock(compose, "frontend");
    expect(frontendBlock).toMatch(/^\s*ports:/m);
  });

  it("gives the backend a healthcheck that frontend's startup order depends on", () => {
    const backendBlock = serviceBlock(compose, "backend");
    expect(backendBlock).toMatch(/healthcheck:/);
    expect(backendBlock).toMatch(/\/health/);

    const frontendBlock = serviceBlock(compose, "frontend");
    expect(frontendBlock).toMatch(/condition:\s*service_healthy/);
  });

  it("defaults TRUST_PROXY to 1, matching this file's own single-nginx-hop topology", () => {
    expect(compose).toMatch(/TRUST_PROXY:\s*\$\{TRUST_PROXY:-1\}/);
  });

  it("defaults VITE_API_URL to the same-origin /api path, not a hardcoded domain", () => {
    expect(compose).toMatch(/VITE_API_URL:\s*\$\{VITE_API_URL:-\/api\}/);
  });
});
