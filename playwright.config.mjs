import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PW_PORT || 3100);

export default defineConfig({
    testDir: "tests/browser",
    timeout: 30_000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [["list"]],
    use: {
        baseURL: `http://localhost:${PORT}`,
        viewport: { width: 1440, height: 900 },
        screenshot: "only-on-failure",
        trace: "off"
    },
    webServer: {
        command: `node scripts/dev-server.mjs ${PORT}`,
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: true,
        timeout: 20_000
    }
});
