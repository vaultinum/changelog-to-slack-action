async function runTest(scenario) {
    const MockCore = require("./mock-core");
    const mockCore = new MockCore({
        "slack-webhook": process.env.SLACK_WEBHOOK_URL,
        "app-name": process.env.APP_NAME || "Test Application",
        "changelog-file": process.env.CHANGELOG_FILE || "CHANGELOG.md",
        environment: process.env.ENVIRONMENT || "staging",
        "jira-host": process.env.JIRA_HOST,
        "changelog-source": scenario,
        "github-token": process.env.GITHUB_TOKEN,
        "github-repository": process.env.GITHUB_REPOSITORY,
        "new-version": process.env.NEW_VERSION,
        "previous-version": process.env.PREVIOUS_VERSION
    });

    // Mock @actions/core module
    require.cache[require.resolve("@actions/core")] = {
        exports: mockCore,
        loaded: true,
        id: require.resolve("@actions/core")
    };

    try {
        const { main } = require("../src/index");
        await main();
        console.log(`\n✅ ${scenario} test completed successfully!`);
    } catch (error) {
        console.error(`\n❌ ${scenario} test failed:`, error.message);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const scenario = args[0];
    await runTest(scenario);
}

if (require.main === module) {
    main().catch(console.error);
}
