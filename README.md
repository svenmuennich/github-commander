# github-commander

[![Software License](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat-square)](LICENSE) [![Build Status](https://img.shields.io/travis/svenmuennich/github-commander.svg?style=flat-square)](https://travis-ci.org/svenmuennich/github-commander) [![npm](https://img.shields.io/npm/v/github-commander.svg?style=flat-square)](https://www.npmjs.com/package/github-commander)

A CLI tool for performing tedious GitHub settings with a keystroke.

## Install

### Via npm

`npm install -g github-commander`

### For development

Clone this repository and install it using `npm install && npm link`.

## Usage

### Generate a new OAuth token for the GitHub API

`github-commander generate-token`

For all other commands to work you need a GitHub OAuth token with the following [scopes](https://developer.github.com/apps/building-integrations/setting-up-and-registering-oauth-apps/about-scopes-for-oauth-apps/):

* `admin:org`
* `repo`

If you don't have such a token yet, you can use this command to generate a new one. After it is generated you are asked to optionally store it in a `.github-commander.token` file your home directory. If such a file is present when running one of the other commands, its token is loaded automatically.

### Unify issue labels across all repositories

`github-commander issue-labels <path_to_config_file>`

Reads the `issueLabels` section of your configuration and applies it to all repositories in the selected organization. This includes

* adding any new labels defined in the config,
* updating the colors of existing labels (matched by name, case insensitive) and
* deleting any labels that exist in a repository but not in the config.

### Unify team permissions across all repositories

`github-commander permissions <path_to_config_file>`

Reads the `teams` and `repositories` sections of your configuration and updates the team permissions of all repositories in the selected organization accordingly. Only permissions of teams defined in the config are changed. That is, the permissions of any teams that are not added to the configuration are not touched. This allows to keep manual control over specific teams.

If the optional `--clear-collaborators` option is passed to the command, all collaborators (single user permissions) of all repositories are removed. This can be prevented per repository by defining them in the configuration and setting the field `clearCollaborators` to `false`.

### Add open issues to a project

**Note: This command does not require a configuration file.**

`github-commander add-issues-to-project -o <org_name> -r <repository_name> -p <project_name> -c <column_name>`

Loads all open issues of the specified repository and appends them to the column in the specified project (must be a global project within that organization). The issues are sorted by label before they are appended to the existing cards in that column. The sort order is as follows:

1. "bug" label
2. No label
3. "enhancement" label
4. Any other labels

Issues having the same labels are sorted in ascending order by their number, i.e. oldest first.

### Move a project column to a different project

**Note: This command does not require a configuration file.**

`github-commander move-column-to-project -o <org_name> -s <source_project_name> -d <destination_project_name> -c <column_name>`

Moves a column including all its cards from the specified source project to the specified destination project. If a column with the same name already exists in the destination project, it can only be used if it is still empty. If no such column exists, a new one with the same name will be created.

## Config format

All commands (except for `generate-token`) work based on a configuration file that must be passed to the command. That file's format can be either `json` or `yaml`. The config structure required by the commands is always the same, although `issue-labels` and `permissions` expect different values to be present. In the following the required structure is explained in detail:

* `orgName` – **required**: The name of the GitHub organization you would like to _command_.
* `teams` – **required by `permissions`**: An array of teams in the selected organization, e.g.:

    ```yaml
    teams:
      - name: My team
        defaultPermission: ADMIN
    ```

    Both fields `name` and `defaultPermission` must be set. `defaultPermission` must be one of the following values:

	- `NONE`: The team can neither see the repository nor `git pull` it.
	- `READ`: The team can pull it and create new issues, PRs etc.
	- `WRITE`: The team can push changes and edit issues, PRs etc.
	- `ADMIN`: The team has full admin rights on the repository, incl. adding new teams/collaborators and deleting the repository.

* `issueLabels` – **required by `issue-labels`**: An array of issue label definitions, e.g.:

    ```yaml
    issueLabels:
      - name: bug
        description: Go catch it!
        color: ee0701
    ```

    The fields `name` (case insensitive) and `color` must be set; `description` is optional. The color must be a valid, three to six character hex color code and is validated upon loading the config.

* `repositories` – _optional_: An array of repository descriptions. These are used by the `permissions` command to apply custom permission settings for specific repositories. That is, you can set a specific permission for a team on a specific repository. These settings override the team's `defaultPermission` and can both downgrade and upgrade the team's permission on the repository. Furthermore you can overwrite the `--clear-collaborators` option for single repositories by setting `clearCollaborators` to `false`:

    ```yaml
    repository:
      - name: upgraded-sniffle
        clearCollaborators: false
        teamPermissions:
          - teamName: My team
            permission: READ
    ```

    This example config does two things:

    1. Prevent the collaborators of repository `upgraded-sniffle` from being cleared in case the `--clear-collaborators` option is set.
    2. Downgrade the permission of team `My team` for repository `upgraded-sniffle` to read only, even though the team's `defaultPermission` is `ADMIN`.

    Please note that the `teamPermissions` **do not** describe exclusive permissions. That is, if you have several teams and define only one of those teams in `teamPermissions`, all other teams still receive their default permissions for that repository.

You can find example configurations both as [yaml](config.yaml.dist) and as [json](config.json.dist) in this repository.

## License

[MIT](https://github.com/svenmuennich/github-commander/blob/master/LICENSE)
