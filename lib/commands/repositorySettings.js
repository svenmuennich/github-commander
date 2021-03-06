#!/usr/bin/env node

const path = require('path');
const { program } = require('commander');
const asyncSequence = require('../asyncSequence');
const commandRunner = require('./commandRunner');
const configReader = require('../configReader');
const findOrganization = require('../findOrganization');
const getAccessToken = require('../getAccessToken');
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

    // Check for any repository settings
    const repositorySettings = config.repositories.filter(repoConfig => repoConfig.settings && Object.keys(repoConfig.settings).length > 0);
    if (Object.keys(config.repositorySettings).length === 0 && repositorySettings.length === 0) {
        throw new Error('The provided config file must contain \'repositorySettings\' and/or \'settings\' per \'repository\' to be able to run this command.');
    }

    // Configure Octokit
    const accessToken = await getAccessToken();
    const octokit = makeOctokit(accessToken);

    // Check whether the user has access to the org selected in the config
    const githubOrg = await findOrganization(octokit, config.orgName);

    // Fetch the org's repositories
    console.log('Loading available repositories...');
    const allGithubRepositories = await octokit.paginate(octokit.rest.repos.listForOrg, {
        org: githubOrg.login,
    });
    console.log(`\t${allGithubRepositories.length} repositories found`);

    // Update the settings of all repositories
    const globalProtectedBranches = config.repositorySettings.protectedBranches || null;
    await asyncSequence(allGithubRepositories, async (githubRepository) => {
        console.log(`Updating settings of repository '${githubRepository.name}':`);
        const configRepository = config.repositories.find(repository => repository.name === githubRepository.name);

        // Update protected branches
        const protectedBranchesConfig = (configRepository && configRepository.settings && configRepository.settings.protectedBranches) ? configRepository.settings.protectedBranches : globalProtectedBranches;
        if (Array.isArray(protectedBranchesConfig)) {
            console.log('\tUpdating protected branches...');
            // Load all available branches
            const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
                owner: githubOrg.login,
                repo: githubRepository.name,
            });

            // Protect all branches that need protection and remove protection from all others
            await Promise.all(branches.map(async (branch) => {
                console.log(`\t - ${branch.name}`);
                const branchConfig = protectedBranchesConfig.find(anyConfig => anyConfig.name === branch.name);
                if (branchConfig) {
                    console.log('\t   Updating protection...');
                    const protectionConfig = {
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
                    await octokit.rest.repos.updateBranchProtection({
                        owner: githubOrg.login,
                        repo: githubRepository.name,
                        branch: branch.name,
                        ...protectionConfig,
                    });
                } else {
                    console.log('\t   Removing protection...');
                    try {
                        await octokit.rest.repos.deleteBranchProtection({
                            owner: githubOrg.login,
                            repo: githubRepository.name,
                            branch: branch.name,
                        });
                    } catch (error) {
                        // Ignore '404 Not found' errors, since they mean that the beanch was not protected before
                        if (!error.status || error.status !== 404) {
                            throw error;
                        }
                    }
                }
            }));
        }
    });
});
