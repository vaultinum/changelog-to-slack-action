const core = require("@actions/core");
const { handleFileSource } = require("./file.handler");
const { handleGitHubSource } = require("./github.handler");

async function main() {
    const changelogSource = core.getInput("changelog-source") || "file";

    console.log(`Using changelog source: ${changelogSource}`);

    switch (changelogSource.toLowerCase()) {
        case "file":
            await handleFileSource();
            break;
        case "github":
            await handleGitHubSource();
            break;
        default:
            core.setFailed(`Unsupported changelog source: ${changelogSource}. Supported values are: 'file', 'github'`);
    }
}

module.exports = { main };

if (require.main === module) {
    main().catch(error => {
        core.setFailed(error.message);
    });
}
