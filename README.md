# github-commander

[![Software License](https://img.shields.io/badge/license-MIT-brightgreen.svg?style=flat)](LICENSE) [![Build Status](https://github.com/svenmuennich/github-commander/workflows/CI/badge.svg)](https://github.com/svenmuennich/github-commander/actions?workflow=CI) [![npm](https://img.shields.io/npm/v/github-commander.svg?style=flat)](https://www.npmjs.com/package/github-commander)

A CLI tool for performing tedious GitHub settings with a keystroke.

## Install

### Via npm

`npm install -g github-commander`

### For development

Clone this repository and install it using `npm install && npm link`.

## Usage

### Unify issue labels across all repositories

`github-commander issue-labels <path_to_config_file>`

Reads the top-level `issueLabels` section as well as `issueLabels` and `additionalIssueLabels` repository sections of your configuration and applies it to all repositories in the selected organization. This includes

* adding any new labels defined in the config,
* updating the colors of existing labels (matched by name, case insensitive) and
* deleting any labels that exist in a repository but not in the config.

### Unify team permissions across all repositories

`github-commander repository-permissions <path_to_config_file>`

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

### Change repository settings

**Note: Even though the repository's collaborators are part of the repository settings, they must be configured using `permissions`.**

`github-commander repository-settings <path_to_config_file>`

Reads the `repositorySettings` and `repositories` sections of your configuration and updates the settings of all repositories in the selected organization accordingly. If the optional `repositorySettings` element does not exist, only settings of `repositories` elements having `settings` element are changed. That said, if both repository specific `settings` and the _global_ `repositorySettings` exist, the repository specific settings take precedence of the global settings and they are not merged.

### Add issue and pull request templates to all repositories

`github-commander issue-templates <path_to_config_file>`

Reads the `issueTemplates` and `pullRequestTemplate` sections of your configuration and updates the issue and pull request templates, respectively, of all repositories in the selected organization that match the following criteria:

* visibility is `private`
* repository is not archived
* repository is no fork

Non-archived, public repositories (exlcuding forks) can be included in the update by passing the option `--include-public-repos`.

When a valid repositories is updated, any new templates are added, existing templates (matched by name) are updated and removed templates are deleted by separate commits for each template.

### Update the contents of mutliple repositories at once

**Note: This command does not require a configuration file.**

`github-commander bulk-update-repositories -o <org_name> -b <target_branch_name> -m <commit_message> <path_to_script>`

Runs the passed script on a checkout of the default branch of all non-archived repositories the authenticated user has push access to. If running the script results in any changes, they will be committed to the passed target branch using the given message and pushed to remote.

To filter the repositories the script will be run for you can pass a regular expression the repository name will be matched against:

`--name-filter <repository_name_filter_regex>`

The command has support for passing a `--dry-run` argument to perform all work as normal but skip pushing the branch to remote, which is useful for testing.

### Transfer all open issues from one repository to another

`github-commander transfer-open-issues -o <org_name> -s <source_repository_name> -d <destination_repository_name>`

Transfers all issues in status `open` from the given source repository to the given destination repository.

While metadata like assignees and projects are automatically transferred by GitHub, labels are not, since the available labels might differ between the two repositories. In that case, the command will prompt you to confirm the transfer.

In order to transfer as many labels as possible to the new issue, all labels set in the original issue that also exist in the destination repository (matched by name) are set.

## Config format

Some commands work based on a configuration file that must be passed to the command. That file's format can be either `json` or `yaml`. The config structure required by the commands is always the same, although `issue-labels` and `permissions` expect different values to be present. In the following the required structure is explained in detail:

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

* `issueTemplates` – **required by `issue-templates`**: An array of issue template definitions, e.g.:

    ```yaml
    issueTemplates:
      - name: Bug report
        description: Use this template when describing a bug.
        templateFile: './issue-templates/Bug_report.md'
    ```

    All fields must be set; `name` and `description` must both be strings with at least 3 characters and at most 200 characters. The `templateFile` must be a path relative to the location of the configuration file.

* `pullRequestTemplate` - _optional_: A simplified template definition, e.g.:

    ```yml
    pullRequestTemplate:
      templateFile: './pull-request-templates/default.md'
    ```

    The `templateFile` must be a path relative to the location of the configuration file.

* `repositorySettings` – _optional_: Currently only supports configuring protected branches, with some if its options (the example should be self explanatory):

    ```yaml
    repositorySettings:
      protectedBranches:
        - name: master
          requireReviews:
            dismissApprovalWhenChanged: true
            requireCodeOwnerReview: true
          requireStatusChecks:
            statusChecks:
              - 'continuous-integration/travis-ci'
            requireBranchUpToDate: true
    ```

* `repositories` – _optional_: An array of repository descriptions. These are used by the `permissions` command to apply custom permission settings for specific repositories. That is, you can set a specific permission for a team on a specific repository. These settings override the team's `defaultPermission` and can both downgrade and upgrade the team's permission on the repository. Furthermore you can overwrite the `--clear-collaborators` option for single repositories by setting `clearCollaborators` to `false`:

    ```yaml
    repository:
      - name: upgraded-sniffle
        clearCollaborators: false
        teamPermissions:
          - teamName: My team
            permission: READ
        settings:
          protectedBranches:
            - name: master
              requireReviews:
                dismissApprovalWhenChanged: true
                requireCodeOwnerReview: true
              requireStatusChecks:
                statusChecks:
                  - 'continuous-integration/travis-ci'
                requireBranchUpToDate: true
    ```

    This example config does two things:

    1. Prevent the collaborators of repository `upgraded-sniffle` from being cleared in case the `--clear-collaborators` option is set.
    2. Downgrade the permission of team `My team` for repository `upgraded-sniffle` to read only, even though the team's `defaultPermission` is `ADMIN`.
    3. Add protection to the branch `master`, incl.
        * dismissing approving PR reviews when changing the PR after receiving approval,
        * requiring at least one review by a designated code owner,
        * requiring all status checks to pass, specifically the automatic Travis CI build, and
        * requiring the PR branch to be up to date with `master` when merging.

    Please note that the `teamPermissions` **do not** describe exclusive permissions. That is, if you have several teams and define only one of those teams in `teamPermissions`, all other teams still receive their default permissions for that repository.

    You can also configure custom issue labels per repository, **either** by setting `issueLabels` and overriding the issue label list configured for the team **or** by configuring `additionalIssueLabels` to add labels in addition to the ones configured for the team. The format for each issue label is the same as for issue labels configurations on team level.

    Issue and pull request templates can also be configured per repository by setting `issueTemplates` and `pullRequestTemplate` using the same format as for the global `issueTemplates` and `pullRequestTemplate` config, respectively. When configuring templates for a repository these take precedence over the global templates.

You can find example configurations both as [yaml](config.yaml.dist) and as [json](config.json.dist) in this repository.

## License

[MIT](https://github.com/svenmuennich/github-commander/blob/master/LICENSE)
