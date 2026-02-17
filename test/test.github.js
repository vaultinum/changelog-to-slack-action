// Mock @actions/core module
require.cache[require.resolve("@actions/core")] = {
    exports: mockCore,
    loaded: true,
    id: require.resolve("@actions/core")
};

async function testGitHubSource() {
    console.log("🧪 Testing GitHub release source...\n");
    const { handleGitHubSource } = require("../src/github.handler");
    await handleGitHubSource();
    console.log("✅ GitHub source test completed successfully!");
}

if (require.main === module) {
    testGitHubSource();
}
