module.exports = class BranchProtectionConfiguration {
    static validateRawConfig(rawConfig, breadcrumb) {
        if (!Array.isArray(rawConfig)) {
            throw new Error(`Invalid config: '${breadcrumb}.protectedBranches' must be of type 'Array'.`);
        }
        rawConfig.forEach((branchSettings, index) => {
            if (typeof branchSettings !== 'object') {
                throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}]' must be of type 'Object'.`);
            }
            if (typeof branchSettings.name !== 'string' || branchSettings.name.length === 0) {
                throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].name' must be of type 'String'.`);
            }
            if ('requireReviews' in branchSettings) {
                if (typeof branchSettings.requireReviews !== 'object') {
                    throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireReviews' must be of type 'Object'.`);
                }
                if ('dismissApprovalWhenChanged' in branchSettings.requireReviews && typeof branchSettings.requireReviews.dismissApprovalWhenChanged !== 'boolean') {
                    throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireReviews.dismissApprovalWhenChanged' must be of type 'Boolean'.`);
                }
                if ('requireCodeOwnerReview' in branchSettings.requireReviews && typeof branchSettings.requireReviews.requireCodeOwnerReview !== 'boolean') {
                    throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireReviews.requireCodeOwnerReview' must be of type 'Boolean'.`);
                }
            }
            if ('requireStatusChecks' in branchSettings) {
                if (typeof branchSettings.requireStatusChecks !== 'object') {
                    throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireStatusChecks' must be of type 'Object'.`);
                }
                if ('statusChecks' in branchSettings.requireStatusChecks) {
                    if (!Array.isArray(branchSettings.requireStatusChecks.statusChecks)) {
                        throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireStatusChecks.statusChecks' must be of type 'Array'.`);
                    }
                    branchSettings.requireStatusChecks.statusChecks.forEach((statusCheck, statusCheckIndex) => {
                        if (typeof statusCheck !== 'string' || statusCheck.length === 0) {
                            throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireStatusChecks.statusChecks[${statusCheckIndex}]' must be of type 'String'.`);
                        }
                    });
                } else {
                    branchSettings.requireStatusChecks.statusChecks = [];
                }
                if ('requireBranchUpToDate' in branchSettings.requireStatusChecks && typeof branchSettings.requireStatusChecks.requireBranchUpToDate !== 'boolean') {
                    throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireStatusChecks.requireBranchUpToDate' must be of type 'Boolean'.`);
                }
            }
            if ('requireLinearHistory' in branchSettings && typeof branchSettings.name !== 'boolean') {
                throw new Error(`Invalid config: '${breadcrumb}.protectedBranches[${index}].requireLinearHistory' must be of type 'Boolean'.`);
            }
        });
    }

    /**
     * @constructor
     * @param {Object} rawConfig
     * @param {String} breadcrumb
     * @param {BranchProtectionConfiguration|undefined} parent
     */
    constructor(rawConfig, breadcrumb, parent) {
        BranchProtectionConfiguration.validateRawConfig(rawConfig, breadcrumb);
        this.rawConfig = rawConfig;
        this.breadcrumb = breadcrumb;
        this.parent = parent;

        this.branchName = this.rawConfig.name;
        this.requireReviews = this.rawConfig.requireReviews;
    }

    /**
     * @param {Array} elements
     * @param {Function} asyncFn
     * @param {Number} index (optional, default 0)
     */
    sequentiallyAwaitEach(elements, asyncFn, index = 0) {
        if (elements.length === 0) {
            return;
        }

        await asyncFn(elements[index]);
        if ((index + 1) < elements.length) {
            await this.sequentiallyAwaitEach(elements, asyncFn, (index + 1));
        }
    }
};
