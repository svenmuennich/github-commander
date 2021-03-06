#!/usr/bin/env node

const path = require('path');
const { program } = require('commander');
const asyncSequence = require('../asyncSequence');
const commandRunner = require('./commandRunner');
const configReader = require('../configReader');
const findOrganization = require('../findOrganization');
const getAccessToken = require('../getAccessToken');
const limiter = require('../limiter');
const makeOctokit = require('../makeOctokit');
const programVersion = require('../version');

// Define CLI
program
    .version(programVersion)
    .arguments('<config_file>')
    .parse(process.argv);

// Run command
commandRunner(async () => {
    // Validate arguments
    if (program.args.length < 1) {
        throw new Error('No config file given!');
    }

    // Read the config file
    const configPath = path.resolve(process.cwd(), program.args[0]);
    const config = await configReader(configPath);
    if (config.issueLabels.length === 0) {
        throw new Error('The provided config file must contain at least on entry in \'issueLabels\' to be able to update the repositories\' issue labels.');
    }

    // Configure Octokit
    const accessToken = await getAccessToken();
    const octokit = makeOctokit(accessToken);

    // Check whether the user has access to the org selected in the config
    const githubOrg = await findOrganization(octokit, config.orgName);

    // Fetch the org's repositories
    console.log('Loading available repositories...');
    let allGithubRepositories = await octokit.paginate(octokit.rest.repos.listForOrg, {
        org: githubOrg.login,
    });
    allGithubRepositories = allGithubRepositories.filter(repository => !repository.archived && repository.has_issues);
    console.log(`\t${allGithubRepositories.length} active repositories found`);

    // Update the issue labels of all repositories
    await asyncSequence(allGithubRepositories, async (githubRepository) => {
        console.log(`Syncing issue labels of repository '${githubRepository.name}':`);
        // Load existing issue labels
        const repoLabels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
            owner: githubOrg.login,
            repo: githubRepository.name,
        });

        // Use repository-configured issue labels, or, if those are not specified, the global issue label configuration
        const repositoryConfig = config.repositories.find(repository => repository.name === githubRepository.name);
        const expectedIssueLabels = (repositoryConfig && repositoryConfig.issueLabels) || config.issueLabels;

        // Add new labels
        const labelsToAdd = expectedIssueLabels.filter(issueLabel => !repoLabels.find(label => label.name.toLowerCase() === issueLabel.name.toLowerCase()));
        await Promise.all(labelsToAdd.map(async (newLabel) => {
            console.log(`\tAdding new label '${newLabel.name}' with color '#${newLabel.color}'...`);

            return limiter.schedule(() => octokit.rest.issues.createLabel({
                owner: githubOrg.login,
                repo: githubRepository.name,
                name: newLabel.name,
                description: newLabel.description || null,
                color: newLabel.color,
            }));
        }));

        // Update changed labels (only color can change)
        await Promise.all(repoLabels.map(async (repoLabel) => {
            const issueLabel = expectedIssueLabels.find(label => label.name.toLowerCase() === repoLabel.name.toLowerCase());
            if (!issueLabel) {
                return null;
            }
            const issueLabelDescription = issueLabel.description || null;
            const repoLabelDescription = repoLabel.description || null;
            if (issueLabelDescription === repoLabelDescription && issueLabel.color === repoLabel.color.toLowerCase()) {
                return null;
            }

            console.log(`\tUpdating label '${repoLabel.name}':\n\t\t- description: ${issueLabelDescription || 'n/a'}\n\t\t- color: '#${issueLabel.color}'...`);

            // Update label description and color
            return limiter.schedule(() => octokit.rest.issues.updateLabel({
                owner: githubOrg.login,
                repo: githubRepository.name,
                current_name: repoLabel.name,
                name: repoLabel.name,
                description: issueLabelDescription,
                color: issueLabel.color,
            }));
        }));

        // Delete obsolete labels
        const repoLabelsToDelete = repoLabels.filter(repoLabel => !expectedIssueLabels.find(label => label.name.toLowerCase() === repoLabel.name.toLowerCase()));
        await Promise.all(repoLabelsToDelete.map(async (repoLabel) => {
            console.log(`\tDeleting label '${repoLabel.name}'...`);

            return limiter.schedule(() => octokit.rest.issues.deleteLabel({
                owner: githubOrg.login,
                repo: githubRepository.name,
                name: repoLabel.name,
            }));
        }));
    });
});
