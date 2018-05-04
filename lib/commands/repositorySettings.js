#!/usr/bin/env node

const commandRunner = require('./commandRunner');
const configReader = require('../configReader');
const GitHubClient = require('../gitHubClient');
const oAuthToken = require('../oAuthToken');
const path = require('path');
const program = require('commander');
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

    // Check for any repository settings
    const repositorySettings = config.repositories.filter(repoConfig => repoConfig.settings && Object.keys(repoConfig.settings).length > 0);
    if (Object.keys(config.repositorySettings).length === 0 && repositorySettings.length === 0) {
        throw new Error('The provided config file must contain \'repositorySettings\' and/or \'settings\' per \'repository\' to be able to run this command.');
    }

    // Configure the GitHub client
    const token = await oAuthToken.getToken();
    const client = new GitHubClient(token);

    // Check whether the user has access to the org selected in the config
    console.log(`Loading GitHub organization '${config.orgName}'...`);
    const githubOrg = await client.findOrg(config.orgName);

    // Fetch the org's repositories
    console.log('Loading available repositories...');
    const allGithubRepositories = await client.fetchAllResults(client.github.repos.getForOrg, {
        org: githubOrg.login,
    });
    console.log(`\t${allGithubRepositories.length} repositories found`);

    // Update the settings of all repositories
    const globalProtectedBranches = config.repositorySettings.protectedBranches || [];
    await GitHubClient.sequentiallyAwaitEach(allGithubRepositories, async (githubRepository) => {
        console.log(`Updating settings of repository '${githubRepository.name}':`);
        const configRepository = config.repositories.find(repository => repository.name === githubRepository.name);

        // Update protected branches
        const protectedBranchesConfig = (configRepository && configRepository.settings && configRepository.settings.protectedBranches) ? configRepository.settings.protectedBranches : globalProtectedBranches;
        if (protectedBranchesConfig.length > 0) {
            console.log('\tUpdating protected branches...');
            // Load all available branches
            const branches = await client.fetchAllResults(client.github.repos.getBranches, {
                owner: githubOrg.login,
                repo: githubRepository.name,
            });

            // Protect all branches that need protection and remove protection from all others
            await Promise.all(branches.map(async (branch) => {
                console.log(`\t - ${branch.name}`);
                const branchConfig = protectedBranchesConfig.find(config => config.name === branch.name);
                if (branchConfig) {
                    console.log('\t   Updating protection...');
                    let protectionConfig = {
                        enforce_admins: false,
                        required_pull_request_reviews: null,
                        required_status_checks: null,
                        restrictions: null,
                    };
                    if (branchConfig.requireStatusChecks) {
                        protectionConfig.required_status_checks = {
                            contexts: branchConfig.requireStatusChecks.statusChecks,
                            strict: branchConfig.requireStatusChecks.requireBranchUpToDate,
                        };
                    }
                    if (branchConfig.requireReviews) {
                        protectionConfig.required_pull_request_reviews = {
                            dismiss_stale_reviews: branchConfig.requireReviews.dismissApprovalWhenChanged,
                            require_code_owner_reviews: branchConfig.requireReviews.requireCodeOwnerReview,
                        };
                    }
                    await client.github.repos.updateBranchProtection({
                        owner: githubOrg.login,
                        repo: githubRepository.name,
                        branch: branch.name,
                        ...protectionConfig
                    });
                } else {
                    console.log('\t   Removing protection...');
                    try {
                        await client.github.repos.removeBranchProtection({
                            owner: githubOrg.login,
                            repo: githubRepository.name,
                            branch: branch.name
                        });
                    } catch (error) {
                        // Ignore '404 Not found' errors, since they mean that the beanch was not protected before
                        if (!error.code || error.code !== 404) {
                            throw error;
                        }
                    }
                }
            }));
        }
    });
});
