const core = require("@actions/core");
const { execSync } = require("child_process");
const axios = require("axios");

const SLACK_WEBHOOK_URL = core.getInput("slack-webhook");
const APP_NAME = core.getInput("app-name") || "Unknown application";
const CHANGELOG_FILE = core.getInput("changelog-file") || "CHANGELOG.md";
const ENVIRONMENT = core.getInput("environment");
const JIRA_HOST = core.getInput("jira-host") || "";

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
function getChangelogDiff(filePath) {
    const output = execSync(`git diff HEAD~2 HEAD -- ${filePath}`).toString();
    const newLines = output
        .split("\n")
        .filter((line) => line.startsWith("+"))
        .map((line) => line.substring(1));
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
            bugfixes,
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
                !changeList.some((feature) => feature.component === changeMatch.groups.component && feature.message === changeMatch.groups.message)
            ) {
                const JIRA_TIKCET_PATTERN = /(?<jiraTicket>[A-Z]{2,}-\d+)/g;
                const jiraTicketMatch = JIRA_TIKCET_PATTERN.exec(changeMatch.groups.message);
                const change = { ...changeMatch.groups };
                if (jiraTicketMatch) {
                    change.jiraTicket = jiraTicketMatch.groups.jiraTicket;
                }
                changeList.push(change);
            }
        }
    }
    flushRelease();
    return releases;
}

function postReleaseToSlack(hookURL, appName, environment, releases, shortStats) {
    const isMajorVersion = (version) => version.split(".")[2] !== "0";
    const plural = (word, count) => (count > 1 ? `${word}s` : word);

    const bugfixes = releases.reduce((acc, release) => [...acc, ...release.bugfixes], []).sort((a, b) => a.component.localeCompare(b.component));
    const features = releases.reduce((acc, release) => [...acc, ...release.features], []).sort((a, b) => a.component.localeCompare(b.component));

    const message = {
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: `${environment ? `*${environment}* | ` : ""}${appName}}`,
                    emoji: true,
                },
            },
            {
                type: "divider",
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `:mega: *New release! ${plural("Version", releases.length)} included:*`,
                },
            },
            ...releases.map(({ releaseUrl, version, releaseDate }) => ({
                type: "context",
                elements: [
                    {
                        text: `*${isMajorVersion(version) ? "Major" : "Minor"} version ${version}*  |  ${releaseDate} (<${releaseUrl}|view changes>)`,
                        type: "mrkdwn",
                    },
                ],
            })),
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
                    .map(({ component, message, changeUrl, jiraTicket }) => {
                        const formattedMessage = jiraTicket ? message.replace(jiraTicket, `<${JIRA_HOST}/browse/${jiraTicket}|${jiraTicket}>`) : message;
                        return `:black_small_square: *${component}:* ${formattedMessage} (<${changeUrl}|view changes>)`;
                    })
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
                text: `*:ladybug: ${bugfixes.length} ${plural("Bugfixe", bugfixes.length)}*`,
            },
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: bugfixes
                    .map(({ component, message, changeUrl, jiraTicket }) => {
                        const formattedMessage = jiraTicket ? message.replace(jiraTicket, `<${JIRA_HOST}/browse/${jiraTicket}|${jiraTicket}>`) : message;
                        return `:black_small_square: *${component}:* ${formattedMessage} (<${changeUrl}|View change>)`;
                    })
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
        postReleaseToSlack(SLACK_WEBHOOK_URL, APP_NAME, ENVIRONMENT, releases, shortStats);
    } else {
        core.setFailed("No release found in changelog file");
    }
} catch (error) {
    core.setFailed(error.message);
}
