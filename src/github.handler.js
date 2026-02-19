const core = require("@actions/core");
const axios = require("axios");
const { postReleaseToSlack, addJiraTicketInfo } = require("./slack.utils");

async function getReleasesBetweenVersions() {
    const repo = process.env.GITHUB_REPOSITORY;
    const githubToken = core.getInput("github-token");
    const newTag = core.getInput("new-version");
    const previousTag = core.getInput("previous-version");

    if (!githubToken) {
        throw new Error("github-token input is required when using github changelog source");
    }

    if (!repo) {
        throw new Error("GITHUB_REPOSITORY environment variable not found");
    }

    if (!newTag) {
        throw new Error("new-tag input is required");
    }

    if (!previousTag) {
        throw new Error("previous-tag input is required");
    }

    const newVersion = newTag.startsWith("v") ? newTag : `v${newTag}`;
    const previousVersion = previousTag.startsWith("v") ? previousTag : `v${previousTag}`;

    try {
        let allReleases = [];
        let page = 1;
        let hasNextPage = true;
        let newVersionIndex = -1;
        let previousVersionIndex = -1;

        while (hasNextPage && (newVersionIndex === -1 || previousVersionIndex === -1)) {
            const response = await axios({
                method: "get",
                url: `https://api.github.com/repos/${repo}/releases`,
                headers: { Authorization: `token ${githubToken}`, Accept: "application/vnd.github.v3+json" },
                params: { page: page, per_page: 100 }
            });

            const releases = response.data;

            if (releases.length === 0) {
                hasNextPage = false;
                break;
            }

            const currentStartIndex = allReleases.length;
            allReleases = allReleases.concat(releases);

            if (newVersionIndex === -1) {
                const localNewIndex = releases.findIndex(release => release.tag_name === newVersion);
                if (localNewIndex !== -1) {
                    newVersionIndex = currentStartIndex + localNewIndex;
                }
            }

            if (previousVersionIndex === -1) {
                const localPreviousIndex = releases.findIndex(release => release.tag_name === previousVersion);
                if (localPreviousIndex !== -1) {
                    previousVersionIndex = currentStartIndex + localPreviousIndex;
                }
            }

            hasNextPage = releases.length === 100;
            page++;
        }

        if (newVersionIndex === -1) {
            throw new Error(`Release with tag ${newVersion} not found`);
        }

        if (previousVersionIndex === -1) {
            throw new Error(`Release with tag ${previousVersion} not found`);
        }

        // Detect rollback scenario
        const isRollback = newVersionIndex > previousVersionIndex;
        let releasesBetween;

        if (isRollback) {
            releasesBetween = allReleases.slice(previousVersionIndex + 1, newVersionIndex + 1);
            console.log(`Detected rollback: rolling back ${releasesBetween.length} release(s) from ${newVersion} to ${previousVersion}`);
        } else {
            releasesBetween = allReleases.slice(newVersionIndex, previousVersionIndex);
            console.log(`Found ${releasesBetween.length} release(s) between ${previousVersion} and ${newVersion}`);
        }

        if (releasesBetween.length === 0) {
            throw new Error(`No releases found between ${previousVersion} and ${newVersion}`);
        }

        return { releases: releasesBetween, isRollback };
    } catch (error) {
        if (error.response && error.response.status === 404) {
            throw new Error("Repository not found or no releases available");
        }
        throw error;
    }
}

async function parseGitHubReleases(releases) {
    const parsedReleases = [];

    for (const release of releases) {
        const version = release.tag_name;
        const releaseDate = new Date(release.published_at).toISOString().split("T")[0];
        const releaseUrl = release.html_url;
        const body = release.body || "";

        const features = [];
        const bugfixes = [];

        const lines = body.split("\n");
        let currentSection = null;

        for (const line of lines) {
            const trimmedLine = line.trim();

            if (!trimmedLine.startsWith("-") && !trimmedLine.startsWith("*")) {
                continue;
            }

            const itemText = trimmedLine.substring(1).trim();

            if (itemText.includes("Full Changelog")) {
                continue;
            }

            if (trimmedLine.toLowerCase().startsWith("feat")) {
                currentSection = "features";
            } else if (trimmedLine.toLowerCase().startsWith("fix")) {
                currentSection = "bugfixes";
            }

            const changePattern = /(feat|fix)(\((?<component>[\w-]+)\))?: (?<message>.+?) by @(?<author>.*) in (?<changeUrl>https:\/\/[\w\.\/-]+)/;
            const parsedLine = changePattern.exec(itemText);

            let changeItem = {
                component: parsedLine?.groups?.component || "general",
                message: parsedLine?.groups?.message || itemText,
                changeUrl: parsedLine?.groups?.changeUrl || releaseUrl,
                author: parsedLine?.groups?.author || "unknown"
            };

            changeItem = addJiraTicketInfo(changeItem, itemText);

            if (currentSection === "features") {
                features.push(changeItem);
            } else if (currentSection === "bugfixes") {
                bugfixes.push(changeItem);
            } else {
                if (itemText.toLowerCase().includes("fix") || itemText.toLowerCase().includes("bug")) {
                    bugfixes.push(changeItem);
                } else {
                    features.push(changeItem);
                }
            }
        }

        parsedReleases.push({
            versionTag: version,
            version,
            releaseUrl,
            releaseDate,
            features,
            bugfixes
        });
    }

    return parsedReleases;
}

async function handleGitHubSource() {
    const SLACK_WEBHOOK_URL = core.getInput("slack-webhook");
    const APP_NAME = core.getInput("app-name") || "Unknown application";
    const ENVIRONMENT = core.getInput("environment");
    const JIRA_HOST = core.getInput("jira-host") || "";

    try {
        const { releases, isRollback } = await getReleasesBetweenVersions();
        console.log(`Found ${releases.length} release(s): ${releases.map(r => r.tag_name).join(", ")}`);

        console.log("Parsing GitHub releases...");
        const parsedReleases = await parseGitHubReleases(releases);

        console.log("Posting to Slack release info...");
        await postReleaseToSlack(SLACK_WEBHOOK_URL, APP_NAME, ENVIRONMENT, parsedReleases, null, JIRA_HOST, isRollback);
    } catch (error) {
        core.setFailed(error.message);
    }
}

module.exports = { handleGitHubSource };
