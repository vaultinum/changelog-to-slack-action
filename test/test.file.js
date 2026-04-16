const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// Stub @actions/core before requiring file.handler
require.cache[require.resolve("@actions/core")] = {
    exports: { getInput: () => "", setFailed: () => {} },
    loaded: true,
    id: require.resolve("@actions/core")
};

const { readChangelogForVersionRange } = require("../src/file.handler");

const FIXTURE = `# Changelog

## [1.117.0](https://github.com/vaultinum/kys-backend/compare/v1.116.1...v1.117.0) (2026-04-13)


### Features

* **cve:** Add CVE section in PDF report ([d0b255e](https://github.com/vaultinum/kys-backend/commit/d0b255e6478cad4ac8175bbfabc955cf0b4817df))
* **filter:** Use globalFilter on report queries ([8f895fd](https://github.com/vaultinum/kys-backend/commit/8f895fd0380120c9c872c124143d425f463a2af7))


### Bug Fixes

* **pdf:** Fix missing scope on packages ([fa699c2](https://github.com/vaultinum/kys-backend/commit/fa699c245d5b15cab9232e223c147898a3d3992f))

### [1.116.1](https://github.com/vaultinum/kys-backend/compare/v1.116.0...v1.116.1) (2026-04-10)

## [1.116.0](https://github.com/vaultinum/kys-backend/compare/v1.115.2...v1.116.0) (2026-04-09)


### Features

* **sbom:** Add more CVE details on SBOM ([b7b44b0](https://github.com/vaultinum/kys-backend/commit/b7b44b0d7f501893284fa7fded9c63b10b8c2e38))
* **sbom:** Add strategies on PDF ([9adafcd](https://github.com/vaultinum/kys-backend/commit/9adafcd0b27cd4a1cba1f5400f21b71eaea05e20))

### [1.115.2](https://github.com/vaultinum/kys-backend/compare/v1.115.1...v1.115.2) (2026-04-07)


### Bug Fixes

* :bug: Use CVE name instead of id to query cve table ([#324](https://github.com/vaultinum/kys-backend/issues/324)) ([462dfaa](https://github.com/vaultinum/kys-backend/commit/462dfaac60078621831511b0878ff7c4c14fff49))

### [1.115.1](https://github.com/vaultinum/kys-backend/compare/v1.115.0...v1.115.1) (2026-04-03)
`;

describe("readChangelogForVersionRange", () => {
    let tempFile;

    beforeEach(() => {
        tempFile = path.join(os.tmpdir(), `changelog-test-${Date.now()}.md`);
        fs.writeFileSync(tempFile, FIXTURE, "utf-8");
    });

    afterEach(() => {
        fs.rmSync(tempFile, { force: true });
    });

    it("returns releases between previous and new", () => {
        const releases = readChangelogForVersionRange(tempFile, "1.117.0", "1.115.2");
        assert.deepEqual(
            releases.map(r => r.version),
            ["1.117.0", "1.116.1", "1.116.0"]
        );
    });

    it("handles v-prefixed versions", () => {
        const releases = readChangelogForVersionRange(tempFile, "v1.117.0", "v1.115.2");
        assert.deepEqual(
            releases.map(r => r.version),
            ["1.117.0", "1.116.1", "1.116.0"]
        );
    });

    it("returns all releases up to newVersion if no previous version found", () => {
        const releases = readChangelogForVersionRange(tempFile, "1.117.0", "0.0.0");
        assert.deepEqual(
            releases.map(r => r.version),
            ["1.117.0", "1.116.1", "1.116.0", "1.115.2", "1.115.1"]
        );
    });

    it("returns empty array when new and previous are the same", () => {
        const releases = readChangelogForVersionRange(tempFile, "1.116.0", "1.116.0");
        assert.equal(releases.length, 0);
    });
});
