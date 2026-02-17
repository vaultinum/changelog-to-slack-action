const core = require("@actions/core");
const { execSync } = require("child_process");
const { postReleaseToSlack, addJiraTicketInfo } = require("./slack.utils");

function getShortStats(fromTag, toTag) {
    const output = execSync(`git diff --shortstat ${fromTag}...${toTag}`).toString();
    console.log(`ShortStat: ${output}`);
    const shortStatPattern = /(?<fileChanged>\d+) files? changed, (?<insertions>\d+) insertions\(\+\), (?<deletions>\d+)/;
    const statMatch = shortStatPattern.exec(output);
    if (statMatch) {
        return {
            fileChanged: statMatch.groups.fileChanged,
            insertions: statMatch.groups.insertions,
            deletions: statMatch.groups.deletions
        };
    }
    return null;
}

function getChangelogDiff(filePath) {
    const output = execSync(`git diff HEAD~1 HEAD -- ${filePath}`).toString();
    const newLines = output
        .split("\n")
        .filter(line => line.startsWith("+"))
        .map(line => line.substring(1));
    return newLines.join("\n");
}

function parseChangelogReleases(changeLogContent) {
    const lines = changeLogContent.split("\n");
    // All releases data
    const releases = [];
    // Current release data
    let features = [];
    let bugfixes = [];
    let version = null;
    let releaseUrl = null;
    let releaseDate = null;
    let changeType = null;

    const flushRelease = () => {
        if (!version) {
            return;
        }
        // Extract version tags from url
        const [previousVersionTag, versionTag] = releaseUrl.split("/").pop().split("...");
        releases.push({
            previousVersionTag,
            versionTag,
            version,
            releaseUrl,
            releaseDate,
            features,
            bugfixes
        });
        features = [];
        bugfixes = [];
        version = null;
        releaseUrl = null;
        releaseDate = null;
        changeType = null;
    };

    for (const line of lines) {
        const releaseStartPattern = /###? \[(?<version>\d+\.\d+\.\d+)\]\((?<releaseUrl>https:\/\/[\w\./-]+)\) \((?<releaseDate>\d{4}-\d{2}-\d{2})\)/;
        const releaseStartMatch = releaseStartPattern.exec(line);
        if (releaseStartMatch) {
            flushRelease();
            version = releaseStartMatch.groups.version;
            releaseUrl = releaseStartMatch.groups.releaseUrl;
            releaseDate = releaseStartMatch.groups.releaseDate;
        } else if (line.startsWith("### Features")) {
            changeType = "features";
        } else if (line.startsWith("### Bug Fixes")) {
            changeType = "bugfixes";
        } else if (line.startsWith("* ")) {
            const changePattern = /\* (\**)?(?<component>[\w-]+)?(:\*\* )?(?<message>.+)\(\[\w{7}\]\((?<changeUrl>https:\/\/[\w\./-]+)\)\)/;
            const changeMatch = changePattern.exec(line);
            let changeList = changeType === "features" ? features : changeType === "bugfixes" ? bugfixes : null;
            // Avoid adding the same change info twice (can happen when change is done on multiple commits)
            if (
                changeList &&
                !changeList.some(feature => feature.component === changeMatch.groups.component && feature.message === changeMatch.groups.message)
            ) {
                let change = { ...changeMatch.groups };
                change = addJiraTicketInfo(change, changeMatch.groups.message);
                changeList.push(change);
            }
        }
    }
    flushRelease();
    return releases;
}

async function handleFileSource() {
    const SLACK_WEBHOOK_URL = core.getInput("slack-webhook");
    const APP_NAME = core.getInput("app-name") || "Unknown application";
    const CHANGELOG_FILE = core.getInput("changelog-file") || "CHANGELOG.md";
    const ENVIRONMENT = core.getInput("environment");
    const JIRA_HOST = core.getInput("jira-host") || "";

    try {
        console.log(`Fetching changes for file '${CHANGELOG_FILE}'...`);
        const changelogAddedContent = getChangelogDiff(CHANGELOG_FILE);
        console.log("Parsing latest release...");
        const releases = parseChangelogReleases(changelogAddedContent);
        if (releases.length) {
            const fromTag = releases[releases.length - 1].previousVersionTag;
            const toTag = releases[0].versionTag;
            console.log(`Fetching git shortstats for tags: fromTag=${fromTag}, toTag=${toTag}...`);
            const shortStats = getShortStats(fromTag, toTag);
            console.log("Posting to Slack latest release info...");
            await postReleaseToSlack(SLACK_WEBHOOK_URL, APP_NAME, ENVIRONMENT, releases, shortStats, JIRA_HOST);
        } else {
            core.setFailed("No release found in changelog file");
        }
    } catch (error) {
        core.setFailed(error.message);
    }
}

module.exports = { handleFileSource };
