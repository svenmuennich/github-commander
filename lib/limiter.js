const Bottleneck = require('bottleneck');

module.exports = new Bottleneck({
    maxConcurrent: 1,
    minTime: 2000, // 2 seconds
});
