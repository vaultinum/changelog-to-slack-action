# CHANGELOG to Slack action

This action send the latest release information from a `CHANGELOG.md` file and post it to a Slack channel.

## Inputs

### `slack-webhook`

**Required** The slack webhook url target (this is how you setup the target slack channel).

### `app-name`

**Required** The name of the app displayed in the message.

### `changelog-file`

**Optional** The file path to the changelog file. Default: `CHANGELOG.md`
