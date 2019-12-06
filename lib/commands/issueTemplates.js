#!/usr/bin/env node

const fs = require('mz/fs');
const path = require('path');
const program = require('commander');
const yaml = require('js-yaml');
const commandRunner = require('./commandRunner');
const configReader = require('../configReader');
const GitHubClient = require('../gitHubClient');
const oAuthToken = require('../oAuthToken');
const programVersion = require('../version');

const GITHUB_DIR = '.github/';
const GITHUB_ISSUE_TEMPLATE_DIR = path.join(GITHUB_DIR, 'ISSUE_TEMPLATE');
const PR_TEMPLATE_NAME = '__PR_TEMPLATE__';
const PR_TEMPLATE_FILE_NAME = 'pull_request_template.md';

/**
 * Resolves the path of the passed `templateFile` relative to `configPath`.`
 *
 * @param {String} configPath
 * @param {String} templateFile
 * @return {String}
 */
const resolveTemplateFilePath = async (configPath, templateFile) => {
    // Check file extension
    if (path.extname(templateFile) !== '.md') {
        throw new Error(`The type of template file ${templateFile} is not supported. Only '.md' is supported.`);
    }

    // Check that file exists
    const templatePath = path.resolve(path.dirname(configPath), templateFile);
    const templateFileExists = await fs.exists(templatePath);
    if (!templateFileExists) {
        throw new Error(`The template file ${templateFile} does not exist (checked path: ${templatePath}).`);
    }

    return templatePath;
};

/**
 * Create a GitHub compatible issue template by prepending the meta data as yaml to the contents of the tempalte file.
 * The format use by GitHub is as follows:
 * ```
 * ---
 * name: The name of the template.
 * about: Some description.
 *
 * ---
 *
 * The template contents...
 *```
 *
 * @param {Object} issueTemplate
 * @return {String}
 */
const createIssueTemplateFile = async (issueTemplate) => {
    // Dump meta data as YAML
    const metaData = {
        name: issueTemplate.name,
        about: issueTemplate.description,
    };
    const metaDataPrefix = yaml.safeDump(metaData, {
        // Use a very long line length, which exceeds the possible max length of any line to prevent line folding
        lineWidth: 1000,
    });

    // Read template file
    const rawTemplate = await fs.readFile(issueTemplate.templateFile, 'utf8');

    return `---\n${metaDataPrefix}\n---\n\n${rawTemplate}`;
};

/**
 * Loads the file at `path` from GitHub.
 *
 * @param {Object} client
 * @param {GitHubClient} repoInfo
 * @param {String} githubPath
 * @return {Object}
 */
const loadFileFromGithub = async (client, repoInfo, githubPath) => {
    // Load the template file
    const response = await client.requestGently(client.github.repos.getContents, {
        ...repoInfo,
        path: githubPath,
    });
    const fileInfo = response.data;
    const rawFileContent = Buffer.from(fileInfo.content, 'base64').toString('utf8');

    return {
        fileName: fileInfo.name,
        fileSha: fileInfo.sha,
        githubPath,
        rawFileContent,
    };
};

const createTemplateDescription = templateName => ((templateName === PR_TEMPLATE_NAME) ? 'pull request template' : `issue template '${templateName}'`);
const capitalizeString = string => string.charAt(0).toUpperCase() + string.slice(1);

