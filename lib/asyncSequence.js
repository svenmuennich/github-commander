module.exports = async (elements, action) => elements.reduce(
    (previousPromise, element) => previousPromise.then(() => action(element)), // eslint-disable-line promise/prefer-await-to-then
    Promise.resolve(null),
);
