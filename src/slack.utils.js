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

function buildSlackMessage(appName, environment, releases, shortStats, jiraHost) {
    const bugfixes = releases.reduce((acc, release) => [...acc, ...release.bugfixes], []).sort((a, b) => a.component.localeCompare(b.component));
    const features = releases.reduce((acc, release) => [...acc, ...release.features], []).sort((a, b) => a.component.localeCompare(b.component));

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
                    text: `:mega: *New release! ${plural("Version", releases.length)} included:*`
                }
            },
            ...releases.map(({ releaseUrl, version, releaseDate }) => ({
                type: "context",
                elements: [
                    {
                        text: `*${version}*  |  ${releaseDate} (<${releaseUrl}|View>)`,
                        type: "mrkdwn"
                    }
                ]
            }))
        ]
    };

    if (features.length > 0) {
        message.blocks.push({
            type: "divider"
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `*:sparkles: ${features.length} ${plural("Feature", features.length)}*`
            }
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: features
                    .map(({ component, message, changeUrl, author }) => {
                        const formattedMessage = formatJiraTicket(message, jiraHost);
                        return `- *${component}:* ${formattedMessage} ${author ? `(@${author})` : ""} (<${changeUrl}|View>)`;
                    })
                    .join("\n")
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
                text: `*:bug: ${bugfixes.length} ${plural("Bugfixe", bugfixes.length)}*`
            }
        });
        message.blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: bugfixes
                    .map(({ component, message, changeUrl, author }) => {
                        const formattedMessage = formatJiraTicket(message, jiraHost);
                        return `- *${component}:* ${formattedMessage} ${author ? `(@${author})` : ""} (<${changeUrl}|View>)`;
                    })
                    .join("\n")
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

    return message;
}

function addJiraTicketInfo(changeItem, message) {
    const jiraTicketMatch = JIRA_TICKET_PATTERN.exec(message);
    if (jiraTicketMatch) {
        changeItem.jiraTicket = jiraTicketMatch.groups.jiraTicket;
    }
    return changeItem;
}

async function postReleaseToSlack(hookURL, appName, environment, releases, shortStats, jiraHost) {
    const message = buildSlackMessage(appName, environment, releases, shortStats, jiraHost);

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
    buildSlackMessage,
    postReleaseToSlack,
    addJiraTicketInfo
};