// Define CLI
program
    .version(programVersion)
    .option('--include-public-repos', 'Pass this option to update both public and private repositories.')
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

    // Validate and read the configured template files
    const parseIssueTemplateFile = async (issueTemplate) => {
        issueTemplate.templateFile = await resolveTemplateFilePath(configPath, issueTemplate.templateFile);
        issueTemplate.githubTemplateFile = await createIssueTemplateFile(issueTemplate);
        issueTemplate.githubPath = path.join(GITHUB_ISSUE_TEMPLATE_DIR, path.basename(issueTemplate.templateFile));
    };
    await Promise.all(config.issueTemplates.map(parseIssueTemplateFile));
    await Promise.all(config.repositories.filter(repository => repository.issueTemplates).map(async (repository) => {
        await Promise.all(repository.issueTemplates.map(parseIssueTemplateFile));
    }));
    const parsePullRequestTemplateFile = async (pullRequestTemplate) => {
        pullRequestTemplate.templateFile = await resolveTemplateFilePath(configPath, pullRequestTemplate.templateFile);
        pullRequestTemplate.githubTemplateFile = await fs.readFile(pullRequestTemplate.templateFile, 'utf8');
        pullRequestTemplate.githubPath = path.join(GITHUB_DIR, PR_TEMPLATE_FILE_NAME);
    };
    if (config.pullRequestTemplate) {
        await parsePullRequestTemplateFile(config.pullRequestTemplate);
        config.pullRequestTemplate.name = PR_TEMPLATE_NAME;
    }
    await Promise.all(config.repositories.filter(repository => repository.pullRequestTemplate).map(async (repository) => {
        await parsePullRequestTemplateFile(repository.pullRequestTemplate);
        repository.pullRequestTemplate.name = PR_TEMPLATE_NAME;
    }));

    // Configure the GitHub client
    const token = await oAuthToken.getToken();
    const client = new GitHubClient(token);

    // Check whether the user has access to the org selected in the config
    console.log(`Loading GitHub organization '${config.orgName}'...`);
    const githubOrg = await client.findOrg(config.orgName);

    // Fetch the org's repositories
    console.log('Loading available repositories...');
    let allGithubRepositories = await client.fetchAllResults(client.github.repos.listForOrg, {
        org: githubOrg.login,
    });
    allGithubRepositories = allGithubRepositories.filter(repository => (
        !repository.archived
        && !repository.fork
        && (repository.private || program.includePublicRepos)
    ));
    console.log(`\t${allGithubRepositories.length} active repositories found`);

    // Update the issue and pull request templates of all repositories
    await GitHubClient.sequentiallyAwaitEach(allGithubRepositories, async (githubRepository) => {
        console.log(`Syncing issue and pull request templates of repository '${githubRepository.name}':`);

        // Use repository-configured templates, or, if those are not specified, the global template configuration
        const repositoryConfig = config.repositories.find(repository => repository.name === githubRepository.name);
        const configuredIssueTemplates = (repositoryConfig && repositoryConfig.issueTemplates) || config.issueTemplates;
        // Ensure a new array is created to prevent the original configuration from being changed
        const configuredTemplates = [...configuredIssueTemplates];
        const configuredPullRequestTemplate = (repositoryConfig && repositoryConfig.pullRequestTemplate) || config.pullRequestTemplate;
        if (configuredPullRequestTemplate) {
            configuredTemplates.push(configuredPullRequestTemplate);
        }

        const repoInfo = {
            owner: githubOrg.login,
            repo: githubRepository.name,
        };

        // Load existing templates
        console.log('\tLoading all existing templates...');
        let repoIssueTemplateFilePaths = [];
        try {
            const response = await client.requestGently(client.github.repos.getContents, {
                ...repoInfo,
                path: GITHUB_ISSUE_TEMPLATE_DIR,
            });
            repoIssueTemplateFilePaths = response.data.filter(fileInfo => fileInfo.type === 'file').map(fileInfo => fileInfo.path);
        } catch (error) {
            // Ignore '404 Not found' errors, because they mean that no issue templates exist yet
            if (error.status !== 404) {
                console.error(`\t❌ Failed to load existing issue templates of repository '${githubRepository.name}': ${error.message}`);

                return;
            }
        }
        let repoPullRequestTemplateFilePath = null;
        try {
            const response = await client.requestGently(client.github.repos.getContents, {
                ...repoInfo,
                path: GITHUB_DIR,
            });
            const pullRequestTemplate = response.data.find(fileInfo => fileInfo.name === PR_TEMPLATE_FILE_NAME);
            if (pullRequestTemplate) {
                repoPullRequestTemplateFilePath = pullRequestTemplate.path;
            }
        } catch (error) {
            // Ignore '404 Not found' errors, because they mean that no pull request template exist yet
            if (error.status !== 404) {
                console.error(`\t❌ Failed to load existing pull request template of repository '${githubRepository.name}': ${error.message}`);

                return;
            }
        }

        try {
            // Load existing templates
            let repoTemplates = await Promise.all(repoIssueTemplateFilePaths.map(async (githubPath) => {
                const template = await loadFileFromGithub(client, repoInfo, githubPath);

                // Parse the template meta data
                const rawMetaData = template.rawFileContent.split(/(\r?\n){2}---(\r?\n){2}/)[0];
                template.metaData = yaml.safeLoad(rawMetaData);

                return template;
            }));
            if (repoPullRequestTemplateFilePath) {
                const pullRequestTemplate = await loadFileFromGithub(
                    client,
                    repoInfo,
                    repoPullRequestTemplateFilePath,
                );
                pullRequestTemplate.metaData = { name: PR_TEMPLATE_NAME };
                repoTemplates.push(pullRequestTemplate);
            }

            // Delete obsolete templates first, to free as many file names as possible
            const repoTemplatesToDelete = repoTemplates.filter(repoTemplate => !configuredTemplates.find(template => template.name === repoTemplate.metaData.name));
            await GitHubClient.sequentiallyAwaitEach(repoTemplatesToDelete, async (repoTemplate) => {
                const templateDescription = createTemplateDescription(repoTemplate.metaData.name);
                console.log(`\tDeleting ${templateDescription}...`);
                await client.requestGently(client.github.repos.deleteFile, {
                    ...repoInfo,
                    path: repoTemplate.githubPath,
                    message: `Delete ${templateDescription}`,
                    sha: repoTemplate.fileSha,
                });
            });
            repoTemplates = repoTemplates.filter(repoTemplate => !repoTemplatesToDelete.includes(repoTemplate));

            // Update changed templates (only description and content can change)
            await GitHubClient.sequentiallyAwaitEach(repoTemplates, async (repoTemplate) => {
                const configuredTemplate = configuredTemplates.find(template => template.name === repoTemplate.metaData.name);
                if (!configuredTemplate) {
                    return undefined;
                }

                const templateDescription = createTemplateDescription(repoTemplate.metaData.name);

                // Compare the GitHub compatible template file with the current template file to prevent creating
                // commits in case nothing changes
                if (configuredTemplate.githubTemplateFile === repoTemplate.rawFileContent) {
                    console.log(`\t${capitalizeString(templateDescription)} is up to date`);

                    return undefined;
                }

                console.log(`\tUpdating ${templateDescription}...`);
                await client.requestGently(client.github.repos.createOrUpdateFile, {
                    ...repoInfo,
                    path: repoTemplate.githubPath,
                    message: `Update ${templateDescription}`,
                    content: Buffer.from(configuredTemplate.githubTemplateFile).toString('base64'),
                    sha: repoTemplate.fileSha,
                });

                return undefined;
            });

            // Add new templates
            const templatesToAdd = configuredTemplates.filter(template => !repoTemplates.find(repoTemplate => repoTemplate.metaData.name === template.name));
            await GitHubClient.sequentiallyAwaitEach(templatesToAdd, async (newTemplate) => {
                const templateDescription = createTemplateDescription(newTemplate.name);
                console.log(`\tAdding ${templateDescription}...`);

                // Find an available file name
                let fileName = path.basename(newTemplate.templateFile);
                const extension = path.extname(newTemplate.templateFile);
                const isFileNameTaken = name => repoTemplates.find(template => template.fileName === name);
                let suffixCounter = 0;
                while (isFileNameTaken(fileName)) {
                    suffixCounter += 1;
                    fileName = `${path.basename(fileName, extension)}-${suffixCounter}${extension}`;
                }

                await client.requestGently(client.github.repos.createOrUpdateFile, {
                    ...repoInfo,
                    path: newTemplate.githubPath,
                    message: `Add ${templateDescription}`,
                    content: Buffer.from(newTemplate.githubTemplateFile).toString('base64'),
                });
            });
        } catch (error) {
            console.error(`\t❌ Failed to update issue and pull request templates in repository '${githubRepository.name}': ${error.message}`);
        }
    });
});
