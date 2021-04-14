module.exports = async (octokit, orgName) => {
    console.log(`Loading GitHub organization '${orgName}'...`);
    try {
        const { data: result } = await octokit.rest.orgs.get({ org: orgName });

        return result;
    } catch (error) {
        if (error.status === 404) {
            throw new Error(`The organization '${orgName}' does not exist or is not visible to your account.`);
        }

        throw error;
    }
};
