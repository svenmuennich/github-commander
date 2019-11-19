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

const GITHUB_ISSUE_TEMPLATE_DIR = '.github/ISSUE_TEMPLATE/';

/**
 * Create a GitHub compatible issue template by prepending the meta data as yaml to the contents of the tempalte file.
 * The format use by GitHub is as follows:
 * ---
 * name: The name of the template.
 * about: Some description.
 *
 * ---
 *
 * The template contents...
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
        // Check file extension
        if (path.extname(issueTemplate.templateFile) !== '.md') {
            throw new Error(`The type of issue template file ${issueTemplate.templateFile} is not supported. Only '.md' is supported.`);
        }

        // Check that file exists
        const templatePath = path.resolve(path.dirname(configPath), issueTemplate.templateFile);
        const templateFileExists = await fs.exists(templatePath);
        if (!templateFileExists) {
            throw new Error(`The issue template file ${issueTemplate.templateFile} does not exist (checked path: ${templatePath}).`);
        }

        // Save both the template content and a GitHub compatible template file
        issueTemplate.templateFile = templatePath;
        issueTemplate.githubTemplateFile = await createIssueTemplateFile(issueTemplate);
    };
    await Promise.all(config.issueTemplates.map(parseIssueTemplateFile));
    await Promise.all(config.repositories.map(async (repository) => {
        const issueTemplates = repository.issueTemplates || [];
        await Promise.all(issueTemplates.map(parseIssueTemplateFile));
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

    // Update the issue templates of all repositories
    await GitHubClient.sequentiallyAwaitEach(allGithubRepositories, async (githubRepository) => {
        console.log(`Syncing issue templates of repository '${githubRepository.name}':`);

        // Use repository-configured issue templates, or, if those are not specified, the global issue
        // template configuration
        const repositoryConfig = config.repositories.find(repository => repository.name === githubRepository.name);
        const expectedIssueTemplates = (repositoryConfig && repositoryConfig.issueTemplates) || config.issueTemplates;

        const repoInfo = {
            owner: githubOrg.login,
            repo: githubRepository.name,
        };

        // Load existing issue templates
        console.log('Loading all existing issue templates...');
        let repoTemplateFilePaths = [];
        try {
            const response = await client.requestGently(client.github.repos.getContents, {
                ...repoInfo,
                path: GITHUB_ISSUE_TEMPLATE_DIR,
            });
            repoTemplateFilePaths = response.data.filter(fileInfo => fileInfo.type === 'file').map(fileInfo => fileInfo.path);
        } catch (error) {
            // Ignore '404 Not found' errors, because they mean that no issue templates exist yet
            if (error.status !== 404) {
                console.error(`❌ Failed to load existing issue templates of repository '${githubRepository.name}': ${error.message}`);

                return;
            }
        }

        try {
            // Parse existing issue templates
            let repoTemplates = await Promise.all(repoTemplateFilePaths.map(async (githubPath) => {
                // Load the template file
                const response = await client.requestGently(client.github.repos.getContents, {
                    ...repoInfo,
                    path: githubPath,
                });
                const fileInfo = response.data;

                // Parse the template file and its meta data
                const rawFileContent = Buffer.from(fileInfo.content, 'base64').toString('utf8');
                const rawMetaData = rawFileContent.split(/(\r?\n){2}---(\r?\n){2}/)[0];
                const metaData = yaml.safeLoad(rawMetaData);

                return {
                    fileName: fileInfo.name,
                    fileSha: fileInfo.sha,
                    metaData,
                    rawFileContent,
                };
            }));

            // Delete obsolete templates first, to free as many file names as possible
            const repoTemplatesToDelete = repoTemplates.filter(repoTemplate => !expectedIssueTemplates.find(template => template.name === repoTemplate.metaData.name));
            await GitHubClient.sequentiallyAwaitEach(repoTemplatesToDelete, async (repoTemplate) => {
                console.log(`\tDeleting template '${repoTemplate.metaData.name}'...`);
                await client.requestGently(client.github.repos.deleteFile, {
                    ...repoInfo,
                    path: GITHUB_ISSUE_TEMPLATE_DIR + repoTemplate.fileName,
                    message: `Delete issue template '${repoTemplate.metaData.name}'`,
                    sha: repoTemplate.fileSha,
                });
            });
            repoTemplates = repoTemplates.filter(repoTemplate => !repoTemplatesToDelete.includes(repoTemplate));

            // Update changed templates (only description and content can change)
            await GitHubClient.sequentiallyAwaitEach(repoTemplates, async (repoTemplate) => {
                const issueTemplate = expectedIssueTemplates.find(template => template.name === repoTemplate.metaData.name);
                if (!issueTemplate) {
                    return undefined;
                }

                // Compare the GitHub compatible template file with the current template file to prevent creating commits in
                // case nothing changes
                if (issueTemplate.githubTemplateFile === repoTemplate.rawFileContent) {
                    console.log(`\tTemplate '${issueTemplate.name}' is up to date`);

                    return undefined;
                }

                console.log(`\tUpdating template '${issueTemplate.name}'...`);
                await client.requestGently(client.github.repos.updateFile, {
                    ...repoInfo,
                    path: GITHUB_ISSUE_TEMPLATE_DIR + repoTemplate.fileName,
                    message: `Update issue template '${issueTemplate.name}'`,
                    content: Buffer.from(issueTemplate.githubTemplateFile).toString('base64'),
                    sha: repoTemplate.fileSha,
                });

                return undefined;
            });

            // Add new templates
            const templatesToAdd = expectedIssueTemplates.filter(template => !repoTemplates.find(repoTemplate => repoTemplate.metaData.name === template.name));
            await GitHubClient.sequentiallyAwaitEach(templatesToAdd, async (newTemplate) => {
                console.log(`\tAdding new template '${newTemplate.name}'...`);

                // Find an available file name
                let fileName = path.basename(newTemplate.templateFile);
                const extension = path.extname(newTemplate.templateFile);
                const isFileNameTaken = name => repoTemplates.find(template => template.fileName === name);
                let suffixCounter = 0;
                while (isFileNameTaken(fileName)) {
                    suffixCounter += 1;
                    fileName = `${path.basename(fileName, extension)}-${suffixCounter}${extension}`;
                }

                await client.requestGently(client.github.repos.createFile, {
                    ...repoInfo,
                    path: GITHUB_ISSUE_TEMPLATE_DIR + fileName,
                    message: `Add new issue template '${newTemplate.name}'`,
                    content: Buffer.from(newTemplate.githubTemplateFile).toString('base64'),
                });
            });
        } catch (error) {
            console.error(`❌ Failed to update issue templates in repository '${githubRepository.name}': ${error.message}`);
        }
    });
});
