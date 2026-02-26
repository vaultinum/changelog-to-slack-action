const axios = require("axios");

function plural(word, count) {
    return count > 1 ? `${word}s` : word;
}

const JIRA_TICKET_PATTERN = /(?<jiraTicket>[A-Z]{2,}-\d+)/g;

function formatJiraTicket(message, jiraHost) {
    if (!jiraHost) {
        return message;
    }

    const jiraTicketMatch = JIRA_TICKET_PATTERN.exec(message);
    if (jiraTicketMatch) {
        const jiraTicket = jiraTicketMatch.groups.jiraTicket;
        return message.replace(jiraTicket, `<${jiraHost}/browse/${jiraTicket}|${jiraTicket}>`);
    }
    return message;
}

function truncateItemsList(items, jiraHost, maxLength = 1200) {
    const formattedItems = items.map(({ component, message, changeUrl }) => {
        const formattedMessage = formatJiraTicket(message, jiraHost);
        return `- *${component}:* ${formattedMessage} (<${changeUrl}|view>)`;
    });

    let currentLength = 0;
    const truncatedItems = [];
    let truncated = false;

    for (const item of formattedItems) {
        if (currentLength + item.length + 1 > maxLength) {
            // +1 for newline
            truncated = true;
            break;
        }
        truncatedItems.push(item);
        currentLength += item.length + 1;
    }

    const result = truncatedItems.join("\n");
    if (truncated) {
        const remaining = items.length - truncatedItems.length;
        return result + `\n... and ${remaining} more item${remaining > 1 ? "s" : ""}`;
    }

    return result;
}

function checkMessageSize(message, maxSize = 2800) {
    const messageText = JSON.stringify(message);
    if (messageText.length > maxSize) {
        // If message is still too long, remove some blocks starting from the end
        const blocks = [...message.blocks];

        while (blocks.length > 3 && JSON.stringify({ blocks }).length > maxSize) {
            // Keep header, divider, and main announcement, remove from the end
            blocks.pop();
        }

        // Add truncation notice
        blocks.push({
            type: "context",
            elements: [
                {
                    type: "mrkdwn",
                    text: ":warning: _Message truncated due to length limit_"
                }
            ]
        });

        return { blocks };
    }

    return message;
}

function buildSlackMessage(appName, environment, releases, shortStats, jiraHost, isRollback = false) {
    const bugfixes = releases.reduce((acc, release) => [...acc, ...release.bugfixes], []).sort((a, b) => a.component.localeCompare(b.component));
    const features = releases.reduce((acc, release) => [...acc, ...release.features], []).sort((a, b) => a.component.localeCompare(b.component));

    const sortedReleases = releases.toSorted((a, b) => a.releaseDate - b.releaseDate);

    const oldestRelease = sortedReleases[0];
    const latestRelease = sortedReleases[sortedReleases.length - 1];
    const releaseDate = latestRelease.releaseDate.toISOString().split("T")[0];

    const message = {
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: `${environment ? `${environment} | ` : ""}${appName}`,
                    emoji: true
                }
            },
            {
                type: "divider"
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: isRollback
                        ? `:warning: *Rollback! ${plural("Version", releases.length)} rolled back:*`
                        : `:mega: *New release! ${plural("Version", releases.length)} included:*`
                }
            },
            {
                type: "context",
                elements: [
                    {
                        text:
                            sortedReleases.length === 1
                                ? `*${latestRelease.version}*  |  ${releaseDate} (<${latestRelease.releaseUrl}|View>)`
                                : `${oldestRelease.version} ➜ ${latestRelease.version} | ${releaseDate} (<${latestRelease.releaseUrl}|View>)`,
                        type: "mrkdwn"
                    }
                ]
            }
        ]
    };

    if (isRollback) {
        message.blocks.push({
            type: "context",
            elements: [
                {
                    type: "mrkdwn",
                    text: ":rewind: _These changes have been rolled back and are no longer active_"
                }
            ]
        });
    }

    if (features.length > 0) {
        message.blocks.push({
            type: "divider"
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*${isRollback ? ":x: Rolled back" : ":sparkles:"} ${features.length} ${plural("Feature", features.length)}*`
            }
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: truncateItemsList(features, jiraHost)
            }
        });
    }

    if (bugfixes.length > 0) {
        message.blocks.push({
            type: "divider"
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*${isRollback ? ":x: Rolled back" : ":bug:"} ${bugfixes.length} ${bugfixes.length > 1 ? "Bugfixes" : "Bugfix"}*`
            }
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: truncateItemsList(bugfixes, jiraHost)
            }
        });
    }

    if (features.length === 0 && bugfixes.length === 0) {
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*No changes found :man-shrugging:*`
            }
        });
    }

    if (shortStats) {
        const { fileChanged, insertions, deletions } = shortStats;
        message.blocks.push({
            type: "divider"
        });
        message.blocks.push({
            type: "context",
            elements: [
                {
                    text: `:page_facing_up: ${fileChanged} ${plural("file", fileChanged)} changed | :heavy_plus_sign: ${insertions} :heavy_minus_sign: ${deletions} ${plural("line", parseInt(insertions) + parseInt(deletions))}`,
                    type: "mrkdwn"
                }
            ]
        });
    }

    return checkMessageSize(message);
}

function addJiraTicketInfo(changeItem, message) {
    const jiraTicketMatch = JIRA_TICKET_PATTERN.exec(message);
    if (jiraTicketMatch) {
        changeItem.jiraTicket = jiraTicketMatch.groups.jiraTicket;
    }
    return changeItem;
}

async function postReleaseToSlack(hookURL, appName, environment, releases, shortStats, jiraHost, isRollback = false) {
    const message = buildSlackMessage(appName, environment, releases, shortStats, jiraHost, isRollback);

    try {
        await axios({
            method: "post",
            url: hookURL,
            data: message
        });
    } catch (error) {
        throw new Error(`Failed to post to Slack: ${error.message}`);
    }
}

module.exports = {
    plural,
    JIRA_TICKET_PATTERN,
    formatJiraTicket,
    truncateItemsList,
    checkMessageSize,
    buildSlackMessage,
    postReleaseToSlack,
    addJiraTicketInfo
};
