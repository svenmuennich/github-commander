#!/usr/bin/env node

const execa = require('execa');
const {
    promises: fs,
    constants: fsConstants,
} = require('fs');
const simpleGit = require('simple-git/promise');
const os = require('os');
const path = require('path');
const program = require('commander');
const commandRunner = require('./commandRunner');
const GitHubClient = require('../gitHubClient');
const oAuthToken = require('../oAuthToken');
const programVersion = require('../version');
const Prompt = require('../prompt');

const git = simpleGit().silent(true);

// Define CLI
program
    .version(programVersion)
    .option('-o, --org <orgName>', 'The name of the GitHub organization whose repositories should be updated.')
    .option('-b, --branch <branchName>', 'The name of the branch the changes should be pushed to. Will be created if necessary.')
    .option('-m, --message <commitMessage>', 'The message to be used for committing any changes that resulted from running the script.')
    .option('--name-filter <nameFilter (regex)>', 'A regular expression used for filtering the repositories that will be updated. The expression is matched against the repository name.')
    .option('--dry-run', 'Pass this option to skip pushing any changes.')
    .arguments('<updateScriptPath>')
    .parse(process.argv);

// Run command
commandRunner(async () => {
    // Validate arguments
    const orgName = program.org;
    if (typeof orgName !== 'string') {
        throw new Error('No org given!');
    }
    const targetBranchName = program.branch;
    if (typeof targetBranchName !== 'string') {
        throw new Error('No target branch name given!');
    }
    const commitMessage = program.message;
    if (typeof commitMessage !== 'string' || commitMessage.length === 0) {
        throw new Error('No commit message given!');
    }
    if (program.args.length < 1) {
        throw new Error('No update script file given!');
    }
    const updateScriptPath = program.args[0];
    try {
        await fs.access(updateScriptPath, fsConstants.X_OK);
    } catch (error) {
        throw new Error(`Provided update script at path ${updateScriptPath} is not executable! Run 'chmod +x "${updateScriptPath}"' to fix permissions.`);
    }
    const resolvedUpdateScriptPath = path.resolve(updateScriptPath);

    // Configure the GitHub client
    const token = await oAuthToken.getToken();
    const client = new GitHubClient(token);

    // Load the user profile to get their login name (required for git operations)
    const user = await client.requestGently(client.github.users.getAuthenticated);
    const username = user.data.login;

    // Check whether the user has access to the passed org
    console.log(`Loading GitHub organization '${orgName}'...`);
    const githubOrg = await client.findOrg(orgName);

    // Fetch the org's repositories
    console.log('Loading available repositories...');
    const allGithubRepositories = await client.fetchAllResults(client.github.repos.listForOrg, {
        org: githubOrg.login,
    });
    console.log(`\t${allGithubRepositories.length} repositories found`);

    let repoNameFilter;
    if (program.nameFilter && program.nameFilter.length > 0) {
        repoNameFilter = new RegExp(program.nameFilter);
    }

    console.log(`Updating repositories using script ${updateScriptPath}...`);
    const remoteBranchMatcher = new RegExp(`remotes/origin/${targetBranchName}`);
    const modifiedRepositories = [];
    await GitHubClient.sequentiallyAwaitEach(allGithubRepositories, async (githubRepository) => {
        if (githubRepository.archived) {
            console.log(`\tSkipping repository '${githubRepository.name}' because it has been archived`);

            return;
        }
        if (!githubRepository.permissions.push) {
            console.log(`\tSkipping repository '${githubRepository.name}' because authenticated user has no push access`);

            return;
        }
        if (repoNameFilter && !githubRepository.name.match(repoNameFilter)) {
            console.log(`\tSkipping repository '${githubRepository.name}' because it does not match the filter`);

            return;
        }

        // Clone the repository to a temporary directory
        const checkoutDir = await fs.mkdtemp(path.join(os.tmpdir(), `github-repo-${githubRepository.name}-`));
        await fs.chmod(checkoutDir, 0o755);
        console.log(`\tCloning '${githubRepository.name}' to ${checkoutDir} ...`);
        const gitRemoteUrl = new URL(githubRepository.clone_url);
        gitRemoteUrl.username = username;
        gitRemoteUrl.password = token;
        await git.clone(gitRemoteUrl.toString(), checkoutDir, {
            depth: 1,
        });
        await git.cwd(checkoutDir);

        const status = await git.status();
        if (status.current !== targetBranchName) {
            // Create and/or checkout the specified branch
            const branchSummary = await git.branch();
            const existingBranch = Object.values(branchSummary.branches)
                .find(branch => branch.name.match(remoteBranchMatcher));
            if (existingBranch) {
                console.log(`\tUsing existing branch '${existingBranch.name}'`);
                await git.checkoutBranch(targetBranchName, existingBranch.name);
            } else {
                console.log(`\tCreating branch '${targetBranchName}'...`);
                await git.checkoutLocalBranch(targetBranchName);
            }
        }

        // Update the repo using the supplied script
        console.log(`\tRunning ${updateScriptPath} in ${checkoutDir} ...`);
        try {
            const { stdout } = await execa(`cd "${checkoutDir}" && ${resolvedUpdateScriptPath}`, [], { shell: true });
            if (stdout.length > 0) {
                console.log(stdout.split('\n').map(line => `\t\t${line}`).join('\n'));
            }
        } catch (scriptError) {
            console.log(`\tScript resulted in error: ${scriptError.message}`);

            return;
        }

        // Commit changes if necessary
        const gitStatus = await git.status();
        if (gitStatus.modified.length === 0) {
            console.log('\tScript resulted in no changes');

            return;
        }
        console.log('\tCommitting modified files...');
        console.log(gitStatus.modified.map(fileName => `\t\t${fileName}`).join('\n'));
        await git.add(gitStatus.modified);
        await git.commit(commitMessage);
        modifiedRepositories.push(githubRepository);

        if (!program.dryRun) {
            console.log(`\tPushing changes on branch '${targetBranchName}' to remote...`);
            await git.push('origin', targetBranchName);
        }
    });

    console.log('Done!');

    console.log('Modified repositories:');
    modifiedRepositories.forEach(repo => console.log(` - ${repo.name}`));
    const openRepositories = await Prompt.confirm('Would you like to open them in your browser to create pull requests for the changes?');
    if (openRepositories) {
        const command = modifiedRepositories
            .map(repo => `open "https://github.com/${orgName}/${repo.name}/compare/${targetBranchName}"`)
            .join(' && ');
        await execa(command, [], { shell: true });
    }
});
