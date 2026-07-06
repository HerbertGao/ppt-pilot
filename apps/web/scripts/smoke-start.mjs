import { spawn } from "node:child_process";
import { createServer } from "node:net";

const port = process.env.PORT ?? "13100";
const host = "127.0.0.1";
const url = `http://${host}:${port}/`;
const timeoutMs = Number(process.env.WEB_SMOKE_TIMEOUT_MS ?? "30000");
const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : "pnpm";
const args = npmExecPath
  ? [npmExecPath, "exec", "next", "start", "--hostname", host, "--port", port]
  : ["exec", "next", "start", "--hostname", host, "--port", port];

async function assertPortFree() {
  await new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(error);
      }
    });

    server.once("listening", () => {
      server.close(resolve);
    });

    server.listen(Number(port), host);
  });
}

let output = "";
let childFailure;
let child;

function startServer() {
  child = spawn(command, args, {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  child.once("error", (error) => {
    childFailure = error;
  });

  child.once("exit", (code, signal) => {
    childFailure = new Error(`next start exited before smoke check passed: code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
}

function stopServer() {
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
}

async function fetchRootPage(remainingMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, remainingMs));

  let response;
  let body;

  try {
    response = await fetch(url, { signal: controller.signal });
    body = await response.text();
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Root page returned ${response.status}`);
  }

  if (!body.includes("PPTPilot")) {
    throw new Error("Root page did not include the PPTPilot marker");
  }
}

async function waitForRootPage() {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    if (childFailure) {
      throw childFailure;
    }

    try {
      await fetchRootPage(deadline - Date.now());
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError ?? new Error("Timed out waiting for Web shell");
}

try {
  await assertPortFree();
  startServer();
  await waitForRootPage();
  stopServer();
  console.log(`Web smoke-start passed: ${url}`);
} catch (error) {
  stopServer();
  console.error(`Web smoke-start failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error(output.slice(-4000));
  process.exitCode = 1;
}
