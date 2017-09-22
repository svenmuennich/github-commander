const co = require('co');
const coPrompt = require('co-prompt');

module.exports = {
    /**
     * @param {String} message
     * @return {Promise}
     */
    async prompt(message) {
        return this.wrap(coPrompt, [`${message} `]);
    },

    /**
     * @param {String} message
     * @param {Boolean} allowBlank (optional)
     * @return {Promise}
     */
    async password(message, allowBlank) {
        return this.wrap(coPrompt.password, [`${message} `, null, allowBlank]);
    },

    /**
     * @param {String} message
     * @return {Promise}
     */
    async confirm(message) {
        return this.wrap(coPrompt.confirm, [`${message} `]);
    },

    /**
     * @param {Function} fn
     * @param {Array} args
     * @param {Promise}
     */
    async wrap(fn, args) {
        return co.wrap(function* () {
            return yield fn(...args);
        })();
    },
};
