const core = require("@actions/core");
const { execSync } = require("child_process");
const axios = require("axios");
const fs = require("fs");

const SLACK_WEBHOOK_URL = core.getInput("slack-webhook");
const APP_NAME = core.getInput("app-name") || "Unknown application";
const CHANGELOG_FILE = core.getInput("changelog-file") || "CHANGELOG.md";
const ENVIRONMENT = core.getInput("environment");
const JIRA_HOST = core.getInput("jira-host") || "";
const DEPLOYED_VERSION = core.getInput("deployed-version");

function getShortStats(fromTag, toTag) {
    try {
        const output = execSync(`git diff --shortstat ${fromTag}...${toTag}`).toString();
        const shortStatPattern = /(?<fileChanged>\d+) files? changed, (?<insertions>\d+) insertions\(\+\), (?<deletions>\d+)/;
        const statMatch = shortStatPattern.exec(output);
        if (statMatch) {
            return {
                fileChanged: parseInt(statMatch.groups.fileChanged),
                insertions: parseInt(statMatch.groups.insertions),
                deletions: parseInt(statMatch.groups.deletions)
            };
        }
    } catch (err) {
        console.warn("Could not calculate git shortstats:", err.message);
    }
    return null;
}

function parseChangelogReleases(changeLogContent) {
    const lines = changeLogContent.split("\n");
    const releases = [];
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
        releases.push({ previousVersionTag, versionTag, version, releaseUrl, releaseDate, features, bugfixes });
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
            if (changeList && changeMatch) {
                const JIRA_TICKET_PATTERN = /(?<jiraTicket>[A-Z]{2,}-\d+)/g;
                const jiraTicketMatch = JIRA_TICKET_PATTERN.exec(changeMatch.groups.message);
                const change = { ...changeMatch.groups };
                if (jiraTicketMatch) {
                    change.jiraTicket = jiraTicketMatch.groups.jiraTicket;
                }
                if (!changeList.some(f => f.component === change.component && f.message === change.message)) {
                    changeList.push(change);
                }
            }
        }
    }
    flushRelease();
    return releases;
}

function postReleaseToSlack(hookURL, appName, environment, releases, shortStats) {
    const isMajorVersion = version => version.split(".")[2] !== "0";
    const plural = (word, count) => (count > 1 ? `${word}s` : word);

    const bugfixes = releases.reduce((acc, release) => [...acc, ...release.bugfixes], []).sort((a, b) => a.component.localeCompare(b.component));
    const features = releases.reduce((acc, release) => [...acc, ...release.features], []).sort((a, b) => a.component.localeCompare(b.component));

    const message = {
        blocks: [
            { type: "header", text: { type: "plain_text", text: `${environment ? `${environment} | ` : ""}${appName}`, emoji: true } },
            { type: "divider" },
            { type: "section", text: { type: "mrkdwn", text: `:mega: *New release! ${plural("Version", releases.length)} included:*` } },
            ...releases.map(({ releaseUrl, version, releaseDate }) => ({
                type: "context",
                elements: [
                    {
                        text: `*${isMajorVersion(version) ? "Major" : "Minor"} version ${version}*  |  ${releaseDate} (<${releaseUrl}|view changes>)`,
                        type: "mrkdwn"
                    }
                ]
            }))
        ]
    };

    if (features.length) {
        message.blocks.push({ type: "divider" });
        message.blocks.push({ type: "section", text: { type: "mrkdwn", text: `*:sparkles: ${features.length} ${plural("Feature", features.length)}*` } });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: features
                    .map(({ component, message, changeUrl, jiraTicket }) => {
                        const formattedMessage = jiraTicket ? message.replace(jiraTicket, `<${JIRA_HOST}/browse/${jiraTicket}|${jiraTicket}>`) : message;
                        return `- *${component}:* ${formattedMessage} (<${changeUrl}|view changes>)`;
                    })
                    .join("\n")
            }
        });
    }

    if (bugfixes.length) {
        message.blocks.push({ type: "divider" });
        message.blocks.push({ type: "section", text: { type: "mrkdwn", text: `*:bug: ${bugfixes.length} ${plural("Bugfixe", bugfixes.length)}*` } });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: bugfixes
                    .map(({ component, message, changeUrl, jiraTicket }) => {
                        const formattedMessage = jiraTicket ? message.replace(jiraTicket, `<${JIRA_HOST}/browse/${jiraTicket}|${jiraTicket}>`) : message;
                        return `- *${component}:* ${formattedMessage} (<${changeUrl}|View change>)`;
                    })
                    .join("\n")
            }
        });
    }

    if (!features.length && !bugfixes.length) {
        message.blocks.push({ type: "section", text: { type: "mrkdwn", text: `*No changes found :man-shrugging:*` } });
    }

    if (shortStats) {
        const { fileChanged, insertions, deletions } = shortStats;
        message.blocks.push({ type: "divider" });
        message.blocks.push({
            type: "context",
            elements: [
                {
                    text: `:page_facing_up: ${fileChanged} ${plural(
                        "file",
                        fileChanged
                    )} changed | :heavy_plus_sign: ${insertions} :heavy_minus_sign: ${deletions} ${plural("line", insertions + deletions)}`,
                    type: "mrkdwn"
                }
            ]
        });
    }
    (async () => {
        try {
            await axios.post(hookURL, message);
        } catch (err) {
            core.setFailed(`Failed to post to Slack: ${err.message}`);
        }
    })();
}

try {
    console.log(`Fetching changelog content from '${CHANGELOG_FILE}'...`);
    const changelogContent = fs.readFileSync(CHANGELOG_FILE, "utf8");
    const releases = parseChangelogReleases(changelogContent).filter(release => release.version === DEPLOYED_VERSION);

    if (!releases.length) {
        core.setFailed(`No release found in changelog for version ${DEPLOYED_VERSION}`);
    }

    const fromTag = releases[0].previousVersionTag;
    const toTag = releases[0].versionTag;
    const shortStats = getShortStats(fromTag, toTag);

    console.log(`Posting release version ${DEPLOYED_VERSION} to Slack...`);
    postReleaseToSlack(SLACK_WEBHOOK_URL, APP_NAME, ENVIRONMENT, releases, shortStats);
} catch (error) {
    core.setFailed(error.message);
}
