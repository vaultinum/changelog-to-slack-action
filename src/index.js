const core = require("@actions/core");
const { execSync } = require("child_process");
const { readFileSync } = require("fs");
const axios = require("axios");

const SLACK_WEBHOOK_URL = core.getInput("slack-webhook");
const APP_NAME = core.getInput("app-name");
const CHANGELOG_FILE = core.getInput("changelog-file") || "CHANGELOG.md";
const ENVIRONMENT = core.getInput("environment");

function getShortStats(fromTag, toTag) {
    const output = execSync(`git diff --shortstat ${fromTag}...${toTag}`).toString();
    console.log(`ShortStat: ${output}`);
    const shortStatPattern = /(?<fileChanged>\d+) files? changed, (?<insertions>\d+) insertions\(\+\), (?<deletions>\d+)/;
    const statMatch = shortStatPattern.exec(output);
    if (statMatch) {
        return {
            fileChanged: statMatch.groups.fileChanged,
            insertions: statMatch.groups.insertions,
            deletions: statMatch.groups.deletions,
        };
    }
    return null;
}

function parseLatestRelease(changelogFileContent) {
    const releaseStart = /###? \[(?<version>\d+\.\d+\.\d+)\]\((?<releaseUrl>https:\/\/[\w\./-]+)\) \((?<releaseDate>\d{4}-\d{2}-\d{2})\)/g;
    const releaseStartMatch = releaseStart.exec(changelogFileContent);
    if (releaseStartMatch) {
        const { version, releaseUrl, releaseDate } = releaseStartMatch.groups;
        const releaseEnd = /###? \[/g;
        const releaseEndMatch = releaseEnd.exec(changelogFileContent.substring(releaseStartMatch.index + releaseStartMatch[0].length));
        const releaseContent = changelogFileContent.substring(
            releaseStartMatch.index + releaseStartMatch[0].length,
            releaseStartMatch.index + releaseStartMatch[0].length + releaseEndMatch.index
        );
        const releaseLines = releaseContent.split("\n");
        const features = [];
        const bugfixes = [];
        let changeType = null;
        for (const line of releaseLines) {
            if (line.startsWith("### Features")) {
                changeType = "features";
            } else if (line.startsWith("### Bug Fixes")) {
                changeType = "bugfixes";
            } else if (line.startsWith("* ")) {
                const changePattern = /\* (\**)?(?<component>[\w-]+)?(:\*\* )?(?<message>[^(]+)\(\[\w{7}\]\((?<changeUrl>https:\/\/[\w\./-]+)\)\)/g;
                const changeMatch = changePattern.exec(line);
                let changeList = changeType === "features" ? features : bugfixes;
                // Avoid adding the same change info twice (can happen when change is done on multiple commits)
                if (!changeList.some((feature) => feature.component === changeMatch.groups.component && feature.message === changeMatch.groups.message)) {
                    changeList.push(changeMatch.groups);
                }
            }
        }
        // Extract version tags from url
        const [previousVersionTag, versionTag] = releaseUrl.split("/").pop().split("...");

        return {
            previousVersionTag,
            versionTag,
            version,
            releaseUrl,
            releaseDate,
            features,
            bugfixes,
        };
    }
}

function postReleaseToSlack(hookURL, appName, environment, releaseData, shortStats) {
    const { version, releaseUrl, releaseDate, features, bugfixes } = releaseData;
    const isMajorVersion = version.split(".")[2] !== "0";
    const plural = (word, count) => (count > 1 ? `${word}s` : word);

    const message = {
        blocks: [
            {
                type: "divider",
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `:mega: *New release for: _${appName}_!*`,
                },
                accessory: {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "View on Github",
                    },
                    url: releaseUrl,
                },
            },
            {
                type: "context",
                elements: [
                    {
                        text: `${environment ? `*${environment}* | ` : ""}*${isMajorVersion ? "Major" : "Minor"} version ${version}*  |  ${releaseDate}`,
                        type: "mrkdwn",
                    },
                ],
            },
        ],
    };
    if (features.length > 0) {
        message.blocks.push({
            type: "divider",
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*:package: ${features.length} ${plural("Feature", features.length)}*`,
            },
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: features
                    .map(({ component, message, changeUrl }) => `:black_small_square: *${component ?? "unknown"}:* ${message} (<${changeUrl}|View change>)`)
                    .join("\n"),
            },
        });
    }
    if (bugfixes.length > 0) {
        message.blocks.push({
            type: "divider",
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*:bug: ${bugfixes.length} ${plural("Bugfixe", bugfixes.length)}*`,
            },
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: bugfixes
                    .map(({ component, message, changeUrl }) => `:black_small_square: *${component}:* ${message} (<${changeUrl}|View change>)`)
                    .join("\n"),
            },
        });
    }
    if (features.length === 0 && bugfixes.length === 0) {
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*No changes found :man-shrugging:*`,
            },
        });
    }

    if (shortStats) {
        const { fileChanged, insertions, deletions } = shortStats;
        message.blocks.push({
            type: "divider",
        });
        message.blocks.push({
            type: "context",
            elements: [
                {
                    text: `:page_facing_up: ${fileChanged} ${plural("file", fileChanged)} changed | :pencil2: ${insertions} ${plural(
                        "line",
                        insertions
                    )} added | :wastebasket: ${deletions} ${plural("lines", deletions)} removed`,
                    type: "mrkdwn",
                },
            ],
        });
    }
    (async () => {
        axios({
            method: "post",
            url: hookURL,
            data: message,
        });
    })();
}

try {
    console.log(`Reading file '${CHANGELOG_FILE}'...`);
    const changelogFileContent = readFileSync(CHANGELOG_FILE).toString();
    console.log("Parsing latest release...");
    const latestRelease = parseLatestRelease(changelogFileContent);
    if (latestRelease) {
        console.log("Fetching git short stats...");
        const shortStats = getShortStats(latestRelease.previousVersionTag, latestRelease.versionTag);
        console.log("Posting to Slack latest release info...");
        postReleaseToSlack(SLACK_WEBHOOK_URL, APP_NAME, ENVIRONMENT, latestRelease, shortStats);
    } else {
        core.setFailed("No release found in changelog file");
    }
} catch (error) {
    core.setFailed(error.message);
}
